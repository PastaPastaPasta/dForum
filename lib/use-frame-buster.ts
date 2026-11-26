'use client'
/**
 * Frame-buster hook. Meta CSP cannot express frame-ancestors in a static
 * export, so the key-signing surfaces enforce it in JS: if the page is framed,
 * tell the top to navigate away AND render only an "open in its own tab"
 * affordance — a page rendered inside a frame must not function.
 *
 * Starts in 'unknown' so the page renders NOTHING until the check runs — a
 * framed first paint must not leak the console or the login form.
 */
import { useEffect, useState } from 'react'

export function useFrameBuster(): 'ok' | 'framed' | 'unknown' {
  const [state, setState] = useState<'ok' | 'framed' | 'unknown'>('unknown')
  useEffect(() => {
    const framed = window.top !== window.self
    if (framed) {
      try { window.top!.location.href = window.self.location.href } catch { /* cross-origin top — nothing to do */ }
    }
    setState(framed ? 'framed' : 'ok')
  }, [])
  return state
}
