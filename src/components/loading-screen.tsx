// Calm Zen loading state — a spinning ensō.
export function LoadingScreen() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-paper">
      <div className="flex flex-col items-center gap-4">
        <svg viewBox="0 0 48 48" className="h-10 w-10 animate-spin [animation-duration:1.4s]" fill="none">
          <path
            d="M33 11.5 C28 8.5 20 8 14.5 12.5 C8 17.5 8 30 14.5 35.5 C21 41 33 40 38 33.5"
            stroke="var(--color-seal)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted">Loading</p>
      </div>
    </div>
  )
}
