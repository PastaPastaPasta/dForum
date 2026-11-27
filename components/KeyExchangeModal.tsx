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
import { formatTime } from '@/lib/utils'
import { redactWif } from '@/lib/redact'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea, [role="button"]'

const CARRIER_LABELS: Record<string, { name: string; audience: string }> = {
  dashpay: { name: 'dashpay://connect', audience: 'new wallets' },
  'dash-key': { name: 'dash-key:', audience: 'current wallets' },
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

  const showError = login.phase === 'error' || login.phase === 'timeout' || login.phase === 'too-many'
  const errorText =
    login.phase === 'timeout'
      ? 'Your wallet did not respond in time. Scan the QR again — or open dForum in a browser on the same device your wallet is installed on.'
      : login.phase === 'too-many'
        ? 'Too many responses to this request — scan the QR again to start fresh.'
        : login.phase === 'error'
          ? redactWif(login.error ?? 'Something went wrong. Try again.')
          : null

  const stepText =
    login.phase === 'preparing' ? 'Preparing wallet sign-in…'
      : login.phase === 'accepted' ? 'Signing you in…'
        : login.phase === 'confirm' ? 'Wallet responded — choose which identity to sign in with'
          : login.phase === 'waiting' ? 'Waiting for wallet…'
            : login.phase === 'timeout' ? 'Timed out'
              : login.phase === 'too-many' ? 'Too many responses'
                : 'Signing you in…'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        tabIndex={-1}
        onKeyDown={onKeyDownTrap}
        className="relative w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-2xl border border-[#22304e] bg-[#111a2e] shadow-2xl p-6 outline-none"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-2 text-[#93a1bd] hover:bg-[#18233c] hover:text-white transition"
          aria-label="Close login dialog"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 id="login-modal-title" className="text-lg font-bold tracking-tight">Login with Dash</h2>
        <p className="text-sm text-[#93a1bd] mt-1">Sign in to dForum with your Dash identity</p>

        <div aria-live="polite" className="sr-only">{stepText}</div>
        <div aria-live="polite" className="sr-only">{copied ? 'URI copied' : ''}</div>

        <div className="mt-6 flex flex-col items-center gap-4">
          {login.phase === 'preparing' && (
            <>
              <Loader2 className="w-8 h-8 animate-spin text-[#4db3ff]" aria-hidden="true" />
              <p className="text-sm text-[#93a1bd]">Preparing wallet sign-in…</p>
            </>
          )}

          {login.phase === 'waiting' && primaryCarrierUri && (
            <>
              <div className="p-3 bg-white rounded-xl border-2 border-[#008CE7]">
                <QRCodeSVG value={primaryCarrierUri.uri} size={208} level="M" includeMargin={false} fgColor="#000000" bgColor="#FFFFFF" role="img" aria-label="Login URI QR code" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Scan with your Dash wallet</p>
                <p className="text-xs text-[#93a1bd] mt-1">
                  {remaining != null ? `Expires in ${remaining}` : 'Waiting for wallet…'}
                </p>
              </div>
              <a
                href={primaryCarrierUri.uri}
                className="inline-flex items-center gap-2 rounded-lg border border-[#22304e] px-3 py-2 text-xs text-[#4db3ff] hover:border-[#008CE7] hover:text-white transition"
                aria-label="Open login URI in wallet"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Open in wallet
              </a>
              {fallbackCarrier && (
                <a
                  href={fallbackCarrier.uri}
                  className="text-xs text-[#93a1bd] hover:text-white transition underline underline-offset-2"
                >
                  Use the {CARRIER_LABELS[fallbackCarrier.carrier]?.name ?? 'alternate'} link
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
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#93a1bd] hover:bg-[#18233c] hover:text-white transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'URI copied' : 'Copy URI'}
              </button>
              {copyFailed && (
                <div className="w-full">
                  <p className="text-xs text-amber-400">Copy failed — select the URI below</p>
                  <input readOnly value={primaryCarrierUri.uri} onFocus={(e) => e.target.select()} className="mt-1 w-full rounded-lg border border-[#22304e] bg-[#0b1220] px-2 py-1.5 text-xs font-mono text-[#c4cfe0] break-all" aria-label="Login URI" />
                </div>
              )}
              <p className="text-xs text-[#93a1bd] text-center">
                Scan the QR with your wallet, or paste the URI into it.
              </p>
            </>
          )}

          {login.phase === 'confirm' && (
            <>
              <div className="flex flex-col items-center gap-3">
                <ShieldCheck className="w-10 h-10 text-[#4db3ff]" aria-hidden="true" />
                <p className="text-sm font-medium text-center">Wallet responded — choose which identity to sign in with</p>
                <ul className="w-full space-y-2">
                  {login.candidates.map((candidate) => (
                    <li key={candidate.identityId}>
                      <button
                        onClick={() => accept(candidate.identityId)}
                        disabled={accepting}
                        className="w-full flex items-center gap-3 rounded-xl border border-[#22304e] bg-[#18233c] px-4 py-3 text-left hover:border-[#008CE7] hover:bg-[#1d2a45] transition disabled:opacity-50"
                      >
                        <UserRound className="w-5 h-5 text-[#4db3ff] shrink-0" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-xs font-mono text-white truncate">{candidate.identityId}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {accepting && <Loader2 className="w-5 h-5 animate-spin text-[#4db3ff]" aria-hidden="true" />}
                <button
                  onClick={retry}
                  disabled={accepting}
                  className="text-xs text-[#93a1bd] hover:text-white transition disabled:opacity-50"
                >
                  None of these — start again
                </button>
              </div>
            </>
          )}

          {login.phase === 'accepted' && (
            <>
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/15">
                <ShieldCheck className="w-8 h-8 text-emerald-400" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-emerald-400">Signing you in…</p>
            </>
          )}

          {showError && (
            <>
              <div role="alert" className="text-center">
                <p className="text-sm font-medium text-red-400 inline-flex items-center gap-2 justify-center">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  {login.phase === 'timeout' ? 'Timed out' : login.phase === 'too-many' ? 'Too many responses' : 'Login failed'}
                </p>
                <p className="text-xs text-[#93a1bd] mt-2">{errorText}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={retry} className="btn-primary px-4 py-2 text-sm font-medium">
                  Try again
                </button>
                {onClose && (
                  <button onClick={onClose} className="btn-secondary">
                    Close
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[#93a1bd] flex items-center justify-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
          Your wallet registers a HIGH-level, contract-bound key for this tab only — it can sign documents on dForum&apos;s contract, and nothing else. It cannot withdraw or transfer credits, and its use is limited to this host.
        </p>
      </div>
    </div>
  )
}
