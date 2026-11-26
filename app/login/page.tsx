'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, KeyRound, ShieldCheck, Sparkles, Loader2, ShieldAlert, ExternalLink } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { KeyExchangeModal } from '@/components/KeyExchangeModal'
import { useSession } from '@/lib/session'
import { hostIsCanonical, canonicalHost } from '@/lib/host'
import { useFrameBuster } from '@/lib/use-frame-buster'
import { redactWif } from '@/lib/redact'

/** Only same-origin paths survive — never a protocol-relative or backslash
 * href (browsers treat \\ as /, which would resolve to an external host). */
function safeNextPath(raw: string | null, origin: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  // Same-origin absolute paths only — reject backslashes (browsers treat
  // \\ as /) and protocol-relative URLs.
  if (!trimmed.startsWith('/')) return null
  if (/[\\]/.test(trimmed)) return null
  if (trimmed.startsWith('//')) return null
  try {
    const url = new URL(trimmed, origin)
    if (url.origin !== origin) return null
    if (!url.pathname.startsWith('/')) return null
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}

export default function LoginPage() {
  const { session, ready, authError } = useSession()
  const [showModal, setShowModal] = useState(false)
  const [host, setHost] = useState('')
  const [hostAcknowledged, setHostAcknowledged] = useState(false)
  const [nextPath, setNextPath] = useState<string | null>(null)
  const signedInRef = useRef<HTMLDivElement>(null)
  const modalOpenedRef = useRef(false)
  const frameState = useFrameBuster()

  // Read the host after hydration — during prerender there is no window.
  useEffect(() => {
    setHost(typeof window !== 'undefined' ? window.location.hostname : '')
    const params = new URLSearchParams(window.location.search)
    setNextPath(safeNextPath(params.get('next'), window.location.origin))
  }, [])

  const canonical = hostIsCanonical(host)
  const hostGateOpen = canonical || hostAcknowledged

  const openModal = useCallback(() => {
    modalOpenedRef.current = true
    setShowModal(true)
  }, [])

  const closeModal = useCallback(() => setShowModal(false), [])

  // Post-login: the modal reports completion through the session becoming
  // non-null. Land wherever the user came from.
  useEffect(() => {
    if (session && nextPath && modalOpenedRef.current) {
      modalOpenedRef.current = false
      window.location.assign(nextPath)
      return
    }
    // No target: announce the signed-in panel exactly once.
    if (session && !nextPath && modalOpenedRef.current) {
      modalOpenedRef.current = false
      signedInRef.current?.focus?.()
    }
  }, [session, nextPath])

  const alreadySignedIn = Boolean(session)

  if (frameState === 'unknown') {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center">
          <span className="sr-only" role="status">Loading…</span>
        </main>
        <Footer />
      </>
    )
  }

  if (frameState === 'framed') {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up max-w-md">
            <ExternalLink className="w-8 h-8 text-[#4db3ff] mx-auto" aria-hidden="true" />
            <p className="text-sm uppercase tracking-widest text-[#93a1bd] mt-3">In a frame</p>
            <h1 className="text-2xl font-bold mt-2">Open dForum in its own tab</h1>
            <p className="text-sm text-[#93a1bd] mt-2">
              The login flow holds key material — it only runs on its own top-level page.
            </p>
            <a href={`https://${canonicalHost()}/login`} className="mt-6 inline-flex items-center gap-2 btn-primary px-4 py-2">
              Open in a new tab <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="fade-up">
              <p className="inline-flex items-center gap-2 rounded-full border border-[#22304e] bg-[#111a2e] px-3 py-1 text-xs text-[#4db3ff]">
                <Sparkles className="w-3.5 h-3.5" />
                Login with Dash
              </p>
              <h1 className="mt-4 text-3xl sm:text-4xl font-bold leading-tight tracking-tight">
                Sign in with your<br />Dash identity
              </h1>
              <p className="mt-4 text-[#93a1bd]">
                No accounts, no passwords, no email. Your identity is a Dash Platform
                identity — you sign in by scanning a QR code with your wallet.
              </p>

              <div className="mt-6 space-y-3 text-sm">
                <Benefit icon={<ShieldCheck className="w-4 h-4" />} text="Your identity stays yours — no central server" />
                <Benefit icon={<KeyRound className="w-4 h-4" />} text="Your wallet signs — dForum holds a HIGH-level signing key for this tab only. It can post on your behalf but cannot move funds" />
                <Benefit icon={<MessageSquare className="w-4 h-4" />} text="All posts, profiles and reactions live on-chain" />
              </div>

              {alreadySignedIn ? (
                <div ref={signedInRef} tabIndex={-1} className="mt-8 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
                  <p className="text-sm font-medium text-emerald-400">You are signed in</p>
                  <p className="text-xs text-[#93a1bd] mt-1 font-mono truncate">{session?.identityId}</p>
                  <Link href={nextPath ?? '/'} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/30 transition">
                    {nextPath ? 'Continue to your page' : 'Go to dForum'}
                  </Link>
                </div>
              ) : (
                <>
                  {!canonical && host && (
                    <div className="mt-6 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
                      <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-amber-300">Untrusted host — login</p>
                        <p className="mt-1 text-amber-200/80">
                          This page is served from <code>{host}</code>. The login flow and its keys are designed for{' '}
                          <code>{canonicalHost()}</code>. Continue on hosts you control only.
                        </p>
                        <label className="mt-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={hostAcknowledged}
                            onChange={(e) => setHostAcknowledged(e.target.checked)}
                            className="accent-[#008CE7]"
                          />
                          I understand the risk and want to log in on this host
                        </label>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={openModal}
                    disabled={!ready || !hostGateOpen}
                    className="mt-8 btn-primary px-5 py-3 font-semibold shadow-lg shadow-[#008CE7]/20"
                  >
                    {!ready ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
                    Login with Dash
                  </button>
                  {authError && (
                    <p role="alert" className="mt-3 text-sm text-red-400">{redactWif(authError)}</p>
                  )}
                </>
              )}
            </div>

            <div className="rounded-2xl border border-[#22304e] bg-[#111a2e] p-6">
              <ol className="space-y-5">
                <Step number={1} title="Scan the QR" body="Open your Dash wallet and scan the dash-key: code shown in the login modal." />
                <Step number={2} title="Approve the request" body="Confirm the key-exchange request in your wallet." />
                <Step number={3} title="Keys registered (first login)" body="On first login you'll register auth keys with dForum — scan a second code." />
                <Step number={4} title="You're in" body="Your session lives in this tab only — your wallet key never leaves your wallet." />
              </ol>
            </div>
          </div>
        </div>
      </main>
      <Footer />

      {showModal && <KeyExchangeModal onClose={closeModal} />}
    </>
  )
}

function Benefit({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex items-center justify-center w-7 h-7 rounded-lg bg-[#18233c] text-[#4db3ff] shrink-0">{icon}</span>
      <p className="text-[#93a1bd]">{text}</p>
    </div>
  )
}

function Step({ number, title, body }: { number: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden="true" className="flex items-center justify-center w-8 h-8 rounded-full bg-[#0070c0]/15 text-[#4db3ff] text-sm font-bold shrink-0">{number}</span>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-[#93a1bd] mt-0.5">{body}</p>
      </div>
    </li>
  )
}
