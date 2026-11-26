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
import { Check, Copy, Loader2, KeyRound, ShieldCheck, X } from 'lucide-react'
import { useYapprKeyExchangeLogin, useYapprKeyRegistration } from 'platform-auth'
import { useSession } from '@/lib/session'
import { formatTime } from '@/lib/utils'

export function KeyExchangeModal({ onClose }: { onClose?: () => void }) {
  const { controller } = useSession()
  const login = useYapprKeyExchangeLogin(controller)
  const registration = useYapprKeyRegistration(controller)
  const [copied, setCopied] = useState(false)
  const [completing, setCompleting] = useState(false)
  const registrationStartedRef = useRef(false)

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
      console.error('login failed', err)
    }
  }, [completing, controller, login, registration, onClose])

  // Finish login when the exchange completes (keys already registered)
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
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — ignore
    }
  }

  const closing = login.state === 'complete' || registration.state === 'complete'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl border border-[#22304e] bg-[#111a2e] shadow-2xl p-6">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-2 text-[#93a1bd] hover:bg-[#18233c] hover:text-white transition"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-lg font-bold tracking-tight">Login with Dash</h2>
        <p className="text-sm text-[#93a1bd] mt-1">Sign in to dForum with your Dash identity</p>

        <div className="mt-6 flex flex-col items-center gap-4">
          {(login.state === 'idle' || login.state === 'generating') && (
            <>
              <Loader2 className="w-8 h-8 animate-spin text-[#4db3ff]" />
              <p className="text-sm text-[#93a1bd]">Preparing wallet sign-in…</p>
            </>
          )}

          {(login.state === 'waiting' || login.state === 'decrypting' || login.state === 'checking') && (
            <>
              <div className="p-3 bg-white rounded-xl border-2 border-[#008CE7]">
                {displayUri && (
                  <QRCodeSVG value={displayUri} size={208} level="M" includeMargin={false} fgColor="#000000" bgColor="#FFFFFF" />
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Scan with Dash Evo Tool</p>
                <p className="text-xs text-[#93a1bd] mt-1">
                  {remaining != null ? `Expires in ${formatTime(remaining)}` : 'Waiting for wallet…'}
                </p>
              </div>
              {displayUri && (
                <button
                  onClick={copy}
                  className="inline-flex items-center gap-2 text-xs text-[#93a1bd] hover:text-white transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'URI copied' : 'Copy URI'}
                </button>
              )}
            </>
          )}

          {login.state === 'registering' && (
            <>
              <div className="p-3 bg-white rounded-xl border-2 border-[#008CE7]">
                {registration.uri ? (
                  <QRCodeSVG value={registration.uri} size={208} level="M" includeMargin={false} fgColor="#000000" bgColor="#FFFFFF" />
                ) : (
                  <Loader2 className="w-24 h-24 animate-spin text-[#008CE7]" />
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
                  <p className="text-sm font-medium flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-[#4db3ff]" /> Verifying keys…</p>
                )}
              </div>
            </>
          )}

          {(login.state === 'complete' || registration.state === 'complete') && (
            <>
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/15">
                <ShieldCheck className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-emerald-400">Signing you in…</p>
            </>
          )}

          {(login.state === 'error' || login.state === 'timeout') && (
            <>
              <div className="text-center">
                <p className="text-sm font-medium text-red-400">{login.error ?? 'Login failed'}</p>
                <p className="text-xs text-[#93a1bd] mt-2">The wallet did not respond in time. Try again.</p>
              </div>
              <button
                onClick={() => login.retry()}
                className="inline-flex items-center gap-2 rounded-lg border border-[#22304e] px-4 py-2 text-sm hover:bg-[#18233c] transition"
              >
                Try again
              </button>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[#93a1bd] flex items-center justify-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" />
          Your wallet signs everything — nothing is sent to us.
        </p>
      </div>
    </div>
  )
}
