'use client'

import { useState, useRef, useEffect } from 'react'
import { SmilePlus } from 'lucide-react'
import { REACTIONS, type ReactionCounts } from '@/lib/forum/types'

export function Reactions({ counts, mine, canReact, busy, onReact }: {
  counts: ReactionCounts
  mine: number
  canReact: boolean
  busy: boolean
  onReact(kind: number): void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  const shown = REACTIONS.filter((r) => (counts[r.kind] ?? 0) > 0)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((r) => (
        <button key={r.kind} type="button" disabled={!canReact || busy} onClick={() => onReact(mine === r.kind ? 0 : r.kind)}
          aria-pressed={mine === r.kind} aria-label={`${r.label}: ${counts[r.kind]}`}
          className={`tap inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm tabnum disabled:cursor-default ${mine === r.kind ? 'border-dash bg-dash/10 text-dash' : 'border-rule hover:border-dash/60'}`}>
          <span aria-hidden>{r.emoji}</span>{counts[r.kind]}
        </button>
      ))}
      {canReact && (
        <div className="relative" ref={box}>
          <button type="button" className="btn-ghost text-sm" aria-expanded={open} aria-label="React" disabled={busy} onClick={() => setOpen((o) => !o)}>
            <SmilePlus aria-hidden className="h-4 w-4" />{shown.length === 0 && <span>React</span>}
          </button>
          {open && (
            <div role="menu" className="panel absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 p-1 shadow-lg">
              {REACTIONS.map((r) => (
                <button key={r.kind} role="menuitemradio" aria-checked={mine === r.kind} type="button" title={r.label} aria-label={r.label}
                  onClick={() => { setOpen(false); onReact(mine === r.kind ? 0 : r.kind) }}
                  className={`tap rounded-md px-1.5 py-1.5 text-xl leading-none hover:bg-sunk ${mine === r.kind ? 'bg-dash/10' : ''}`}>
                  {r.emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
