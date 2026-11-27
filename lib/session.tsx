'use client'

/**
 * Application session: who is signed in, plus the auth key WIF used to sign
 * writes on the platform (kept in sessionStorage, tab-scoped).
 *
 * Wraps the vendored PlatformAuthProvider (App Connect v2). The controller
 * owns the login/logout protocol; this provider mirrors its state into the
 * app's simpler session shape.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { PlatformAuthProvider, usePlatformAuth } from 'platform-auth'
import { createAuthController } from '@/lib/auth/controller'
import { secretStore } from '@/lib/auth/adapters'
import { hostIsCanonical, LOGIN_AVAILABLE } from '@/lib/host'
import type { SessionData } from '@/lib/types'
import type { PlatformAuthController } from 'platform-auth'

const SessionContext = createContext<{
  controller: PlatformAuthController
  session: SessionData | null
  ready: boolean
  isAuthRestoring: boolean
  authError: string | null
  signOut: () => Promise<void>
}>({
  controller: null as unknown as PlatformAuthController,
  session: null,
  ready: false,
  isAuthRestoring: true,
  authError: null,
  signOut: async () => undefined,
})

export function SessionProvider({ children }: { children: ReactNode }) {
  const controller = useMemo(() => createAuthController(), [])
  return (
    <PlatformAuthProvider controller={controller}>
      <SessionBridge controller={controller}>{children}</SessionBridge>
    </PlatformAuthProvider>
  )
}

function SessionBridge({ children, controller }: { children: ReactNode; controller: PlatformAuthController }) {
  const auth = usePlatformAuth()
  const [authKeyWif, setAuthKeyWif] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  // The session restore + the signing-key read are both gated to the
  // canonical host: on any other origin the snapshot must not be rehydrated
  // and the key must never be pulled from storage — a same-origin page here
  // has nothing to sign with. Skipping restore keeps the whole session
  // machinery (and the ~30 MB SDK) off the public read-only deploy.
  // `gated` starts null (unknown — skeleton, SSR-safe), then becomes true
  // when the restore is allowed, or false when the gate refuses.
  const [gated, setGated] = useState<boolean | null>(null)
  const hostAllowed = () => LOGIN_AVAILABLE && hostIsCanonical(window.location.hostname)

  // Restore the session once on mount.
  useEffect(() => {
    const allowed = hostAllowed()
    setGated(allowed)
    if (!allowed) {
      // The vendored controller stays in isAuthRestoring:true forever when
      // restoreSession() never runs — ready must come from the gate, not
      // from the vendored state.
      setReady(true)
      return
    }
    let cancelled = false
    auth
      .restoreSession()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const user = auth.user
  const identityId = user?.identityId ?? null

  // Pull the auth key WIF for the signed-in identity (for signing writes).
  useEffect(() => {
    if (!identityId || !hostAllowed()) {
      setAuthKeyWif(null)
      return
    }
    let cancelled = false
    Promise.resolve(secretStore.getPrivateKey(identityId))
      .then((wif) => {
        if (!cancelled) setAuthKeyWif(wif)
      })
      .catch(() => {
        // Signing key unavailable — the profile still renders; writes refuse.
        if (!cancelled) setAuthKeyWif(null)
      })
    return () => {
      cancelled = true
    }
  }, [identityId, auth.user])

  // If the session snapshot disappears (logout/expiry), forget the key.
  useEffect(() => {
    if (!user) {
      // controller already clears storage on logout; make sure the mirror clears
      setAuthKeyWif(null)
    }
  }, [user])

  const session: SessionData | null = identityId
    ? {
        identityId,
        authKeyWif,
        username: user?.username,
      }
    : null

  const signOut = async () => {
    try {
      await auth.logout()
    } catch {
      // ignore
    }
    setAuthKeyWif(null)
  }

  return (
    <SessionContext.Provider
      value={{
        controller,
        session,
        // On the gated (read-only) deploy the vendored controller never
        // leaves isAuthRestoring — readiness comes from the gate itself.
        ready: ready && (gated === null ? false : gated ? !auth.isAuthRestoring : true),
        isAuthRestoring: auth.isAuthRestoring,
        authError: auth.error,
        signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  return useContext(SessionContext)
}

