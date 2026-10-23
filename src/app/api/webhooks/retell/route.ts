import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  verifyRetellSignature,
  callToRow,
  chatToRow,
  type RetellCall,
  type RetellChat,
} from '@/lib/retell'
import { reportCallUsageOnce, reportChatUsageDeltas } from '@/lib/metering'
import { ensureClientFolder, uploadTranscriptToDrive } from '@/lib/drive'
import { sendCallSummaryEmail, sendChatSummaryEmail } from '@/lib/email'

// Receives live VOICE (call_*) and CHAT (chat_*) events from Retell across
// MANY agents / Retell accounts. A pod can own multiple agents; each pod can
// use its own Retell API key. Idempotent on retell_call_id (= chat_id for chats).
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const signature = request.headers.get('x-retell-signature')

  let parsed: { event?: string; call?: RetellCall; chat?: RetellChat }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new NextResponse('bad payload', { status: 400 })
  }
  const { event, call, chat } = parsed
  const agentId = call?.agent_id ?? chat?.agent_id
  if (!agentId) return NextResponse.json({ ignored: 'no agent' })

  const supabase = createAdminClient()

  // Resolve the pod: first via the pod_agents map, then legacy single-agent field.
  let client:
    | {
        id: string
        name: string
        slug: string
        rate_per_minute_cents: number
        chat_rate_per_message_cents: number | null
        message_basis: string | null
        billing_starts_at: string | null
        stripe_customer_id: string | null
        retell_api_key: string | null
        notification_email: string | null
        drive_folder_id: string | null
      }
    | null = null

  const { data: pa } = await supabase
    .from('pod_agents')
    .select('client_id, label')
    .eq('retell_agent_id', agentId)
    .maybeSingle()

  const clientId = pa?.client_id ?? null
  // Optional per-agent label ("Personal assistant", "Website chat") shown on
  // the dashboard and in email subjects to tell agents on one pod apart.
  const agentLabel: string | null = pa?.label ?? null
  const q = supabase
    .from('clients')
    .select(
      'id, name, slug, rate_per_minute_cents, chat_rate_per_message_cents, message_basis, billing_starts_at, stripe_customer_id, retell_api_key, notification_email, drive_folder_id'
    )
  const { data } = clientId
    ? await q.eq('id', clientId).maybeSingle()
    : await q.eq('retell_agent_id', agentId).maybeSingle()
  client = data

  if (!client) return NextResponse.json({ skipped: 'no pod for agent' })

  // Verify with the pod's own Retell key, falling back to the global key.
  // Retell signs with the workspace API key holding the "webhook" badge
  // (Retell dashboard → Settings → API Keys) — keep that badge on the key
  // stored here or every delivery 401s.
  const candidateKeys = [client.retell_api_key, process.env.RETELL_API_KEY].filter(
    (k): k is string => Boolean(k)
  )
  if (!candidateKeys.some((k) => verifyRetellSignature(raw, signature, k))) {
    console.error(
      `[webhook] signature rejected: agent=${agentId} event=${event} ` +
        `header=${signature ? signature.slice(0, 24) + '…' : 'MISSING'} ` +
        `keys_tried=${candidateKeys.map((k) => k.slice(0, 12)).join(',')}`
    )
    return new NextResponse('invalid signature', { status: 401 })
  }

  // ── CHAT events ────────────────────────────────────────────────────────
  if (chat) {
    if (event !== 'chat_ended' && event !== 'chat_analyzed') {
      return NextResponse.json({ ignored: event })
    }

    const basis = client.message_basis === 'all' ? 'all' : 'agent'
    const row = {
      ...chatToRow(chat, client.id, client.chat_rate_per_message_cents ?? 0, basis),
      agent_label: agentLabel,
    }
    const { data: upserted, error } = await supabase
      .from('calls')
      .upsert(row, { onConflict: 'retell_call_id' })
      .select('id, email_sent_at')
      .single()
    if (error) return new NextResponse(error.message, { status: 500 })

    // Bill the chat's messages (delta-based and idempotent, so a chat_ended
    // retry or a later cron pass cannot double-report).
    if (event === 'chat_ended' && upserted?.id) {
      await reportChatUsageDeltas({
        supabase,
        client,
        rows: [
          {
            id: upserted.id,
            retell_call_id: chat.chat_id,
            message_count: row.message_count,
            user_message_count: row.user_message_count,
            started_at: row.started_at,
          },
        ],
      })
    }

    // Transcript archive + chat summary email — fires on chat_analyzed, once.
    if (event === 'chat_analyzed' && client.notification_email && !upserted?.email_sent_at) {
      try {
        let folderId = client.drive_folder_id
        if (!folderId) {
          folderId = await ensureClientFolder(client.name)
          if (folderId) {
            await supabase
              .from('clients')
              .update({ drive_folder_id: folderId })
              .eq('id', client.id)
          }
        }

        let driveLink: string | null = null
        if (folderId && row.transcript) {
          driveLink = await uploadTranscriptToDrive({
            folderId,
            callId: chat.chat_id,
            startedAt: row.started_at ?? null,
            transcript: row.transcript,
          })
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voicedesk.sherpatech.ai'
        const adminEmail = process.env.ADMIN_SUMMARY_EMAIL
        const toAddresses: string[] = [client.notification_email]
        if (adminEmail && adminEmail !== client.notification_email) toAddresses.push(adminEmail)
        await sendChatSummaryEmail({
          to: toAddresses.length === 1 ? toAddresses[0] : toAddresses,
          clientName: agentLabel ? `${client.name} · ${agentLabel}` : client.name,
          chatId: chat.chat_id,
          messageCount: basis === 'all' ? row.message_count + row.user_message_count : row.message_count,
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
          .eq('id', upserted.id)
      } catch (e) {
        console.error('[chat email] summary failed', e)
      }
    }

    return new NextResponse(null, { status: 204 })
  }

  // ── VOICE events ───────────────────────────────────────────────────────
  if (!call) return NextResponse.json({ ignored: 'no call' })

  if (event !== 'call_ended' && event !== 'call_analyzed') {
    return NextResponse.json({ ignored: event })
  }

  const row = {
    ...callToRow(call, client.id, client.rate_per_minute_cents),
    agent_label: agentLabel,
  }
  const { data: upserted, error } = await supabase
    .from('calls')
    .upsert(row, { onConflict: 'retell_call_id' })
    .select('id, email_sent_at')
    .single()
  if (error) return new NextResponse(error.message, { status: 500 })

  // Report usage to Stripe on call_ended, exactly once per call.
  if (event === 'call_ended' && upserted?.id) {
    await reportCallUsageOnce({
      supabase,
      client,
      call: {
        id: upserted.id,
        retell_call_id: call.call_id,
        duration_seconds: row.duration_seconds,
        started_at: row.started_at,
      },
    })
  }

  // Transcript archive + call summary email — fires on call_analyzed, once
  // (a replayed delivery must not re-send it).
  if (event === 'call_analyzed' && client.notification_email && !upserted?.email_sent_at) {
    try {
      let folderId = client.drive_folder_id

      if (!folderId) {
        folderId = await ensureClientFolder(client.name)
        if (folderId) {
          await supabase
            .from('clients')
            .update({ drive_folder_id: folderId })
            .eq('id', client.id)
        }
      }

      let driveLink: string | null = null
      if (folderId && row.transcript) {
        driveLink = await uploadTranscriptToDrive({
          folderId,
          callId: call.call_id,
          startedAt: row.started_at ?? null,
          transcript: row.transcript,
        })
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://voicedesk.sherpatech.ai'
      const adminEmail = process.env.ADMIN_SUMMARY_EMAIL
      const toAddresses: string[] = [client.notification_email]
      if (adminEmail && adminEmail !== client.notification_email) toAddresses.push(adminEmail)
      await sendCallSummaryEmail({
        to: toAddresses.length === 1 ? toAddresses[0] : toAddresses,
        clientName: agentLabel ? `${client.name} · ${agentLabel}` : client.name,
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
        .eq('id', upserted.id)
    } catch (e) {
      console.error('[drive/email] call summary failed', e)
    }
  }

  return new NextResponse(null, { status: 204 })
}
