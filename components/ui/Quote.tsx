'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

const MAX_PX = 220

/** Quoted text in posts. Long quotes start collapsed, so the reply comes first. */
export function Quote({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLQuoteElement>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  // Set as an attribute: React 18 doesn't know `inert`.
  useEffect(() => { body.current?.toggleAttribute('inert', long && !open) }, [long, open])
  useEffect(() => { if (ref.current && ref.current.scrollHeight > MAX_PX + 40) setLong(true) }, [])
  return (
    <blockquote ref={ref} className={long && !open ? 'relative overflow-hidden' : undefined} style={long && !open ? { maxHeight: MAX_PX } : undefined}>
      {/* Clipped text is inert while collapsed, so focus can't scroll into the hidden part. */}
      <div ref={body}>{children}</div>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className={`link block text-sm font-sans ${open ? 'mt-2' : 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-sunk from-60% px-[0.9em] pb-1.5 pt-6 text-left'}`}>
          {open ? 'Show less' : 'Show the whole quote'}
        </button>
      )}
    </blockquote>
  )
}
