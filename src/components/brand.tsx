// Ensō — the Zen brush circle. Drawn slightly open, with a vermilion seal dot.
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={`h-9 w-9 ${className}`}
      fill="none"
      aria-hidden
    >
      <path
        d="M33 11.5 C28 8.5 20 8 14.5 12.5 C8 17.5 8 30 14.5 35.5 C21 41 33 40 38 33.5 C41.5 29 41 22 36.5 18"
        stroke="var(--color-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="36.5" cy="16.5" r="2.6" fill="var(--color-seal)" />
    </svg>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Logo />
      <span className="font-serif text-[17px] font-semibold tracking-tight text-ink">
        Voice<span className="text-seal">Desk</span>
      </span>
    </div>
  )
}
