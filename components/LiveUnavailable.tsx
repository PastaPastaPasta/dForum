/**
 * The one "live data unavailable" banner. Every surface renders the same
 * message so a read-through-to-snapshot page says exactly the same thing
 * in exactly the same place. Amber, role=status, never blocks interaction.
 */
export function LiveUnavailable({ className = '', onRetry, snapshotDate }: { className?: string; onRetry?: () => void; snapshotDate?: string | null }) {
  return (
    <div
      role="status"
      className={`rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-xs text-archive flex items-center justify-between gap-3 ${className}`}
    >
      <span>Live data unavailable — showing the last index snapshot{snapshotDate ? ` (${new Date(snapshotDate).toUTCString()})` : ''}. Content may be incomplete or stale.</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-amber-400/40 px-2 py-1 text-[11px] font-medium text-archive hover:bg-amber-400/10 transition"
        >
          Retry
        </button>
      )}
    </div>
  )
}
