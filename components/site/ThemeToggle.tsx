'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'light' | 'dark'

function current(): Theme {
  const set = document.documentElement.dataset.theme
  if (set === 'light' || set === 'dark') return set
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null)
  useEffect(() => setTheme(current()), [])
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <button type="button" className="btn-ghost" aria-label={`Switch to ${next} theme`} onClick={() => {
      document.documentElement.dataset.theme = next
      try { localStorage.setItem('dforum:theme', next) } catch { /* storage blocked */ }
      setTheme(next)
    }}>
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  )
}
