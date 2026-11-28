'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { KeyRound, ShieldCheck, Loader2, ExternalLink, Wallet } from 'lucide-react'
import { KeyExchangeModal } from '@/components/KeyExchangeModal'
import { useSession } from '@/lib/session'
import { hostIsCanonical, canonicalHost, LOGIN_AVAILABLE } from '@/lib/host'
import { useFrameBuster } from '@/lib/use-frame-buster'
import { redactWif } from '@/lib/redact'
import { safeNextPath } from '@/lib/safe-next'

export default function LoginPage() {
  const { session, ready, authError } = useSession()
  const [showModal, setShowModal] = useState(false)
  const [host, setHost] = useState('')
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

  // The login flow holds key material — it only runs where the session
  // machinery is even available (the canonical host), not merely where the
  // host string happens to match. The site is served from the root, so the
  // availability gate and the canonical-host gate are the same check.
  const canonical = LOGIN_AVAILABLE && hostIsCanonical(host)

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
      <span className="sr-only" role="status">Loading…</span>
    )
  }

  if (frameState === 'framed') {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <ExternalLink className="mx-auto h-8 w-8 text-dash" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-semibold">Open this page in its own tab</h1>
        <p className="mt-2 text-ink-2">Logging in handles key material, so it only runs as a top-level page on {canonicalHost()}.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-8 py-6 md:grid-cols-[1fr_22rem] md:py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Log in with Dash</h1>
        <p className="mt-3 max-w-prose text-ink-2">
          Your account is your Dash identity. There is no password and no sign-up form: you approve the login in your Dash wallet, and your posts are written to Dash Platform under your identity.
        </p>
        <ul className="mt-6 space-y-3 text-sm">
          <Benefit icon={<Wallet className="h-4 w-4" />} text="Works with DashPay wallets that support App Connect. Testnet builds use a testnet wallet." />
          <Benefit icon={<KeyRound className="h-4 w-4" />} text="Your wallet adds a key that can only write to this forum, spend at most about 0.5 DASH in fees, and expires after 90 days." />
          <Benefit icon={<ShieldCheck className="h-4 w-4" />} text="This tab keeps its copy of that key until you log out. To revoke it everywhere, disconnect the forum in your wallet." />
        </ul>
        {alreadySignedIn ? (
          <div ref={signedInRef} tabIndex={-1} className="mt-8 rounded-lg border border-live/40 bg-live/10 p-4">
            <p className="font-medium text-live">You are logged in</p>
            <p className="mt-1 truncate font-mono text-xs text-ink-2">{session?.identityId}</p>
            {nextPath ? (
              <button type="button" onClick={() => window.location.assign(nextPath)} className="btn btn-primary mt-3">Continue</button>
            ) : (
              <Link href="/" className="btn btn-primary mt-3">Go to the forums</Link>
            )}
          </div>
        ) : !canonical ? (
          <div className="panel mt-6 p-4 text-sm text-ink-2">
            <p className="font-medium text-ink">Logging in is not available on this address</p>
            <p className="mt-1">Log in on <a className="link" href={`https://${canonicalHost()}/login/`}>{canonicalHost()}</a>. Other copies of the site are read only, because the login keeps key material in the browser tab.</p>
          </div>
        ) : (
          <>
            <button onClick={openModal} disabled={!ready} className="btn btn-primary mt-8 px-5 py-2.5 text-base">
              {!ready ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
              Log in with Dash
            </button>
            {authError && <p role="alert" className="mt-3 text-sm text-danger">{redactWif(authError)}</p>}
          </>
        )}
      </div>
      {LOGIN_AVAILABLE && (
        <ol className="panel space-y-5 self-start p-5">
          <Step number={1} title="Scan the code" body="Open your Dash wallet and scan the QR code, or tap the link on a phone." />
          <Step number={2} title="Approve in your wallet" body="Your wallet shows what the forum asks for and registers the limited key when you approve." />
          <Step number={3} title="Start posting" body="The forum confirms the key on Dash Platform and logs you in." />
        </ol>
      )}
      {showModal && <KeyExchangeModal onClose={closeModal} />}
    </div>
  )
}

function Benefit({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-dash/10 text-dash">{icon}</span>
      <p className="text-ink-2">{text}</p>
    </li>
  )
}

function Step({ number, title, body }: { number: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dash/10 text-sm font-bold text-dash">{number}</span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-ink-2">{body}</p>
      </div>
    </li>
  )
}
