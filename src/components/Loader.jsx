// Apple-style (iOS UIActivityIndicatorView) 12-blade spinner — built purely
// from CSS transforms/animation so it needs no image assets.
export function Spinner({ size = 22, className = '', color }) {
  const blades = Array.from({ length: 12 })
  return (
    <div
      className={`ios-spinner ${className}`}
      style={{ width: size, height: size, color: color || 'currentColor' }}
      role="status"
      aria-label="Loading"
    >
      {blades.map((_, i) => (
        <div
          key={i}
          className="ios-spinner-blade"
          style={{
            transform: `rotate(${i * 30}deg)`,
            animationDelay: `${(i * (1 / 12) - 1).toFixed(3)}s`
          }}
        />
      ))}
    </div>
  )
}

// Drop-in replacement for the old plain-text "Loading…" rows — same
// footprint, but reads as a deliberate loading state instead of a
// half-rendered page.
export function PageLoader({ label = 'Loading…', compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${compact ? 'py-10' : 'py-16'}`}>
      <Spinner size={26} className="text-muted" />
      {label && <p className="text-sm text-muted">{label}</p>}
    </div>
  )
}

// Full-screen splash — used while auth/session is resolving.
export function SplashLoader() {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-base gap-3">
      <Spinner size={30} className="text-accent" />
    </div>
  )
}

// Inline skeleton rows for list-shaped content (leads, activity, etc.)
// — reduces perceived "pop-in" versus a spinner alone on data-heavy pages.
export function ListSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-line/60 shadow-card p-4 skeleton-shimmer">
          <div className="h-3.5 w-2/5 rounded-full bg-line/70 mb-2.5" />
          <div className="h-3 w-1/3 rounded-full bg-line/50 mb-3.5" />
          <div className="flex gap-2">
            <div className="h-5 w-16 rounded-full bg-line/50" />
            <div className="h-5 w-12 rounded-full bg-line/50" />
          </div>
        </div>
      ))}
    </div>
  )
}
