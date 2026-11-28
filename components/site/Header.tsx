'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bell, Eye, LogOut, Menu, PenSquare, Search, Settings, Shield, User, X } from 'lucide-react'
import { useSession } from '@/lib/session'
import { LOGIN_AVAILABLE } from '@/lib/host'
import { getRoster } from '@/lib/services/moderation-service'
import { Avatar } from '@/components/ui/Avatar'
import { ThemeToggle } from './ThemeToggle'
import { useUnreadAlerts } from '@/lib/live/alerts'
import { useProfileNames } from '@/lib/use-profiles'

const NAV = [
  { href: '/', label: 'Forums', match: (p: string) => p === '/' || p.startsWith('/f/') || p.startsWith('/t/') },
  { href: '/whats-new/', label: "What's new", match: (p: string) => p.startsWith('/whats-new') },
  { href: '/members/', label: 'Members', match: (p: string) => p.startsWith('/members') || p.startsWith('/u/') },
]

export function Header({ siteName }: { siteName: string }) {
  const { session, ready, signOut } = useSession()
  const pathname = usePathname() || '/'
  const [isModerator, setIsModerator] = useState(false)
  const [menu, setMenu] = useState(false)
  const [mobile, setMobile] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const unread = useUnreadAlerts(session?.identityId ?? null)

  useEffect(() => { setMenu(false); setMobile(false) }, [pathname])
  useEffect(() => {
    const id = session?.identityId
    if (!id) { setIsModerator(false); return }
    let live = true
    getRoster().then((r) => live && setIsModerator(!!r && (r.ownerId === id || r.appointed.includes(id)))).catch(() => undefined)
    return () => { live = false }
  }, [session?.identityId])
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [menu])

  const profileNames = useProfileNames(session ? [session.identityId] : [])
  const name = (session && profileNames[session.identityId]) || session?.identityId.slice(0, 8) || ''
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-sheet/95 backdrop-blur supports-[backdrop-filter]:bg-sheet/85">
      <div className="mx-auto flex h-14 max-w-page items-center gap-2 px-4 sm:gap-3">
        <button type="button" className="btn-ghost md:hidden" aria-label={mobile ? 'Close menu' : 'Open menu'} aria-expanded={mobile} onClick={() => setMobile((m) => !m)}>
          {mobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link href="/" className="flex min-w-0 shrink items-center gap-2 font-semibold tracking-tight" aria-label={`${siteName} home`}>
          <svg aria-hidden viewBox="0 0 32 32" className="h-7 w-7"><rect width="32" height="32" rx="7" className="fill-dash" /><path d="M9 10h10.5c3.6 0 5.6 2.4 4.9 5.6l-.7 3.2C23 21.6 20.6 23 18 23H7.5l.8-3.4h9.4c1.1 0 1.8-.6 2-1.5l.5-2.2c.2-.9-.3-1.5-1.3-1.5H8.2z M6.5 15h7.2l-.7 3H5.8z" fill="rgb(var(--dash-ink))" /></svg>
          <span className="truncate text-[1.05rem]">{siteName}</span>
        </Link>
        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.match(pathname) ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${n.match(pathname) ? 'bg-sunk text-ink' : 'text-ink-2 hover:text-ink'}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <form action="/search/" method="get" role="search" className="ml-auto hidden max-w-xs flex-1 items-center gap-2 rounded-md border border-rule bg-paper px-2.5 focus-within:border-dash sm:flex">
          <Search aria-hidden className="h-4 w-4 text-ink-2" />
          <input name="q" type="search" placeholder="Search threads and posts" aria-label="Search" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </form>
        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          <Link href="/search/" className="btn-ghost sm:hidden" aria-label="Search"><Search className="h-5 w-5" /></Link>
          <ThemeToggle />
          {!ready ? (
            <span className="h-9 w-24 animate-pulse rounded-md bg-sunk" aria-hidden />
          ) : session ? (
            <>
              <Link href="/alerts/" className="btn-ghost relative" aria-label={unread ? `Alerts, ${unread} new` : 'Alerts'}>
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute right-0.5 top-0.5 min-w-[1.1rem] rounded-full bg-danger px-1 text-center text-[0.65rem] font-bold leading-[1.1rem] text-white tabnum">{unread > 9 ? '9+' : unread}</span>}
              </Link>
              <Link href="/new/" className="btn btn-primary hidden sm:inline-flex"><PenSquare className="h-4 w-4" />New thread</Link>
              <div className="relative" ref={menuRef}>
                <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="true" aria-label="Account menu"
                  className="flex items-center gap-2 rounded-md p-1 hover:bg-sunk">
                  <Avatar seed={session.identityId} name={name} size={30} />
                </button>
                {menu && (
                  <div className="panel absolute right-0 top-full mt-2 w-56 overflow-hidden py-1 shadow-lg">
                    <p className="truncate px-3 py-2 text-sm font-semibold">{name}</p>
                    <Link href={`/u/${session.identityId}/`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sunk"><User className="h-4 w-4 text-ink-2" />Your profile</Link>
                    <Link href="/watched/" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sunk"><Eye className="h-4 w-4 text-ink-2" />Watched threads</Link>
                    <Link href="/settings/" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sunk"><Settings className="h-4 w-4 text-ink-2" />Settings</Link>
                    {isModerator && <Link href="/moderation/" className="flex items-center gap-2 px-3 py-2 text-sm text-dash hover:bg-sunk"><Shield className="h-4 w-4" />Moderation</Link>}
                    <button type="button" onClick={() => { setMenu(false); void signOut() }} className="flex w-full items-center gap-2 border-t border-rule px-3 py-2 text-left text-sm hover:bg-sunk">
                      <LogOut className="h-4 w-4 text-ink-2" />Log out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : LOGIN_AVAILABLE && !pathname.startsWith('/login') ? (
            <Link href={`/login/?next=${encodeURIComponent(pathname)}`} className="btn btn-primary"><span className="sm:hidden">Log in</span><span className="hidden sm:inline">Log in with Dash</span></Link>
          ) : null}
        </div>
      </div>
      {mobile && (
        <nav aria-label="Main" className="border-t border-rule px-4 py-2 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-md px-2 py-2 text-sm font-medium hover:bg-sunk">{n.label}</Link>
          ))}
          {session && <Link href="/new/" className="block rounded-md px-2 py-2 text-sm font-medium text-dash hover:bg-sunk">New thread</Link>}
        </nav>
      )}
    </header>
  )
}
