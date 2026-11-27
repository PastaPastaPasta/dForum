'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare, Search, Shield, Pencil, User, Settings, LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '@/lib/session'
import { Avatar } from '@/components/Avatar'
import { getRoster } from '@/lib/services/moderation-service'
import { LOGIN_AVAILABLE } from '@/lib/host'

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''

export function Navbar() {
  const { session, ready, signOut } = useSession()
  const fullPath = usePathname()
  // usePathname includes the base path on the Pages build — strip it so the
  // route checks below match the bare paths. Collapse repeated slashes so an
  // irregular URL (e.g. /search// or double-slash paths) renders identically
  // to the prerendered route instead of mismatching the hydration tree.
  const bare = BASE_PATH && fullPath.startsWith(BASE_PATH) ? fullPath.slice(BASE_PATH.length) : fullPath
  const pathname = bare.replace(/\/{2,}/g, '/') || '/'
  // On the login page the navbar hides its login CTA — the page's own
  // sign-in affordance is the authoritative one.
  const [searchQuery, setSearchQuery] = useState('')
  const [isModerator, setIsModerator] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)

  const sessionIdentityId = session?.identityId ?? null

  useEffect(() => {
    if (!sessionIdentityId) {
      setIsModerator(false)
      return
    }
    let cancelled = false
    // Defer the roster fetch to idle time — the navbar renders instantly from
    // the session; the moderator affordance appears when the roster resolves.
    const timer = setTimeout(() => {
      getRoster()
        .then((roster) => {
          if (cancelled) return
          setIsModerator(Boolean(roster && (roster.ownerId === sessionIdentityId || roster.appointed.includes(sessionIdentityId))))
        })
        .catch(() => { if (!cancelled) setIsModerator(false) })
    }, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [sessionIdentityId])

  // Close the account menu on navigation / outside click / Escape.
  // Escape returns focus to the trigger button — the dropdown is a menu-like
  // disclosure (no arrow-key nav exists), so no menu/menuitem roles.
  useEffect(() => {
    setMenuOpen(false)
    // Keep the nav search box in sync with the URL query — the nav box is
    // hidden on /search, where the page's own search input is authoritative.
    const params = new URLSearchParams(window.location.search)
    setSearchQuery(params.get('q') ?? '')
  }, [pathname])
  useEffect(() => {
    if (!menuOpen) return
    const trigger = menuTriggerRef.current
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        trigger?.focus()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  return (
    <header className="sticky top-0 z-40 border-b border-[#22304e] bg-[#0b1220]/90 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2 sm:gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="dForum home">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#0070c0]">
            <MessageSquare className="w-5 h-5 text-white" aria-hidden="true" />
          </span>
          <span className="hidden sm:block font-bold text-lg tracking-tight">dForum</span>
        </Link>

        <div className="flex-1 flex justify-center min-w-0">
          {!pathname.startsWith('/search') && (
            <form
              action={`${BASE_PATH}/search/`}
              method="get"
              aria-label="Search dForum"
              className="group flex items-center gap-2 rounded-lg border border-input bg-[#111a2e] px-3 h-9 w-full max-w-md text-sm text-[#93a1bd] hover:border-[#008CE7] focus-within:border-[#008CE7] focus-within:ring-2 focus-within:ring-[#008CE7]/40 transition"
            >
              <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
              <input
                type="search"
                name="q"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search dForum"
                placeholder="Search dForum…"
                className="bg-transparent flex-1 min-w-0 focus-visible:outline-none placeholder:text-[#93a1bd] text-left text-base sm:text-sm"
              />
            </form>
          )}
        </div>

        <nav aria-label="Account" className="flex items-center gap-1 text-sm">
          {!ready ? (
            <span className="inline-block w-24 h-9 rounded-lg bg-[#18233c] animate-pulse" aria-hidden="true" />
          ) : session ? (
            <>
              <Link
                href="/new"
                aria-label="New thread"
                className="flex items-center gap-1.5 btn-primary px-2.5 sm:px-3 h-9 font-medium"
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">New thread</span>
              </Link>
              <div
                className="relative"
                ref={menuRef}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setMenuOpen(false)
                }}
              >
                <button
                  ref={menuTriggerRef}
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-expanded={menuOpen}
                  {...(menuOpen ? { 'aria-controls': 'account-menu' } : {})}
                  aria-label="Account menu"
                  className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg border border-[#22304e] hover:border-[#008CE7] transition shrink-0"
                >
                  <Avatar name={session.username ?? session.identityId} id={session.identityId} />
                  <span className="hidden md:block text-sm font-medium max-w-[160px] truncate">
                    {session.username ?? session.identityId.slice(0, 12)}
                  </span>
                </button>
                {menuOpen && (
                  <div id="account-menu" className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-[#22304e] bg-[#111a2e] shadow-xl overflow-hidden z-50">
                    <Link href={`/u/${encodeURIComponent(session.identityId)}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[#18233c] transition">
                      <User className="w-4 h-4 text-[#93a1bd]" aria-hidden="true" /> Profile
                    </Link>
                    <Link href="/settings" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[#18233c] transition">
                      <Settings className="w-4 h-4 text-[#93a1bd]" aria-hidden="true" /> Settings
                    </Link>
                    {isModerator && (
                      <Link href="/moderation" aria-current={pathname.startsWith('/moderation') ? 'page' : undefined} className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#4db3ff] hover:bg-[#18233c] transition">
                        <Shield className="w-4 h-4" aria-hidden="true" /> Moderate
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={async () => { setMenuOpen(false); await signOut() }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-[#93a1bd] hover:bg-[#18233c] hover:text-white transition border-t border-[#22304e]"
                    >
                      <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : pathname.startsWith('/login') ? (
            null
          ) : !LOGIN_AVAILABLE ? (
            <span className="inline-flex items-center h-9 rounded-lg border border-[#22304e] px-3 text-sm text-[#93a1bd]">Read-only</span>
          ) : (
            <Link
              href="/login"
              className="btn-primary px-3 sm:px-4 h-9 flex items-center font-medium"
            >
              <span className="hidden sm:inline">Login with Dash</span>
              <span className="sm:hidden">Sign in</span>
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
