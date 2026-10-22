'use client'

import { startTransition, useState } from 'react'
import { fetchAgents, createClientPod, updateClientPod } from '@/app/admin/pod-actions'
import { SubmitButton } from '@/components/submit-button'

type Agent = { id: string; name: string; channel?: 'voice' | 'chat' }

type PodFormProps = {
  mode: 'create' | 'edit'
  initial?: {
    id: string
    name: string
    slug: string
    billingMode: string
    status: string
    rateDollars: string
    costDollars: string
    monthlyDollars: string
    retellApiKey: string
    notificationEmail: string
    agents: Agent[]
    users: { id: string; email: string }[]
    // chat plan
    channel?: 'voice' | 'chat'
    includedMessages?: string
    rateMessageDollars?: string
    messageBasis?: 'agent' | 'all'
    ingestMode?: 'webhook' | 'poll'
  }
}

export function PodForm(props: PodFormProps) {
  const { mode, initial } = props

  // ── core fields ──────────────────────────────────────────────────────────
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [billingMode, setBillingMode] = useState(initial?.billingMode ?? 'per_minute')
  const [status, setStatus] = useState(initial?.status ?? 'active')
  const [rateDollars, setRateDollars] = useState(initial?.rateDollars ?? '')
  const [costDollars, setCostDollars] = useState(initial?.costDollars ?? '')
  const [monthlyDollars, setMonthlyDollars] = useState(initial?.monthlyDollars ?? '')
  const [password, setPassword] = useState('')

  // ── chat plan ─────────────────────────────────────────────────────────────
  const [channel, setChannel] = useState<'voice' | 'chat'>(initial?.channel ?? 'voice')
  const [includedMessages, setIncludedMessages] = useState(initial?.includedMessages ?? '')
  const [rateMessageDollars, setRateMessageDollars] = useState(initial?.rateMessageDollars ?? '')
  const [messageBasis, setMessageBasis] = useState<'agent' | 'all'>(initial?.messageBasis ?? 'agent')
  const [ingestMode, setIngestMode] = useState<'webhook' | 'poll'>(initial?.ingestMode ?? 'webhook')
  const [skipStripe, setSkipStripe] = useState(false)

  // ── Retell / agents ───────────────────────────────────────────────────────
  const [retellApiKey, setRetellApiKey] = useState(initial?.retellApiKey ?? '')
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [agentFetchError, setAgentFetchError] = useState<string | null>(null)
  const [availableAgents, setAvailableAgents] = useState<Agent[]>(initial?.agents ?? [])
  // In edit mode the initial agents are pre-selected; in create mode nothing is.
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set(initial?.agents.map((a) => a.id) ?? [])
  )

  // ── notification email ────────────────────────────────────────────────────
  const [notificationEmail, setNotificationEmail] = useState(initial?.notificationEmail ?? '')

  // ── emails ────────────────────────────────────────────────────────────────
  // Each entry is either a "new" email (no id) or an existing user row.
  type EmailRow =
    | { kind: 'new'; value: string }
    | { kind: 'existing'; userId: string; email: string; removed: boolean }

  const buildInitialEmails = (): EmailRow[] => {
    if (mode === 'edit' && initial?.users && initial.users.length > 0) {
      return initial.users.map((u) => ({
        kind: 'existing' as const,
        userId: u.id,
        email: u.email,
        removed: false,
      }))
    }
    return [{ kind: 'new', value: '' }]
  }

  const [emailRows, setEmailRows] = useState<EmailRow[]>(buildInitialEmails)

  // ── helpers ───────────────────────────────────────────────────────────────
  function toggleAgent(agent: Agent) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev)
      if (next.has(agent.id)) {
        next.delete(agent.id)
      } else {
        next.add(agent.id)
      }
      return next
    })
  }

  function handleLoadAgents() {
    setAgentFetchError(null)
    setLoadingAgents(true)
    startTransition(() => {
      fetchAgents(retellApiKey.trim())
        .then((result) => {
          if (result.error) {
            setAgentFetchError(result.error)
          } else {
            const fetched = result.agents ?? []
            // Merge fetched agents with any already in the list (avoid dupes)
            setAvailableAgents((prev) => {
              const existingIds = new Set(prev.map((a) => a.id))
              return [...prev, ...fetched.filter((a) => !existingIds.has(a.id))]
            })
          }
        })
        .catch((err: unknown) => {
          setAgentFetchError(err instanceof Error ? err.message : 'Failed to load agents')
        })
        .finally(() => setLoadingAgents(false))
    })
  }

  function addEmailRow() {
    setEmailRows((prev) => [...prev, { kind: 'new', value: '' }])
  }

  function updateNewEmail(index: number, value: string) {
    setEmailRows((prev) =>
      prev.map((row, i) => (i === index && row.kind === 'new' ? { ...row, value } : row))
    )
  }

  function removeRow(index: number) {
    setEmailRows((prev) =>
      prev
        .map((row, i) => {
          if (i !== index) return row
          if (row.kind === 'existing') return { ...row, removed: true }
          return null
        })
        .filter((row): row is EmailRow => row !== null)
    )
  }

  function restoreRow(index: number) {
    setEmailRows((prev) =>
      prev.map((row, i) =>
        i === index && row.kind === 'existing' ? { ...row, removed: false } : row
      )
    )
  }

  // ── submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData()
    fd.set('channel', channel)
    fd.set('included_messages', includedMessages)
    fd.set('rate_per_message', rateMessageDollars)
    fd.set('message_basis', messageBasis)
    fd.set('ingest_mode', ingestMode)

    if (mode === 'create') {
      fd.set('skip_stripe', skipStripe ? '1' : '0')
      fd.set('name', name)
      fd.set('slug', slug)
      fd.set('retell_api_key', retellApiKey)
      fd.set('billing_mode', billingMode)
      fd.set('rate_per_minute', rateDollars)
      fd.set('cost_per_minute', costDollars)
      fd.set('monthly_price', monthlyDollars)
      fd.set('password', password)
      fd.set('notification_email', notificationEmail)

      const selectedAgents = availableAgents.filter((a) => selectedAgentIds.has(a.id))
      fd.set('agents', JSON.stringify(selectedAgents))

      const newEmails = emailRows
        .filter((r): r is Extract<EmailRow, { kind: 'new' }> => r.kind === 'new')
        .map((r) => r.value.trim())
        .filter(Boolean)
      fd.set('emails', JSON.stringify(newEmails))

      await createClientPod(fd)
    } else {
      if (!initial) return
      fd.set('client_id', initial.id)
      fd.set('slug', initial.slug)
      fd.set('name', name)
      fd.set('retell_api_key', retellApiKey)
      fd.set('billing_mode', billingMode)
      fd.set('status', status)
      fd.set('rate_per_minute', rateDollars)
      fd.set('cost_per_minute', costDollars)
      fd.set('monthly_price', monthlyDollars)

      const initialAgentIds = new Set(initial.agents.map((a) => a.id))
      const addedAgents = availableAgents.filter(
        (a) => selectedAgentIds.has(a.id) && !initialAgentIds.has(a.id)
      )
      const removedAgentIds = initial.agents
        .filter((a) => !selectedAgentIds.has(a.id))
        .map((a) => a.id)
      fd.set('add_agents', JSON.stringify(addedAgents))
      fd.set('remove_agent_ids', JSON.stringify(removedAgentIds))
      fd.set('notification_email', notificationEmail)

      const addedEmails = emailRows
        .filter((r): r is Extract<EmailRow, { kind: 'new' }> => r.kind === 'new')
        .map((r) => r.value.trim())
        .filter(Boolean)
      const removedUserIds = emailRows
        .filter((r): r is Extract<EmailRow, { kind: 'existing' }> => r.kind === 'existing' && r.removed)
        .map((r) => r.userId)
      fd.set('add_emails', JSON.stringify(addedEmails))
      fd.set('remove_user_ids', JSON.stringify(removedUserIds))

      await updateClientPod(fd)
    }
  }

  // ── shared input className ─────────────────────────────────────────────────
  const inputCls =
    'w-full border-b border-ink/20 bg-transparent pb-2 text-sm text-ink outline-none focus:border-seal transition-colors'
  const labelCls = 'text-[11px] uppercase tracking-[0.2em] text-muted'

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e)
      }}
      className="space-y-10"
    >
      {/* ── Client name ──────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className={labelCls}>Client name</label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Corp"
          className={inputCls}
        />
      </div>

      {/* ── URL slug ─────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className={labelCls}>URL slug</label>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="auto from name"
          className={inputCls}
        />
      </div>

      {/* ── Status (edit only) ───────────────────────────────────────────── */}
      {mode === 'edit' && (
        <div className="space-y-1">
          <label className={labelCls}>Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inputCls}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      )}

      {/* ── Channel ──────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className={labelCls}>Plan type</label>
        <select
          value={channel}
          onChange={(e) => {
            const next = e.target.value === 'chat' ? 'chat' : 'voice'
            setChannel(next)
            if (next === 'chat' && mode === 'create') setBillingMode('monthly_plus_usage')
          }}
          className={inputCls}
        >
          <option value="voice">Voice (calls and minutes)</option>
          <option value="chat">Chat (conversations and messages)</option>
        </select>
        <p className="text-[11px] text-muted">
          Sets the words the client sees: calls and minutes, or conversations and messages.
        </p>
      </div>

      {/* ── Billing mode ─────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className={labelCls}>Billing mode</label>
        <select
          value={billingMode}
          onChange={(e) => setBillingMode(e.target.value)}
          className={inputCls}
        >
          <option value="per_minute">Per minute</option>
          <option value="monthly_plus_usage">Monthly retainer + usage</option>
        </select>
      </div>

      {/* ── Chat plan ─────────────────────────────────────────────────────── */}
      {channel === 'chat' && (
        <div className="space-y-6 border border-ink/15 bg-paper p-5">
          <p className={labelCls}>Message plan</p>
          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className={labelCls}>Monthly $</label>
              <input
                type="number"
                min="0"
                step="1"
                value={monthlyDollars}
                onChange={(e) => setMonthlyDollars(e.target.value)}
                placeholder="250"
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Included msgs / mo</label>
              <input
                type="number"
                min="0"
                step="1"
                value={includedMessages}
                onChange={(e) => setIncludedMessages(e.target.value)}
                placeholder="2000"
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Over $/msg</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateMessageDollars}
                onChange={(e) => setRateMessageDollars(e.target.value)}
                placeholder="0.04"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className={labelCls}>What counts as a message</label>
              <select
                value={messageBasis}
                onChange={(e) => setMessageBasis(e.target.value === 'all' ? 'all' : 'agent')}
                className={inputCls}
              >
                <option value="agent">Assistant replies only</option>
                <option value="all">Assistant replies + user messages</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>How chats arrive</label>
              <select
                value={ingestMode}
                onChange={(e) => setIngestMode(e.target.value === 'poll' ? 'poll' : 'webhook')}
                className={inputCls}
              >
                <option value="webhook">Agent webhook points here</option>
                <option value="poll">Pull every 15 min (webhook used elsewhere)</option>
              </select>
            </div>
          </div>
          <p className="text-[11px] text-muted">
            Pull mode leaves the agent&apos;s webhook alone and counts ongoing chats too.
            Usage is metered from the first message; the allowance is applied at billing.
          </p>
        </div>
      )}

      {/* ── Rate / Cost / Monthly ─────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-6">
        <div className="space-y-1">
          <label className={labelCls}>Rate $/min</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={rateDollars}
            onChange={(e) => setRateDollars(e.target.value)}
            placeholder="0.40"
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Cost $/min</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={costDollars}
            onChange={(e) => setCostDollars(e.target.value)}
            placeholder="0.15"
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Monthly $</label>
          <input
            type="number"
            min="0"
            step="1"
            value={monthlyDollars}
            onChange={(e) => setMonthlyDollars(e.target.value)}
            placeholder="0"
            className={inputCls}
          />
        </div>
      </div>

      {/* ── Retell API key + agent loader ─────────────────────────────────── */}
      <div className="space-y-4">
        <div className="space-y-1">
          <label className={labelCls}>Retell API key</label>
          <div className="flex items-end gap-4">
            <input
              type="text"
              value={retellApiKey}
              onChange={(e) => setRetellApiKey(e.target.value)}
              placeholder="key_…"
              className={`${inputCls} flex-1`}
            />
            <button
              type="button"
              onClick={handleLoadAgents}
              disabled={loadingAgents}
              className="shrink-0 border-b border-ink/20 pb-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              {loadingAgents ? 'Loading…' : 'Load agents'}
            </button>
          </div>
          <p className="text-[11px] text-muted">
            Leave blank to use the workspace key and list its voice and chat agents.
          </p>
        </div>

        {agentFetchError && (
          <p className="text-[11px] text-seal">{agentFetchError}</p>
        )}

        {availableAgents.length > 0 && (
          <div className="space-y-2">
            <p className={labelCls}>Select agents</p>
            <div className="divide-y divide-ink/10 rounded-none border border-ink/15 bg-paper">
              {availableAgents.map((agent) => {
                const checked = selectedAgentIds.has(agent.id)
                return (
                  <label
                    key={agent.id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-card"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center border transition-colors ${
                        checked
                          ? 'border-seal bg-seal'
                          : 'border-ink/30 bg-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      {checked && (
                        <svg
                          viewBox="0 0 10 10"
                          className="h-2.5 w-2.5 text-card"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="1.5,5 4,7.5 8.5,2" />
                        </svg>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggleAgent(agent)}
                    />
                    <span className="text-sm text-ink">{agent.name}</span>
                    {agent.channel && (
                      <span className="border border-ink/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-muted">
                        {agent.channel}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-muted">{agent.id}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Notification email ───────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className={labelCls}>Call summary email</label>
        <input
          type="email"
          value={notificationEmail}
          onChange={(e) => setNotificationEmail(e.target.value)}
          placeholder="drthomas@example.com"
          className={inputCls}
        />
        <p className="text-[11px] text-muted">
          Receives a summary email with transcript and recording link after each call.
        </p>
      </div>

      {/* ── Client emails ────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className={labelCls}>Client logins</p>
        <div className="space-y-2">
          {emailRows.map((row, i) => {
            if (row.kind === 'existing') {
              return (
                <div key={row.userId} className="flex items-center gap-3">
                  <span
                    className={`flex-1 border-b pb-2 text-sm transition-colors ${
                      row.removed
                        ? 'border-ink/10 text-muted line-through'
                        : 'border-ink/20 text-ink'
                    }`}
                  >
                    {row.email}
                  </span>
                  {row.removed ? (
                    <button
                      type="button"
                      onClick={() => restoreRow(i)}
                      className="text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-ink"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="text-[11px] uppercase tracking-[0.2em] text-seal transition-colors hover:opacity-70"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )
            }

            return (
              <div key={`new-${i}`} className="flex items-center gap-3">
                <input
                  type="email"
                  value={row.value}
                  onChange={(e) => updateNewEmail(i, e.target.value)}
                  placeholder="client@example.com"
                  className={`${inputCls} flex-1`}
                />
                {emailRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="shrink-0 text-[11px] text-muted transition-colors hover:text-seal"
                    aria-label="Remove email"
                  >
                    ✕
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={addEmailRow}
          className="text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-ink"
        >
          + Add another email
        </button>
      </div>

      {/* ── Stripe (create only) ─────────────────────────────────────────── */}
      {mode === 'create' && (
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={skipStripe}
            onChange={(e) => setSkipStripe(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="block text-sm text-ink">Set up Stripe later</span>
            <span className="block text-[11px] text-muted">
              Creates the pod with no Stripe customer or subscription. Nothing is created in Stripe.
              Use this for chat plans, which need a tiered overage price attached by hand.
            </span>
          </span>
        </label>
      )}

      {/* ── Password (create only) ───────────────────────────────────────── */}
      {mode === 'create' && (
        <div className="space-y-1">
          <label className={labelCls}>Set a password</label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Blank = send email invite"
            className={inputCls}
          />
        </div>
      )}

      {/* ── Submit ───────────────────────────────────────────────────────── */}
      <div className="pt-4">
        <SubmitButton
          pendingText={mode === 'create' ? 'Creating…' : 'Saving…'}
          className="relative flex items-center gap-3 rounded-full bg-ink px-6 py-3 text-sm text-card transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-seal"
            aria-hidden="true"
          />
          {mode === 'create' ? 'Create pod' : 'Save changes'}
        </SubmitButton>
      </div>
    </form>
  )
}
