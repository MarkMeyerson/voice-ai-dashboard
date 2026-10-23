import { createClient } from '@supabase/supabase-js'

const BUCKET = 'call-transcripts'

function getStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

// Returns a slug used as the storage path prefix for this client.
export async function ensureClientFolder(clientName: string): Promise<string | null> {
  return clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Emailed transcript links expire after this long. The bucket must be PRIVATE
// (Supabase → Storage → call-transcripts → settings); transcripts are customer
// conversations and the path is guessable, so a public bucket leaks them.
const SIGNED_URL_SECONDS = 7 * 24 * 3600

// Uploads a transcript .txt to Supabase Storage and returns a signed URL that
// works for a week without a login.
export async function uploadTranscriptToDrive(opts: {
  folderId: string
  callId: string
  startedAt: string | null
  transcript: string
}): Promise<string | null> {
  const supabase = getStorageClient()
  if (!supabase) return null

  const date = opts.startedAt
    ? opts.startedAt.split('T')[0]
    : new Date().toISOString().split('T')[0]
  const path = `${opts.folderId}/${date}-${opts.callId}.txt`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, opts.transcript, { contentType: 'text/plain', upsert: true })

  if (error) {
    console.error('[storage] upload failed', error)
    return null
  }

  const { data, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS)
  if (signError) {
    console.error('[storage] sign failed', signError)
    return null
  }
  return data?.signedUrl ?? null
}
