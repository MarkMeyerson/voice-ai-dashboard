'use client'

import { useTransition } from 'react'
import { deleteClientPod } from '@/app/admin/pod-actions'

export function DeletePodButton({
  clientId,
  name,
}: {
  clientId: string
  name: string
}) {
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          window.confirm(
            `Delete "${name}"? This permanently removes the pod and ALL its imported calls, agents, invoices and logins. This cannot be undone.`
          )
        ) {
          start(() => deleteClientPod(clientId))
        }
      }}
      className="border border-red-300 px-4 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60"
    >
      {pending ? 'Deleting…' : 'Delete pod'}
    </button>
  )
}
