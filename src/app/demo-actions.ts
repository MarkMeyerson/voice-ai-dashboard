'use server'

import { sendEmail } from '@/lib/email'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export type DemoRequestState = { ok: boolean; error?: string } | null

// Sends "someone wants a demo" to Mark. Public-facing: honeypot for bots,
// strict length caps, no data stored.
export async function requestDemo(
  _prev: DemoRequestState,
  formData: FormData
): Promise<DemoRequestState> {
  // Honeypot: real users never see or fill this field.
  if (String(formData.get('company') ?? '').length > 0) return { ok: true }

  const email = String(formData.get('email') ?? '').trim().slice(0, 200)
  const name = String(formData.get('name') ?? '').trim().slice(0, 120)

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: 'Please enter a valid email address.' }
  }

  try {
    await sendEmail({
      to:
        process.env.DEMO_REQUEST_EMAIL ||
        process.env.ADMIN_SUMMARY_EMAIL ||
        'mark@sherpatech.ai',
      subject: 'VoiceDesk demo request',
      heading: 'Someone wants a demo',
      intro: `${name ? escapeHtml(name) : 'A visitor'} asked to try a free VoiceDesk demo.`,
      bodyHtml: `<strong>Email:</strong> ${escapeHtml(email)}${
        name ? `<br/><strong>Name:</strong> ${escapeHtml(name)}` : ''
      }<br/><strong>From:</strong> the VoiceDesk landing page`,
    })
    return { ok: true }
  } catch (e) {
    console.error('[demo] request email failed', e)
    return {
      ok: false,
      error: 'Could not send right now — email mark@sherpatech.ai directly.',
    }
  }
}
