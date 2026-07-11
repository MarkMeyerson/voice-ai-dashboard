import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callToRow, chatToRow, listChats, type RetellCall } from '@/lib/retell'
import { ensureClientFolder, uploadTranscriptToDrive } from '@/lib/drive'
import { sendCallSummaryEmail, sendChatSummaryEmail, sendEmail } from '@/lib/email'

export const maxDuration = 60

// Safety net for webhook failures (Vercel Cron, daily): pulls recent calls
// from Retell (source of truth) for every pod, upserts anything the webhook
// missed, delivers the summary emails those calls should have produced, and
// alerts the admin that recovery happened so the root cause gets looked at.
const LOOKBACK_MS = 26 * 60 * 60 * 1000
// Recovery emails only for calls with an actual conversation; the live
// webhook path is untouched by this floor.
const MIN_EMAIL_SECONDS = 5

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const supabase = createAdminClient()
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, slug, rate_per_minute_cents, chat_rate_per_message_cents, retell_api_key, retell_agent_id, notification_email, drive_folder_id')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voicedesk-one.vercel.app'
  const adminEmail = process.env.ADMIN_SUMMARY_EMAIL
  const recovered: string[] = []
  const emailed: string[] = []

  for (const client of clients ?? []) {
    const { data: pa } = await supabase
      .from('pod_agents')
      .select('retell_agent_id')
      .eq('client_id', client.id)
    const agentIds = new Set<string>((pa ?? []).map((a) => a.retell_agent_id))
    if (client.retell_agent_id) agentIds.add(client.retell_agent_id)
    if (agentIds.size === 0) continue

    const key = client.retell_api_key || process.env.RETELL_API_KEY!
    const cutoff = Date.now() - LOOKBACK_MS

    for (const agentId of agentIds) {
      let calls: RetellCall[] = []
      try {
        const res = await fetch('https://api.retellai.com/v2/list-calls', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter_criteria: { agent_id: [agentId] }, limit: 100 }),
          cache: 'no-store',
        })
        if (!res.ok) continue
        calls = ((await res.json()) as RetellCall[]).filter(
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
        const row = callToRow(call, client.id, client.rate_per_minute_cents)

        if (!known) {
          const { error } = await supabase
            .from('calls')
            .upsert(row, { onConflict: 'retell_call_id' })
          if (error) continue
          recovered.push(`${client.slug}/${call.call_id} (${row.duration_seconds}s)`)
        }

        // Deliver the summary email the webhook should have sent.
        const needsEmail =
          client.notification_email &&
          !known?.email_sent_at &&
          row.transcript &&
          row.duration_seconds >= MIN_EMAIL_SECONDS
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

    // Chats: same safety net. One workspace listing, filtered to this pod's agents.
    try {
      const chats = (await listChats(key, 100)).filter(
        (c) =>
          agentIds.has(c.agent_id) &&
          c.chat_status === 'ended' &&
          (c.start_timestamp ?? 0) >= cutoff
      )
      if (chats.length > 0) {
        const { data: existingChats } = await supabase
          .from('calls')
          .select('retell_call_id, email_sent_at')
          .in('retell_call_id', chats.map((c) => c.chat_id))
        const chatById = new Map((existingChats ?? []).map((r) => [r.retell_call_id, r]))

        for (const c of chats) {
          const known = chatById.get(c.chat_id)
          const row = chatToRow(c, client.id, client.chat_rate_per_message_cents ?? 0)

          if (!known) {
            const { error } = await supabase
              .from('calls')
              .upsert(row, { onConflict: 'retell_call_id' })
            if (error) continue
            recovered.push(`${client.slug}/chat/${c.chat_id} (${row.message_count} msgs)`)
          }

          const needsEmail =
            client.notification_email &&
            !known?.email_sent_at &&
            row.transcript &&
            row.message_count >= 2
          if (!needsEmail) continue

          try {
            let driveLink: string | null = null
            const folderId = client.drive_folder_id || (await ensureClientFolder(client.name))
            if (folderId && row.transcript) {
              driveLink = await uploadTranscriptToDrive({
                folderId,
                callId: c.chat_id,
                startedAt: row.started_at ?? null,
                transcript: row.transcript,
              })
            }
            const toAddresses: string[] = [client.notification_email!]
            if (adminEmail && adminEmail !== client.notification_email) toAddresses.push(adminEmail)
            await sendChatSummaryEmail({
              to: toAddresses.length === 1 ? toAddresses[0] : toAddresses,
              clientName: client.name,
              chatId: c.chat_id,
              messageCount: row.message_count,
              durationSeconds: row.duration_seconds,
              sentiment: c.chat_analysis?.user_sentiment ?? null,
              summary: c.chat_analysis?.chat_summary ?? null,
              transcript: row.transcript ?? null,
              driveLink,
              dashboardUrl: `${appUrl}/${client.slug}`,
            })
            await supabase
              .from('calls')
              .update({ email_sent_at: new Date().toISOString() })
              .eq('retell_call_id', c.chat_id)
            emailed.push(`${client.slug}/chat/${c.chat_id}`)
          } catch (e) {
            console.error('[reconcile] chat recovery email failed', c.chat_id, e)
          }
        }
      }
    } catch (e) {
      console.error('[reconcile] chat listing failed for', client.slug, e)
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
          'The daily reconciliation found calls in Retell that the webhook never delivered. ' +
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

  return NextResponse.json({ recovered: recovered.length, emailed: emailed.length })
}
