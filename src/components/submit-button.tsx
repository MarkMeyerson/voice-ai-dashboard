'use client'

import { useFormStatus } from 'react-dom'

// Submit button that shows a pending state while its form's action runs.
export function SubmitButton({
  children,
  pendingText = 'Working…',
  className,
}: {
  children: React.ReactNode
  pendingText?: string
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  )
}
