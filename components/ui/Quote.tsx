'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

const MAX_PX = 220

/** Quoted text in posts. Long quotes start collapsed, so the reply comes first; focusing anything
 * inside (a link, by keyboard) opens the quote rather than scrolling it inside its clip. */
export function Quote({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLQuoteElement>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (ref.current && ref.current.scrollHeight > MAX_PX + 40) setLong(true) }, [])
  const collapsed = long && !open
  return (
    <blockquote ref={ref} onFocusCapture={(e) => { if (collapsed && e.target !== e.currentTarget.lastElementChild) setOpen(true) }}
      className={collapsed ? 'relative overflow-hidden' : undefined} style={collapsed ? { maxHeight: MAX_PX } : undefined}>
      {children}
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className={`link block text-sm font-sans ${open ? 'mt-2' : 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-sunk from-60% px-[0.9em] pb-1.5 pt-6 text-left'}`}>
          {open ? 'Show less' : 'Show the whole quote'}
        </button>
      )}
    </blockquote>
  )
}
