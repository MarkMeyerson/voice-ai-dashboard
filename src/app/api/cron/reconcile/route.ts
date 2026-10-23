import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callToRow, syncAgentChats, type RetellCall } from '@/lib/retell'
import { ensureClientFolder, uploadTranscriptToDrive } from '@/lib/drive'
import { sendCallSummaryEmail, sendChatSummaryEmail, sendEmail } from '@/lib/email'
import { reportCallUsageOnce, reportChatUsageDeltas } from '@/lib/metering'
import { rowMessages } from '@/lib/usage'

export const maxDuration = 120

// Safety net for webhook failures (Vercel Cron, every 15 min on Pro): pulls
// recent calls from Retell (source of truth) for every pod, upserts anything
// the webhook missed, delivers the summary emails those calls should have
// produced, and alerts the admin that recovery happened so the root cause
// gets looked at. Lookback stays generous — recovery is idempotent.
const LOOKBACK_MS = 26 * 60 * 60 * 1000
// Recovery emails only for calls with an actual conversation; the live
// webhook path is untouched by this floor.
const MIN_EMAIL_SECONDS = 5
// Don't recovery-email conversations that ended moments ago — their
// call_analyzed/chat_analyzed webhook (which sends the real email) may still
// be in flight. Prevents double emails at 15-minute cron frequency.
const EMAIL_GRACE_MS = 15 * 60 * 1000
function endedLongAgo(startedAt: string | null, durationSeconds: number) {
  if (!startedAt) return true
  return Date.parse(startedAt) + durationSeconds * 1000 < Date.now() - EMAIL_GRACE_MS
}

export async function GET(request: NextRequest) {
  // Fail closed: without CRON_SECRET this endpoint would be callable by anyone
  // (120s of Retell calls, meter writes and client emails per hit). Vercel
  // sends the secret automatically once it is set in the project env.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[reconcile] CRON_SECRET is not set; refusing to run')
    return new NextResponse('cron secret not configured', { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const supabase = createAdminClient()
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, slug, rate_per_minute_cents, chat_rate_per_message_cents, retell_api_key, retell_agent_id, notification_email, drive_folder_id, ingest_mode, message_basis, stripe_customer_id, billing_starts_at')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voicedesk.sherpatech.ai'
  const adminEmail = process.env.ADMIN_SUMMARY_EMAIL
  const recovered: string[] = []
  const emailed: string[] = []
  const polled: string[] = []

  for (const client of clients ?? []) {
    const { data: pa } = await supabase
      .from('pod_agents')
      .select('retell_agent_id, label, channel')
      .eq('client_id', client.id)
    const chatAgents = (pa ?? []).filter((a) => a.channel === 'chat')
    // Voice agents only; list-calls is pointless for chat agents.
    const agentIds = new Set<string>(
      (pa ?? []).filter((a) => a.channel !== 'chat').map((a) => a.retell_agent_id)
    )
    if (client.retell_agent_id && !chatAgents.some((a) => a.retell_agent_id === client.retell_agent_id)) {
      agentIds.add(client.retell_agent_id)
    }
    const labelByAgent = new Map<string, string | null>(
      (pa ?? []).map((a) => [a.retell_agent_id, a.label ?? null])
    )
    if (agentIds.size === 0 && chatAgents.length === 0) continue

    const key = client.retell_api_key || process.env.RETELL_API_KEY!
    const cutoff = Date.now() - LOOKBACK_MS

    // ── Poll-mode pods ───────────────────────────────────────────────────
    // The agent's webhook belongs to another service (e.g. the WFWC Modal
    // transcript service), so this cron IS the ingestion path: pull every
    // chat in the window with its full transcript and message counts,
    // ongoing ones included. No "webhook missed" alert, no recovery email.
    if (client.ingest_mode === 'poll') {
      for (const a of chatAgents) {
        try {
          // Only chats that are new to us or still growing are fetched in
          // full; ended chats already stored are left alone.
          const { data: stored } = await supabase
            .from('calls')
            .select('retell_call_id, chat_status')
            .eq('client_id', client.id)
            .gte('started_at', new Date(cutoff).toISOString())
          const settled = new Set(
            (stored ?? []).filter((r) => r.chat_status === 'ended').map((r) => r.retell_call_id)
          )
          const ids = await syncAgentChats({
            agentId: a.retell_agent_id,
            key,
            clientId: client.id,
            ratePerMessageCents: client.chat_rate_per_message_cents ?? 0,
            basis: client.message_basis === 'all' ? 'all' : 'agent',
            agentLabel: a.label ?? null,
            sinceMs: cutoff,
            shouldFetch: (s) => !settled.has(s.chat_id),
            upsert: async (rows) => {
              const { data: saved, error } = await supabase
                .from('calls')
                .upsert(rows, { onConflict: 'retell_call_id' })
                .select('id, retell_call_id, message_count, user_message_count, started_at')
              if (error) throw new Error(error.message)
              // Stripe meter: report only what grew since the last poll.
              const sent = await reportChatUsageDeltas({
                supabase,
                client,
                rows: saved ?? [],
              })
              if (sent > 0) polled.push(`${client.slug}:metered+${sent}`)
            },
          })
          polled.push(`${client.slug}:${ids.length}`)
        } catch (e) {
          console.error('[reconcile] poll failed for', client.slug, a.retell_agent_id, e)
        }
      }
      continue
    }

    for (const agentId of agentIds) {
      let calls: RetellCall[] = []
      try {
        const res = await fetch('https://api.retellai.com/v3/list-calls', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter_criteria: { agent_id: [agentId] }, limit: 100 }),
          cache: 'no-store',
        })
        if (!res.ok) continue
        // v3 wraps the array: { items, pagination_key, has_more }
        const { items = [] } = (await res.json()) as { items?: RetellCall[] }
        calls = items.filter(
          (c) => c.call_status === 'ended' && (c.start_timestamp ?? 0) >= cutoff
        )
      } catch {
        continue
      }
      if (calls.length === 0) continue

      const { data: existing } = await supabase
        .from('calls')
        .select('retell_call_id, email_sent_at')
        .in('retell_call_id', calls.map((c) => c.call_id))
      const byId = new Map((existing ?? []).map((r) => [r.retell_call_id, r]))

      for (const call of calls) {
        const known = byId.get(call.call_id)
        const row = {
          ...callToRow(call, client.id, client.rate_per_minute_cents),
          agent_label: labelByAgent.get(agentId) ?? null,
        }

        if (!known) {
          const { data: saved, error } = await supabase
            .from('calls')
            .upsert(row, { onConflict: 'retell_call_id' })
            .select('id')
            .single()
          if (error) continue
          recovered.push(`${client.slug}/${call.call_id} (${row.duration_seconds}s)`)
          // The webhook would have metered this call on call_ended; do it here
          // (idempotent, so a late webhook delivery cannot bill it again).
          if (saved?.id) {
            await reportCallUsageOnce({
              supabase,
              client,
              call: {
                id: saved.id,
                retell_call_id: call.call_id,
                duration_seconds: row.duration_seconds,
                started_at: row.started_at,
              },
            })
          }
        }

        // Deliver the summary email the webhook should have sent.
        const needsEmail =
          client.notification_email &&
          !known?.email_sent_at &&
          row.transcript &&
          row.duration_seconds >= MIN_EMAIL_SECONDS &&
          endedLongAgo(row.started_at, row.duration_seconds)
        if (!needsEmail) continue

        try {
          let driveLink: string | null = null
          const folderId = client.drive_folder_id || (await ensureClientFolder(client.name))
          if (folderId && row.transcript) {
            driveLink = await uploadTranscriptToDrive({
              folderId,
              callId: call.call_id,
              startedAt: row.started_at ?? null,
              transcript: row.transcript,
            })
          }
          const toAddresses: string[] = [client.notification_email!]
          if (adminEmail && adminEmail !== client.notification_email) toAddresses.push(adminEmail)
          await sendCallSummaryEmail({
            to: toAddresses.length === 1 ? toAddresses[0] : toAddresses,
            clientName: client.name,
            callId: call.call_id,
            durationSeconds: row.duration_seconds,
            sentiment: call.call_analysis?.user_sentiment ?? null,
            fromNumber: row.from_number,
            transcript: row.transcript ?? null,
            recordingUrl: call.recording_url ?? null,
            driveLink,
            dashboardUrl: `${appUrl}/${client.slug}`,
          })
          await supabase
            .from('calls')
            .update({ email_sent_at: new Date().toISOString() })
            .eq('retell_call_id', call.call_id)
          emailed.push(`${client.slug}/${call.call_id}`)
        } catch (e) {
          console.error('[reconcile] recovery email failed', call.call_id, e)
        }
      }
    }

    // Chats (webhook-mode pods): same safety net, per chat agent. list-chats
    // carries no transcript or messages, so syncAgentChats fetches each chat
    // the webhook missed in full. Only ended chats are recovered here (the
    // webhook delivers chat_ended / chat_analyzed); nothing already stored
    // is re-fetched.
    const basis = client.message_basis === 'all' ? 'all' : 'agent'
    for (const a of chatAgents) {
      try {
        const { data: existingChats } = await supabase
          .from('calls')
          .select('retell_call_id, email_sent_at')
          .eq('client_id', client.id)
          .gte('started_at', new Date(cutoff).toISOString())
        const knownChat = new Map((existingChats ?? []).map((r) => [r.retell_call_id, r]))

        await syncAgentChats({
          agentId: a.retell_agent_id,
          key,
          clientId: client.id,
          ratePerMessageCents: client.chat_rate_per_message_cents ?? 0,
          basis,
          agentLabel: a.label ?? null,
          sinceMs: cutoff,
          shouldFetch: (s) => s.chat_status === 'ended' && !knownChat.has(s.chat_id),
          upsert: async (rows) => {
            const { data: saved, error } = await supabase
              .from('calls')
              .upsert(rows, { onConflict: 'retell_call_id' })
              .select('id, retell_call_id, message_count, user_message_count, started_at')
            if (error) throw new Error(error.message)
            for (const r of saved ?? []) {
              recovered.push(`${client.slug}/chat/${r.retell_call_id} (${rowMessages({ ...r, call_type: 'chat' }, basis)} msgs)`)
            }
            await reportChatUsageDeltas({ supabase, client, rows: saved ?? [] })

            // Deliver the summary email the webhook should have sent.
            if (!client.notification_email) return
            for (const row of rows) {
              const metered = rowMessages({ ...row }, basis)
              const needsEmail =
                row.transcript &&
                metered >= 2 &&
                endedLongAgo(row.started_at, row.duration_seconds)
              if (!needsEmail) continue
              const chat = row.raw
              try {
                let driveLink: string | null = null
                const folderId = client.drive_folder_id || (await ensureClientFolder(client.name))
                if (folderId && row.transcript) {
                  driveLink = await uploadTranscriptToDrive({
                    folderId,
                    callId: row.retell_call_id,
                    startedAt: row.started_at ?? null,
                    transcript: row.transcript,
                  })
                }
                const toAddresses: string[] = [client.notification_email]
                if (adminEmail && adminEmail !== client.notification_email) toAddresses.push(adminEmail)
                await sendChatSummaryEmail({
                  to: toAddresses.length === 1 ? toAddresses[0] : toAddresses,
                  clientName: client.name,
                  chatId: row.retell_call_id,
                  messageCount: metered,
                  durationSeconds: row.duration_seconds,
                  sentiment: chat.chat_analysis?.user_sentiment ?? null,
                  summary: chat.chat_analysis?.chat_summary ?? null,
                  transcript: row.transcript ?? null,
                  driveLink,
                  dashboardUrl: `${appUrl}/${client.slug}`,
                })
                await supabase
                  .from('calls')
                  .update({ email_sent_at: new Date().toISOString() })
                  .eq('retell_call_id', row.retell_call_id)
                emailed.push(`${client.slug}/chat/${row.retell_call_id}`)
              } catch (e) {
                console.error('[reconcile] chat recovery email failed', row.retell_call_id, e)
              }
            }
          },
        })
      } catch (e) {
        console.error('[reconcile] chat recovery failed for', client.slug, a.retell_agent_id, e)
      }
    }
  }

  // Recovery means webhooks failed silently — tell the admin to check why.
  if (adminEmail && (recovered.length || emailed.length)) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: `VoiceDesk safety net recovered ${recovered.length || emailed.length} call(s)`,
        heading: 'Webhook deliveries were missed',
        intro:
          'The 15-minute reconciliation found calls in Retell that the webhook never delivered. ' +
          'They have been ingested and their summary emails sent, but the webhook itself needs attention — ' +
          'check the Retell webhook badge (Settings → API Keys) and Vercel logs for "[webhook] signature rejected".',
        bodyHtml: [
          recovered.length ? `<strong>Ingested:</strong> ${recovered.join(', ')}` : '',
          emailed.length ? `<strong>Emails delivered:</strong> ${emailed.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('<br/>'),
        ctaText: 'Open admin dashboard',
        ctaUrl: `${appUrl}/admin`,
      })
    } catch (e) {
      console.error('[reconcile] admin alert failed', e)
    }
  }

  return NextResponse.json({ recovered: recovered.length, emailed: emailed.length, polled })
}
