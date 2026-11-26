'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare, Search, Shield, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSession } from '@/lib/session'
import { Avatar } from '@/components/Avatar'
import { getRoster } from '@/lib/services/moderation-service'

export function Navbar() {
  const { session } = useSession()
  const pathname = usePathname()
  const [isModerator, setIsModerator] = useState(false)

  useEffect(() => {
    if (!session) {
      setIsModerator(false)
      return
    }
    let cancelled = false
    getRoster()
      .then((roster) => {
        if (cancelled) return
        setIsModerator(Boolean(roster && (roster.ownerId === session.identityId || roster.appointed.includes(session.identityId))))
      })
      .catch(() => setIsModerator(false))
    return () => { cancelled = true }
  }, [session])

  return (
    <header className="sticky top-0 z-40 border-b border-[#22304e] bg-[#0b1220]/90 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2 sm:gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#0070c0]">
            <MessageSquare className="w-5 h-5 text-white" />
          </span>
          <span className="hidden sm:block font-bold text-lg tracking-tight">dForum</span>
        </Link>

        <div className="flex-1 flex justify-center min-w-0">
          <Link
            href="/search"
            aria-label="Search dForum"
            className="group flex items-center gap-2 rounded-lg border border-[#22304e] bg-[#111a2e] px-3 h-9 w-full max-w-md text-sm text-[#93a1bd] hover:border-[#008CE7] transition"
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="truncate flex-1 text-left">Search dForum…</span>
          </Link>
        </div>

        <nav className="flex items-center gap-1 text-sm">
          {session ? (
            <Link
              href="/new"
              aria-label="New thread"
              className="flex items-center gap-1.5 rounded-lg bg-[#0070c0] hover:bg-[#005fa0] transition text-white px-2.5 sm:px-3 h-9 font-medium"
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">New thread</span>
            </Link>
          ) : null}
          {session && isModerator ? (
            <Link
              href="/moderation"
              aria-current={pathname.startsWith('/moderation') ? 'page' : undefined}
              className={`hidden md:flex items-center gap-1.5 rounded-lg px-3 h-9 hover:bg-[#111a2e] transition ${pathname.startsWith('/moderation') ? 'text-[#4db3ff]' : 'text-[#93a1bd] hover:text-white'}`}
            >
              <Shield className="w-4 h-4" />
              Moderate
            </Link>
          ) : null}
          {session ? (
            <Link
              href={`/u/${encodeURIComponent(session.identityId)}`}
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg border border-[#22304e] hover:border-[#008CE7] transition shrink-0"
              title="View profile"
            >
              <Avatar name={session.username ?? session.identityId} id={session.identityId} />
              <span className="hidden md:block text-sm font-medium max-w-[160px] truncate">
                {session.username ?? session.identityId.slice(0, 12)}
              </span>
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-[#0070c0] hover:bg-[#005fa0] transition px-3 sm:px-4 h-9 flex items-center font-medium"
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
