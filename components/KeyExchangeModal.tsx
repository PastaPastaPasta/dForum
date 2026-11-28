'use client'

/**
 * Login with Dash (App Connect v2) modal.
 *
 * QR flow:
 *  1. App makes a fresh ephemeral key + App Connect request (QR) — wallet scans
 *  2. Wallet registers the bound keys, publishes a loginKeyResponse on chain
 *  3. App verifies the answer on chain and stores the grant as a tab session
 *
 * The wallet registers the keys itself — no dash-st: registration step, no
 * app-side key-registration flow. Nothing is signed by the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Loader2, KeyRound, ShieldCheck, X, AlertTriangle, ExternalLink, UserRound } from 'lucide-react'
import { useSession } from '@/lib/session'
import { useAppConnectLogin } from '@/lib/app-connect/use-login'
import { useProfileNames } from '@/lib/use-profiles'
import { formatTime, shortId } from '@/lib/utils'
import { redactWif } from '@/lib/redact'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea, [role="button"]'

const CARRIER_LABELS: Record<string, { name: string; audience: string }> = {
  dashpay: { name: 'DashPay', audience: 'new wallets' },
  'dash-key': { name: 'older wallet', audience: 'current wallets' },
}

export function KeyExchangeModal({ onClose }: { onClose?: () => void }) {
  const { controller } = useSession()
  const login = useAppConnectLogin(controller)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const acceptRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Focus trap + Escape
  useEffect(() => {
    if (!onClose) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE)) as HTMLElement[]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey && (active === first || !dialog.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  // Trap scroll behind the modal
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const accept = useCallback(async (identityId: string) => {
    if (acceptRef.current) return
    acceptRef.current = true
    setAccepting(true)
    try {
      const ok = await login.accept(identityId)
      if (ok) onClose?.()
      // A failed accept leaves the phase in 'error' — the UI shows it.
    } finally {
      acceptRef.current = false
      setAccepting(false)
    }
  }, [login, onClose])

  const retry = () => {
    setCopied(false)
    setCopyFailed(false)
    login.retry()
  }

  const primaryCarrierUri = login.uris?.[0] ?? null
  const fallbackCarrier = login.uris?.[1] ?? null
  const remaining = login.remainingSeconds != null ? formatTime(login.remainingSeconds) : null
  const candidateIds = login.candidates.map((c) => c.identityId)
  const candidateNames = useProfileNames(candidateIds)

  const showError = login.phase === 'error' || login.phase === 'timeout' || login.phase === 'too-many'
  const errorText =
    login.phase === 'timeout'
      ? 'Your wallet did not respond in time. Scan the code again, or open this page on the device where your wallet is installed.'
      : login.phase === 'too-many'
        ? 'Too many responses to this request — scan the QR again to start fresh.'
        : login.phase === 'error'
          ? redactWif(login.error ?? 'Something went wrong. Try again.')
          : null

  const stepText =
    login.phase === 'preparing' ? 'Preparing your login…'
      : login.phase === 'accepted' ? 'Logging you in…'
        : login.phase === 'confirm' ? 'Your wallet answered. Choose the identity to log in with.'
          : login.phase === 'waiting' ? 'Waiting for wallet…'
            : login.phase === 'timeout' ? 'Timed out'
              : login.phase === 'too-many' ? 'Too many responses'
                : 'Logging you in…'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        tabIndex={-1}
        onKeyDown={onKeyDownTrap}
        className="relative w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-2xl border border-rule bg-sheet shadow-2xl p-6 outline-none"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-2 text-ink-2 hover:bg-sunk hover:text-ink transition"
          aria-label="Close login dialog"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 id="login-modal-title" className="text-lg font-semibold tracking-tight">Log in with Dash</h2>
        <p className="text-sm text-ink-2 mt-1">Approve the login in your Dash wallet.</p>

        <div aria-live="polite" className="sr-only">{stepText}</div>
        <div aria-live="polite" className="sr-only">{copied ? 'URI copied' : ''}</div>

        <div className="mt-6 flex flex-col items-center gap-4">
          {login.phase === 'preparing' && (
            <>
              <Loader2 className="w-8 h-8 animate-spin text-dash" aria-hidden="true" />
              <p className="text-sm text-ink-2">Preparing your login…</p>
            </>
          )}

          {login.phase === 'waiting' && primaryCarrierUri && (
            <>
              {/* Tapping the primary action opens the wallet directly — the
                  QR below is the desktop-scan path. */}
              <a
                href={primaryCarrierUri.uri}
                className="btn btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium"
                aria-label="Open your Dash wallet to log in"
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" /> Open in wallet
              </a>
              <div className="p-3 bg-white rounded-xl border-2 border-dash">
                <QRCodeSVG value={primaryCarrierUri.uri} size={240} level="M" includeMargin={false} fgColor="#000000" bgColor="#FFFFFF" role="img" aria-label="QR code to log in with your Dash wallet" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Or scan with your Dash wallet</p>
                <p className="text-xs text-ink-2 mt-1">
                  {remaining != null ? `Expires in ${remaining}` : 'Waiting for wallet…'}
                </p>
              </div>
              {fallbackCarrier && (
                <a
                  href={fallbackCarrier.uri}
                  className="text-xs text-ink-2 hover:text-ink transition underline underline-offset-2"
                >
                  Wallet didn&apos;t open? Try the {CARRIER_LABELS[fallbackCarrier.carrier]?.name ?? 'alternate'} link
                </a>
              )}
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(primaryCarrierUri.uri)
                    setCopied(true)
                    setCopyFailed(false)
                    setTimeout(() => setCopied(false), 1500)
                  } catch {
                    setCopyFailed(true)
                  }
                }}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink-2 hover:bg-sunk hover:text-ink transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-live" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Link copied' : 'Copy login link'}
              </button>
              {copyFailed && (
                <div className="w-full">
                  <p className="text-xs text-archive">Couldn&apos;t copy. Select the link below and copy it.</p>
                  <input readOnly value={primaryCarrierUri.uri} onFocus={(e) => e.target.select()} className="mt-1 w-full rounded-lg border border-rule bg-paper px-2 py-1.5 text-xs font-mono text-ink break-all" aria-label="Login link" />
                </div>
              )}
              <p className="text-xs text-ink-2 text-center">
                Approve the request in your wallet. This page continues by itself.
              </p>
            </>
          )}

          {login.phase === 'confirm' && (
            <>
              <div className="flex flex-col items-center gap-3">
                <ShieldCheck className="w-10 h-10 text-dash" aria-hidden="true" />
                <p className="text-sm font-medium text-center">Your wallet answered. Choose the identity to log in with.</p>
                <ul className="w-full space-y-2">
                  {login.candidates.map((candidate) => (
                    <li key={candidate.identityId}>
                      <button
                        onClick={() => accept(candidate.identityId)}
                        disabled={accepting}
                        className="w-full flex items-center gap-3 rounded-xl border border-rule bg-sunk px-4 py-3 text-left hover:border-dash hover:bg-sunk transition disabled:opacity-50"
                      >
                        <UserRound className="w-5 h-5 text-dash shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          {candidateNames[candidate.identityId] && <span className="block text-sm text-ink truncate">{candidateNames[candidate.identityId]}</span>}
                          <span className="block text-xs font-mono text-ink-2 truncate" title={candidate.identityId}>{shortId(candidate.identityId, 12)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {accepting && <Loader2 className="w-5 h-5 animate-spin text-dash" aria-hidden="true" />}
                <button
                  onClick={retry}
                  disabled={accepting}
                  className="text-xs text-ink-2 hover:text-ink transition disabled:opacity-50"
                >
                  None of these, start again
                </button>
              </div>
            </>
          )}

          {login.phase === 'accepted' && (
            <>
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-live/15">
                <ShieldCheck className="w-8 h-8 text-live" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-live">Logging you in…</p>
            </>
          )}

          {showError && (
            <>
              <div role="alert" className="text-center">
                <p className="text-sm font-medium text-danger inline-flex items-center gap-2 justify-center">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  {login.phase === 'timeout' ? 'Timed out' : login.phase === 'too-many' ? 'Too many responses' : 'Login failed'}
                </p>
                <p className="text-xs text-ink-2 mt-2">{errorText}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={retry} className="btn btn-primary px-4 py-2 text-sm font-medium">
                  Try again
                </button>
                {onClose && (
                  <button onClick={onClose} className="btn btn-quiet">
                    Close
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-ink-2 flex items-center justify-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Your wallet adds a key that can only write to this forum, spend at most about 0.5 DASH in fees, and expires after 90 days. This tab keeps its copy until you log out; to revoke the key, disconnect the forum in your wallet.
        </p>
      </div>
    </div>
  )
}
