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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [identityId, ready])

  if (ready && !session) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="text-center fade-up">
            <p className="text-sm uppercase tracking-widest text-[#93a1bd]">Login required</p>
            <h1 className="text-2xl font-bold mt-2">Sign in to manage your profile</h1>
            <Link href="/login" className="mt-6 inline-block rounded-lg bg-[#0070c0] px-4 py-2 font-medium text-white hover:bg-[#005fa0] transition">Login with Dash</Link>
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
    if (!loaded) return

    const displayName = draft.displayName.trim().slice(0, LIMITS.displayName)
    const website = draft.website.trim()
    if (website && !safeHttpUrl(website)) {
      setError('Website must be a full http(s) URL, e.g. https://example.com')
      return
    }
    if (!displayName) {
      setError('Display name is required.')
      return
    }

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
        const updated = await replaceDocument(
          {
            id: profileId,
            ownerId: identityId ?? '',
            dataContractId: '',
            documentTypeName: 'profile',
            revision,
            createdAt: 0,
            updatedAt: 0,
            properties: existingProps,
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
      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <Link href={`/u/${encodeURIComponent(identityId ?? '')}`} className="text-sm text-[#93a1bd] hover:text-white transition">← Profile</Link>
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
              <Loader2 className="w-5 h-5 animate-spin text-[#4db3ff] mx-auto" />
              <p className="mt-2 text-sm text-[#93a1bd]">Loading your profile…</p>
            </div>
          ) : (
            <form onSubmit={handleSave} className="mt-6 space-y-5">
              <div>
                <label htmlFor="displayName" className="text-sm font-medium text-[#93a1bd]">Display name</label>
                <input
                  id="displayName"
                  value={draft.displayName}
                  onChange={(e) => { setDraft((d) => ({ ...d, displayName: e.target.value })); setSaved(false) }}
                  required
                  maxLength={LIMITS.displayName}
                  className="mt-1.5 rounded-lg border border-[#22304e] bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] focus:outline-none w-full"
                  placeholder="Your display name"
                />
                <CharCount count={draft.displayName.length} max={LIMITS.displayName} />
              </div>
              <div>
                <label htmlFor="bio" className="text-sm font-medium text-[#93a1bd]">Bio</label>
                <textarea
                  id="bio"
                  value={draft.bio}
                  onChange={(e) => { setDraft((d) => ({ ...d, bio: e.target.value })); setSaved(false) }}
                  maxLength={LIMITS.bio}
                  rows={4}
                  className="mt-1.5 rounded-lg border border-[#22304e] bg-[#111a2e] p-3 text-sm focus:border-[#008CE7] focus:outline-none w-full resize-y"
                  placeholder="A short bio — what you post about."
                />
                <CharCount count={draft.bio.length} max={LIMITS.bio} />
              </div>
              <div>
                <label htmlFor="website" className="text-sm font-medium text-[#93a1bd]">Website</label>
                <input
                  id="website"
                  type="url"
                  inputMode="url"
                  value={draft.website}
                  onChange={(e) => { setDraft((d) => ({ ...d, website: e.target.value })); setSaved(false) }}
                  maxLength={LIMITS.website}
                  className="mt-1.5 rounded-lg border border-[#22304e] bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] focus:outline-none w-full"
                  placeholder="https://yoursite.com"
                  aria-describedby="website-hint"
                />
                <p id="website-hint" className="mt-1 text-xs text-[#93a1bd]">Full https URL only — this is the only link other people will click.</p>
              </div>
              <div>
                <label htmlFor="signature" className="text-sm font-medium text-[#93a1bd]">Signature</label>
                <input
                  id="signature"
                  value={draft.signature}
                  onChange={(e) => { setDraft((d) => ({ ...d, signature: e.target.value })); setSaved(false) }}
                  maxLength={LIMITS.signature}
                  className="mt-1.5 rounded-lg border border-[#22304e] bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] focus:outline-none w-full"
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
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0070c0] hover:bg-[#005fa0] transition px-5 py-3 font-semibold disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
                </button>
                {saved && !saving && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400"><ShieldCheck className="w-4 h-4" /> Saved to the platform</span>
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
