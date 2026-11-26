'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2, LogOut, Save, AlertCircle, ShieldCheck } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { Avatar } from '@/components/Avatar'
import { useSession } from '@/lib/session'
import { query, createDocument, replaceDocument } from '@/lib/services/document-service'
import { LIMITS } from '@/lib/constants'
import { shortId, safeHttpUrl } from '@/lib/utils'

interface ProfileDraft {
  displayName: string
  bio: string
  website: string
  signature: string
}

const EMPTY: ProfileDraft = { displayName: '', bio: '', website: '', signature: '' }

export default function SettingsPage() {
  const { session, ready, signOut } = useSession()
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [revision, setRevision] = useState<bigint>(1n)
  const [existingProps, setExistingProps] = useState<Record<string, unknown>>({})
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ displayName?: string; website?: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const identityId = session?.identityId ?? null

  useEffect(() => {
    if (!identityId || !ready) return
    let cancelled = false
    query('profile', { where: [['$ownerId', '==', identityId]], limit: 1 })
      .then((docs) => {
        if (cancelled) return
        const doc = docs[0]
        if (doc) {
          const p = doc.properties
          setDraft({
            displayName: (p.displayName as string) ?? '',
            bio: (p.bio as string) ?? '',
            website: (p.website as string) ?? '',
            signature: (p.signature as string) ?? '',
          })
          setProfileId(doc.id)
          setRevision(doc.revision)
          setExistingProps({ ...p })
        } else {
          setDraft({ ...EMPTY, displayName: '' })
          setProfileId(null)
          setRevision(1n)
          setExistingProps({})
        }
        setLoaded(true)
      })
      .catch(() => {
        // Never silently treat a failed load as "no profile exists" — that
        // would make save create a duplicate profile instead of updating one.
        if (!cancelled) {
          setLoadError(true)
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [identityId, ready])

  if (!ready) {
    // Session unresolved — a neutral skeleton, not the real page behind a
    // half-loaded session (the navbar shows not-signed-in for a moment).
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12" aria-busy="true" aria-live="polite">
            <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Loading…</p>
            <div className="mt-6 rounded-xl border border-[#22304e] bg-[#111a2e] p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-[#18233c] animate-pulse" aria-hidden="true" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-[#18233c] animate-pulse" aria-hidden="true" />
                <div className="h-3 w-24 rounded bg-[#18233c] animate-pulse" aria-hidden="true" />
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (!session) {
    return (
      <>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Login required</p>
            <h1 className="text-2xl font-bold mt-2">Sign in to manage your profile</h1>
            <Link href="/login?next=/settings" className="mt-6 btn-primary">Login with Dash</Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!session || !session.authKeyWif) {
      setError('Your session has no signable key. Try logging in again.')
      return
    }
    if (!loaded || loadError) return

    const displayName = draft.displayName.trim().slice(0, LIMITS.displayName)
    const website = draft.website.trim()
    const errs: { displayName?: string; website?: string } = {}
    if (!displayName) errs.displayName = 'Display name is required.'
    if (website && !safeHttpUrl(website)) errs.website = 'Website must be a full http(s) URL, e.g. https://example.com'
    if (Object.keys(errs).length) { setFieldError(errs); return }
    setFieldError(null)

    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const properties = {
        displayName,
        bio: draft.bio.trim().slice(0, LIMITS.bio),
        website: safeHttpUrl(website) ?? '',
        signature: draft.signature.trim().slice(0, LIMITS.signature),
      }
      if (profileId) {
        // Moderator-owned fields (customTitle, modState) are never sent by the
        // author — the contract rejects them and document-service's
        // buildAuthorUpdate passes the stored values through unchanged.
        const updated = await replaceDocument(
          {
            id: profileId,
            ownerId: identityId ?? '',
            dataContractId: '',
            documentTypeName: 'profile',
            revision,
            createdAt: 0,
            updatedAt: 0,
            properties: existingProps as Record<string, unknown>,
          },
          identityId ?? '',
          session.authKeyWif,
          properties,
        )
        setRevision(updated.revision)
      } else {
        const created = await createDocument('profile', identityId ?? '', session.authKeyWif, properties)
        setProfileId(created.id)
        setRevision(created.revision)
        setExistingProps({ ...properties })
      }
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save — try again in a moment')
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          {identityId && (
            <Link href={`/u/${encodeURIComponent(identityId)}`} className="text-sm text-[#93a1bd] hover:text-white transition">← Profile</Link>
          )}
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-[#93a1bd]">Your profile lives on-chain — every save is a platform write.</p>

          <div className="mt-6 flex items-center gap-4 rounded-xl border border-[#22304e] bg-[#111a2e] p-4">
            <Avatar name={draft.displayName || identityId || 'dForum'} id={identityId ?? null} />
            <div className="min-w-0">
              <p className="font-medium truncate">{draft.displayName || shortId(identityId ?? '', 20)}</p>
              <p className="text-xs font-mono text-[#93a1bd] truncate">{identityId ? shortId(identityId, 24) : '…'}</p>
            </div>
          </div>

          {!loaded ? (
            <div className="mt-8 rounded-xl border border-dashed border-[#22304e] p-8 text-center">
              <Loader2 className="w-5 h-5 animate-spin text-[#4db3ff] mx-auto" aria-hidden="true" />
              <p className="mt-2 text-sm text-[#93a1bd]">Loading your profile…</p>
            </div>
          ) : loadError ? (
            <div className="mt-8 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-center text-sm text-amber-400">
              Couldn&apos;t load your current profile — saving is disabled so we don&apos;t overwrite or duplicate it. Reload and try again.
            </div>
          ) : (
            <form noValidate onSubmit={handleSave} className="mt-6 space-y-5">
              <div>
                <label htmlFor="displayName" className="text-sm font-medium text-[#93a1bd]">Display name</label>
                <input
                  id="displayName"
                  value={draft.displayName}
                  onChange={(e) => { setDraft((d) => ({ ...d, displayName: e.target.value })); setSaved(false) }}
                  maxLength={LIMITS.displayName}
                  aria-invalid={Boolean(fieldError?.displayName)}
                  aria-describedby={fieldError?.displayName ? 'displayName-error' : undefined}
                  className="mt-1.5 rounded-lg border border-input bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] w-full"
                  placeholder="Your display name"
                />
                {fieldError?.displayName ? (
                  <p id="displayName-error" className="mt-1 text-xs text-red-400">{fieldError.displayName}</p>
                ) : (
                  <CharCount count={draft.displayName.length} max={LIMITS.displayName} />
                )}
              </div>
              <div>
                <label htmlFor="bio" className="text-sm font-medium text-[#93a1bd]">Bio</label>
                <textarea
                  id="bio"
                  value={draft.bio}
                  onChange={(e) => { setDraft((d) => ({ ...d, bio: e.target.value })); setSaved(false) }}
                  maxLength={LIMITS.bio}
                  rows={4}
                  className="mt-1.5 rounded-lg border border-input bg-[#111a2e] p-3 text-sm focus:border-[#008CE7] w-full resize-y"
                  placeholder="A short bio — what you post about."
                />
                <CharCount count={draft.bio.length} max={LIMITS.bio} />
              </div>
              <div>
                <label htmlFor="website" className="text-sm font-medium text-[#93a1bd]">Website <span className="text-[#93a1bd] font-normal">(optional)</span></label>
                <input
                  id="website"
                  type="url"
                  inputMode="url"
                  value={draft.website}
                  onChange={(e) => { setDraft((d) => ({ ...d, website: e.target.value })); setSaved(false) }}
                  maxLength={LIMITS.website}
                  aria-invalid={Boolean(fieldError?.website)}
                  aria-describedby={fieldError?.website ? 'website-error' : 'website-hint'}
                  className="mt-1.5 rounded-lg border border-input bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] w-full"
                  placeholder="https://yoursite.com"
                />
                {fieldError?.website ? (
                  <p id="website-error" className="mt-1 text-xs text-red-400">{fieldError.website}</p>
                ) : (
                  <p id="website-hint" className="mt-1 text-xs text-[#93a1bd]">Full http(s) URL only — this is rendered as a link on your profile.</p>
                )}
              </div>
              <div>
                <label htmlFor="signature" className="text-sm font-medium text-[#93a1bd]">Signature</label>
                <input
                  id="signature"
                  value={draft.signature}
                  onChange={(e) => { setDraft((d) => ({ ...d, signature: e.target.value })); setSaved(false) }}
                  maxLength={LIMITS.signature}
                  className="mt-1.5 rounded-lg border border-input bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] w-full"
                  placeholder="A sign-off for your posts"
                />
                <CharCount count={draft.signature.length} max={LIMITS.signature} />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary px-5 py-3 font-semibold"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
                  {saving ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
                </button>
                {saved && !saving && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400" role="status"><ShieldCheck className="w-4 h-4" aria-hidden="true" /> Saved to the platform</span>
                )}
              </div>
            </form>
          )}

          <div className="mt-10 border-t border-[#22304e] pt-6">
            <h2 className="text-sm font-medium text-[#93a1bd] uppercase tracking-wider">Session</h2>
            <p className="mt-2 text-sm text-[#93a1bd]">Your session lives in this tab only. Signing out clears your keys from this browser.</p>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-500/40 text-red-300 px-4 py-2 text-sm hover:bg-red-500/10 transition disabled:opacity-50"
            >
              <LogOut className="w-4 h-4" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}

function CharCount({ count, max }: { count: number; max: number }) {
  return <p className="mt-1 text-xs text-[#93a1bd] text-right">{count}/{max}</p>
}
