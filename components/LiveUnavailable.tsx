/**
 * The one "live data unavailable" banner. Every surface renders the same
 * message so a read-through-to-snapshot page says exactly the same thing
 * in exactly the same place. Amber, role=status, never blocks interaction.
 */
export function LiveUnavailable({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      className={`rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-xs text-amber-400 ${className}`}
    >
      Live data unavailable — showing the last index snapshot. Content may be incomplete or stale.
    </div>
  )
}
