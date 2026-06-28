import { google } from 'googleapis'

function getDriveAuth() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!json) return null
  try {
    const creds = JSON.parse(json)
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    })
  } catch {
    return null
  }
}

// Find or create a named subfolder under the optional root folder.
// Returns null if Drive is not configured.
export async function ensureClientFolder(clientName: string): Promise<string | null> {
  const auth = getDriveAuth()
  if (!auth) return null

  const drive = google.drive({ version: 'v3', auth })
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  const safeName = clientName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const parentClause = rootId ? ` and '${rootId}' in parents` : ''
  const q = `name='${safeName}' and mimeType='application/vnd.google-apps.folder'${parentClause} and trashed=false`

  const { data } = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 })
  if (data.files?.length) return data.files[0].id!

  const { data: folder } = await drive.files.create({
    requestBody: {
      name: clientName,
      mimeType: 'application/vnd.google-apps.folder',
      ...(rootId ? { parents: [rootId] } : {}),
    },
    fields: 'id',
  })
  return folder.id ?? null
}

// Upload a transcript .txt file into the given Drive folder.
// Returns the web view link, or null on failure.
export async function uploadTranscriptToDrive(opts: {
  folderId: string
  callId: string
  startedAt: string | null
  transcript: string
}): Promise<string | null> {
  const auth = getDriveAuth()
  if (!auth) return null

  const drive = google.drive({ version: 'v3', auth })
  const date = opts.startedAt
    ? opts.startedAt.split('T')[0]
    : new Date().toISOString().split('T')[0]
  const name = `${date}-${opts.callId}.txt`

  const { data } = await drive.files.create({
    requestBody: {
      name,
      parents: [opts.folderId],
      mimeType: 'text/plain',
    },
    media: {
      mimeType: 'text/plain',
      body: opts.transcript,
    },
    fields: 'id,webViewLink',
  })

  return data.webViewLink ?? null
}
