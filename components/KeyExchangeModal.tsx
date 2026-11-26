'use client'

/**
 * Login with Dash (App Connect v2) modal.
 *
 * QR flow:
 *  1. App generates an ephemeral keypair + dash-key: URI (QR) — wallet scans
 *  2. Wallet responds via the key-exchange contract — app decrypts login key
 *  3. Keys are registered on the identity (first login only) — dash-st: QR
 *  4. Login completes → session persisted → modal closes
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Loader2, KeyRound, ShieldCheck, X, AlertTriangle } from 'lucide-react'
import { useYapprKeyExchangeLogin, useYapprKeyRegistration } from 'platform-auth'
import { useSession } from '@/lib/session'
import { formatTime } from '@/lib/utils'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea, [role="button"]'

export function KeyExchangeModal({ onClose }: { onClose?: () => void }) {
  const { controller } = useSession()
  const login = useYapprKeyExchangeLogin(controller)
  const registration = useYapprKeyRegistration(controller)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const registrationStartedRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Start the exchange once on mount
  useEffect(() => {
    login.start()
    return () => login.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drive the key-registration flow when the login flow needs it
  useEffect(() => {
    if (login.state === 'registering' && login.result && !registrationStartedRef.current) {
      registrationStartedRef.current = true
      registration.start(login.result.identityId, login.result.authKey, login.result.encryptionKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login.state, login.result])

  const handleComplete = useCallback(async () => {
    if (completing) return
    if (!login.result) return
    setCompleting(true)
    setFinishError(null)
    try {
      await controller.loginWithLoginKey(
        login.result.identityId,
        login.result.loginKey,
        login.result.keyIndex,
      )
      login.cancel()
      registration.cancel()
      onClose?.()
    } catch (err) {
      setCompleting(false)
      setFinishError(err instanceof Error ? err.message : 'Signing you in failed — try again')
    }
  }, [completing, controller, login, registration, onClose])

  // Finish login when the login exchange completes (keys already registered)
  useEffect(() => {
    if (login.state === 'complete' && login.result && !completing) {
      handleComplete()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login.state, login.result])

  // Finish login after registration completes
  useEffect(() => {
    if (registration.state === 'complete' && login.result && !completing) {
      handleComplete()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registration.state, login.result])

  const displayUri = login.state === 'registering' ? registration.uri : login.uri
  const remaining = login.state === 'registering' ? registration.remainingTime : login.remainingTime

  const copy = async () => {
    if (!displayUri) return
    try {
      await navigator.clipboard.writeText(displayUri)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyFailed(true)
    }
  }

  const closing = login.state === 'complete' || registration.state === 'complete'

  // Escape closes; focus moves into the dialog on open; restore on close.
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

  // Focus trap: Tab / Shift+Tab cycle inside the dialog.
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

  const retry = () => {
    registrationStartedRef.current = false
    setFinishError(null)
    setCopied(false)
    setCopyFailed(false)
    login.retry()
  }

  const showError =
    finishError != null ||
    login.state === 'error' ||
    login.state === 'timeout' ||
    registration.state === 'error'

  const errorText =
    finishError ??
    (login.state === 'timeout'
      ? 'Your wallet did not respond in time. Scan the QR again — or open dForum in a browser on the same device your wallet is installed on.'
      : login.state === 'error'
        ? (login.error ?? 'Something went wrong. Try again.')
        : login.state === 'registering' && registration.state === 'error'
          ? `Key registration failed${registration.error ? `: ${registration.error}` : '.'}`
          : null)

  const stepText =
    login.state === 'complete' || registration.state === 'complete'
      ? 'Signing you in…'
      : registration.state === 'waiting'
          ? 'Waiting for wallet to sign the registration…'
          : registration.state === 'verifying'
            ? 'Verifying keys…'
            : login.state === 'waiting'
              ? 'Waiting for wallet…'
              : login.state === 'registering'
                ? 'Registering keys with your wallet…'
                : 'Preparing wallet sign-in…'

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

        <div className="mt-6 flex flex-col items-center gap-4">
          {(login.state === 'idle' || login.state === 'generating') && (
            <>
              <Loader2 className="w-8 h-8 animate-spin text-[#4db3ff]" aria-hidden="true" />
              <p className="text-sm text-[#93a1bd]">Preparing wallet sign-in…</p>
            </>
          )}

          {(login.state === 'waiting' || login.state === 'decrypting' || login.state === 'checking') && (
            <>
              <div className="p-3 bg-white rounded-xl border-2 border-[#008CE7]">
                {displayUri && (
                  <QRCodeSVG value={displayUri} size={208} level="M" includeMargin={false} fgColor="#000000" bgColor="#FFFFFF" role="img" aria-label="Login URI QR code" />
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Scan with your Dash wallet</p>
                <p className="text-xs text-[#93a1bd] mt-1">
                  {remaining != null ? `Expires in ${formatTime(remaining)}` : 'Waiting for wallet…'}
                </p>
              </div>
              {displayUri && (
                <>
                  <button
                    onClick={copy}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#93a1bd] hover:bg-[#18233c] hover:text-white transition"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'URI copied' : 'Copy URI'}
                  </button>
                  {copyFailed && (
                    <div className="w-full">
                      <p className="text-xs text-amber-400">Copy failed — select the URI below</p>
                      <input readOnly value={displayUri} onFocus={(e) => e.target.select()} className="mt-1 w-full rounded-lg border border-[#22304e] bg-[#0b1220] px-2 py-1.5 text-[10px] font-mono text-[#93a1bd]" aria-label="Login URI" />
                    </div>
                  )}
                  <p className="text-[11px] text-[#93a1bd] text-center">
                    Scan the QR with your wallet, or paste the URI into it.
                  </p>
                </>
              )}
            </>
          )}

          {login.state === 'registering' && (
            <>
              <div className="p-3 bg-white rounded-xl border-2 border-[#008CE7]">
                {registration.uri ? (
                  <QRCodeSVG value={registration.uri} size={208} level="M" includeMargin={false} fgColor="#000000" bgColor="#FFFFFF" role="img" aria-label="Key registration QR code" />
                ) : (
                  <Loader2 className="w-24 h-24 animate-spin text-[#008CE7]" aria-hidden="true" />
                )}
              </div>
              <div className="text-center">
                {registration.state === 'building' && (
                  <p className="text-sm font-medium">Building key registration…</p>
                )}
                {registration.state === 'waiting' && (
                  <>
                    <p className="text-sm font-medium">Register dForum keys</p>
                    <p className="text-xs text-[#93a1bd] mt-1">Scan with your wallet and sign the registration</p>
                    {registration.remainingTime != null && (
                      <p className="text-xs text-[#93a1bd] mt-1">Expires in {formatTime(registration.remainingTime)}</p>
                    )}
                  </>
                )}
                {registration.state === 'verifying' && (
                  <p className="text-sm font-medium flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-[#4db3ff]" aria-hidden="true" /> Verifying keys…</p>
                )}
              </div>
            </>
          )}

          {(login.state === 'complete' || registration.state === 'complete') && (
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
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" /> {finishError ? 'Login failed' : (login.state === 'timeout' ? 'Timed out' : 'Login failed')}
                </p>
                <p className="text-xs text-[#93a1bd] mt-2">{errorText}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={retry} className="btn-primary px-4 py-2 text-sm font-medium">
                  Try again
                </button>
                {onClose && (
                  <button
                    onClick={onClose}
                    className="inline-flex items-center gap-2 rounded-lg border border-[#22304e] px-4 py-2 text-sm hover:bg-[#18233c] transition"
                  >
                    Close
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[#93a1bd] flex items-center justify-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
          Your wallet signs — dForum keeps a HIGH-level auth key for this tab only.
        </p>
      </div>
    </div>
  )
}
