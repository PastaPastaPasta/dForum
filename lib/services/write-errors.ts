/**
 * Classify platform write errors so the UI can show honest, actionable copy.
 *
 * The vendor module (platform-auth) maps consensus codes to an action:
 *   logout — the key is gone (disabled/removed); the session must not survive.
 *   renew  — the key died on its own budget/expiry; sign in again.
 *   handoff/invalidate — not a key problem; plain message.
 *
 * Consensus codes arrive from the wasm SDK as `.code` on the error object,
 * on its `.errors[]` entries, or embedded in the message text — try all three
 * in order and fall back to null (unknown write failure).
 */
import { classifyAppConnectError, type AppConnectErrorClassification } from 'platform-auth'

export function consensusCodeOf(err: unknown): number | null {
  const seen = new Set<unknown>()
  let cur = err
  let depth = 0
  while (cur != null && depth < 12) {
    if (typeof cur === 'string') {
      const m = cur.match(/\b(200\d{2}|402\d{2})\b/)
      return m ? Number(m[1]) : null
    }
    if (typeof cur !== 'object') return null
    if (seen.has(cur)) return null
    seen.add(cur)
    depth += 1
    const direct = (cur as { code?: unknown }).code
    if (typeof direct === 'number' && Number.isInteger(direct) && direct > 0) return direct
    const dpp = (cur as { consensusCode?: unknown }).consensusCode
    if (typeof dpp === 'number' && Number.isInteger(dpp) && dpp > 0) return dpp
    const msg = (cur as { message?: unknown }).message
    if (typeof msg === 'string') {
      const m = msg.match(/\b(200\d{2}|402\d{2})\b/)
      if (m) return Number(m[1])
    }
    const cause = (cur as { cause?: unknown }).cause
    if (cause !== undefined && cause !== cur) {
      cur = cause
      continue
    }
    const errors = (cur as { errors?: unknown }).errors
    if (Array.isArray(errors) && errors.length > 0) {
      cur = errors[0]
      continue
    }
    return null
  }
  return null
}

export function classifyWriteError(err: unknown): AppConnectErrorClassification | null {
  const code = consensusCodeOf(err)
  if (code === null) return null
  return classifyAppConnectError(code)
}

/** Best human-readable text for any thrown value (wasm SDK errors are not Error instances). */
export function errorText(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; kind?: unknown; code?: unknown; toString?: () => string }
    const msg = typeof e.message === 'string' && e.message ? e.message : ''
    if (msg) return typeof e.code === 'number' && !msg.includes(String(e.code)) ? `${msg} (code ${e.code})` : msg
    const str = typeof e.toString === 'function' ? e.toString() : ''
    if (str && str !== '[object Object]') return str
  }
  return 'The write failed for an unknown reason.'
}

/** The actionable copy for a failed write, plus whether the session should be torn down. */
export function writeFailureMessage(err: unknown): {
  message: string
  classification: AppConnectErrorClassification | null
  sessionLogout: boolean
} {
  const text = errorText(err)
  if (/is banned on contract|code 41107/i.test(text)) {
    return { message: 'Moderators have banned your identity from posting on this forum.', classification: null, sessionLogout: false }
  }
  if (/suspended/i.test(text) && /contract/i.test(text)) {
    return { message: 'Your identity is suspended on this forum for now. Try again after the suspension ends.', classification: null, sessionLogout: false }
  }
  const classification = classifyWriteError(err)
  if (!classification) {
    return { message: errorText(err), classification: null, sessionLogout: false }
  }
  switch (classification.action) {
    case 'logout':
      return {
        message: 'Your dForum key was revoked or removed from your identity — sign in again to write.',
        classification,
        sessionLogout: true,
      }
    case 'renew':
      return {
        message: 'Your dForum session key expired or ran out of budget — sign in again to write.',
        classification,
        sessionLogout: false,
      }
    default:
      return {
        message: errorText(err),
        classification,
        sessionLogout: false,
      }
  }
}
