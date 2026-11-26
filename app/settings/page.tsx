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
import { shortId } from '@/lib/utils'

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
          setDraft({ ...EMPTY, displayName: shortId(identityId, 20) })
          setProfileId(null)
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
            <Link href="/login" className="mt-6 inline-block rounded-lg bg-[#008CE7] px-4 py-2 font-medium text-white hover:bg-[#006bb3] transition">Login with Dash</Link>
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
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      if (profileId) {
        await replaceDocument(
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
          { ...draft, website: draft.website.trim(), displayName: draft.displayName.trim() || shortId(identityId ?? '', 20) },
        )
      } else {
        await createDocument('profile', identityId ?? '', session.authKeyWif, {
          displayName: draft.displayName.trim() || shortId(identityId ?? '', 20),
          bio: draft.bio.trim().slice(0, LIMITS.bio),
          website: draft.website.trim().slice(0, 200),
          signature: draft.signature.trim().slice(0, LIMITS.description),
        })
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
          <Link href={`/u?id=${encodeURIComponent(identityId ?? '')}`} className="text-sm text-[#93a1bd] hover:text-white transition">← Profile</Link>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-[#93a1bd]">Your profile lives on-chain — every save is a platform write.</p>

          <div className="mt-6 flex items-center gap-4 rounded-xl border border-[#22304e] bg-[#111a2e] p-4">
            <Avatar name={draft.displayName || identityId || 'dForum'} />
            <div className="min-w-0">
              <p className="font-medium truncate">{draft.displayName || shortId(identityId ?? '', 20)}</p>
              <p className="text-xs font-mono text-[#93a1bd] truncate">{identityId ? shortId(identityId, 24) : '…'}</p>
            </div>
          </div>

          <form onSubmit={handleSave} className="mt-6 space-y-5">
            <Field label="Display name" max={80}>
              <input
                value={draft.displayName}
                onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))}
                maxLength={80}
                className="rounded-lg border border-[#22304e] bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] focus:outline-none w-full"
                placeholder="Your display name"
              />
            </Field>
            <Field label="Bio" max={LIMITS.bio}>
              <textarea
                value={draft.bio}
                onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
                maxLength={LIMITS.bio}
                rows={4}
                className="rounded-lg border border-[#22304e] bg-[#111a2e] p-3 text-sm focus:border-[#008CE7] focus:outline-none w-full resize-y"
                placeholder="A short bio — what you post about."
              />
              <CharCount count={draft.bio.length} max={LIMITS.bio} />
            </Field>
            <Field label="Website" max={200}>
              <input
                value={draft.website}
                onChange={(e) => setDraft((d) => ({ ...d, website: e.target.value }))}
                maxLength={200}
                className="rounded-lg border border-[#22304e] bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] focus:outline-none w-full"
                placeholder="https://yoursite.com"
              />
            </Field>
            <Field label="Signature" max={LIMITS.description}>
              <input
                value={draft.signature}
                onChange={(e) => setDraft((d) => ({ ...d, signature: e.target.value }))}
                maxLength={LIMITS.description}
                className="rounded-lg border border-[#22304e] bg-[#111a2e] px-3 py-2.5 text-sm focus:border-[#008CE7] focus:outline-none w-full"
                placeholder="A sign-off for your posts"
              />
            </Field>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-[#008CE7] hover:bg-[#006bb3] transition px-5 py-3 font-semibold disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
            </button>
            {saved && !saving && (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400 ml-3"><ShieldCheck className="w-4 h-4" /> Saved to the platform</span>
            )}
          </form>

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

function Field({ label, children }: { label: string; max: number; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-[#93a1bd]">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function CharCount({ count, max }: { count: number; max: number }) {
  return <p className="mt-1 text-xs text-[#93a1bd] text-right">{count}/{max}</p>
}
