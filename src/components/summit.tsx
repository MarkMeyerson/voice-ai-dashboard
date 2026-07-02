// Landing-page art: the summit backdrop (Mark's reference peak reduced to its
// main lines) and the ensō emitting quiet sound rings. Pure SVG, server-safe.

// Fixed full-viewport mountain behind the page; content scrolls over it.
export function SummitBackdrop() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.06]"
      aria-hidden="true"
    >
      <svg
        viewBox="0 -36 1440 936"
        preserveAspectRatio="xMidYMin slice"
        className="block h-full w-full"
        fill="none"
        stroke="#211d15"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* main silhouette: sharp summit, jagged rock ridge left, long shoulder right */}
        <path
          d="M -60 656 C 120 606, 268 546, 396 470 C 478 421, 548 366, 600 306
             L 622 278 L 616 264 L 644 230 L 638 216 L 664 184
             C 684 158, 702 130, 716 106 C 722 96, 730 96, 736 106
             C 758 142, 786 186, 822 238 C 886 330, 968 428, 1064 520
             C 1180 630, 1330 726, 1500 806"
          strokeWidth="3.2"
        />
        {/* serac band on the left slope */}
        <path
          d="M 318 548 L 366 536 L 384 546 L 432 528 L 452 538 L 504 514 L 522 522 L 574 494"
          strokeWidth="2.2"
        />
        {/* central face line falling from below the summit */}
        <path
          d="M 728 132 C 748 208, 780 300, 826 396 C 850 446, 876 494, 904 540"
          strokeWidth="1.8"
        />
        {/* snowfield boundary on the left face */}
        <path d="M 612 322 C 638 380, 668 442, 704 504" strokeWidth="1.5" />
        {/* echo stroke on the right shoulder */}
        <path d="M 952 442 C 1010 510, 1074 578, 1146 644" strokeWidth="1.5" />
        {/* the seal marks the summit */}
        <circle cx="726" cy="98" r="4.5" fill="#b3402a" stroke="none" />
      </svg>
    </div>
  )
}

// The ensō emitting two dashed sound rings, gaps aligned with the brush opening.
export function EnsoPulse({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(24,24)">
        <path
          d="M33 11.5 C28 8.5 20 8 14.5 12.5 C8 17.5 8 30 14.5 35.5 C21 41 33 40 38 33.5 C41.5 29 41 22 36.5 18"
          stroke="var(--color-ink)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <circle cx="36.5" cy="16.5" r="2.6" fill="var(--color-seal)" />
      </g>
      <circle
        className="enso-ring-1"
        cx="48" cy="48" r="31"
        stroke="var(--color-navy)" strokeOpacity=".30" strokeWidth="1.8"
        strokeLinecap="round" strokeDasharray="152 43"
        transform="rotate(8.5 48 48)" fill="none"
      />
      <circle
        className="enso-ring-2"
        cx="48" cy="48" r="40"
        stroke="var(--color-navy)" strokeOpacity=".16" strokeWidth="1.5"
        strokeLinecap="round" strokeDasharray="202 49"
        transform="rotate(4 48 48)" fill="none"
      />
    </svg>
  )
}

// Parent-brand footer lockup, shared by every page.
export function PropertyFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`relative z-10 pb-6 pt-4 text-center ${className}`}>
      <span className="inline-flex items-center gap-2 text-xs font-medium text-navy opacity-85">
        <SherpaPeaks className="h-2 w-3.5" />
        A SherpaTech.AI property
      </span>
    </footer>
  )
}

// Small SherpaTech peaks glyph for the parent-brand footer lockup.
export function SherpaPeaks({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 14" className={className} fill="none" aria-hidden="true">
      <path
        d="M1 12.5 L7.5 4 L11 8.5 L16 2 L25 12.5"
        stroke="var(--color-navy)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
