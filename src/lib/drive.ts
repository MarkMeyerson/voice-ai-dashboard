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

// Uploads a transcript .txt to Supabase Storage and returns a public URL.
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

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl ?? null
}
