'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MessageSquare, KeyRound, ShieldCheck, Sparkles } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { KeyExchangeModal } from '@/components/KeyExchangeModal'
import { useSession } from '@/lib/session'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
  const { session, ready, authError } = useSession()
  const [showModal, setShowModal] = useState(false)

  const alreadySignedIn = Boolean(session)

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="fade-up">
              <p className="inline-flex items-center gap-2 rounded-full border border-[#22304e] bg-[#111a2e] px-3 py-1 text-xs text-[#4db3ff]">
                <Sparkles className="w-3.5 h-3.5" />
                Login with Dash
              </p>
              <h1 className="mt-4 text-3xl sm:text-4xl font-bold leading-tight tracking-tight">
                Sign in with your<br />Dash identity
              </h1>
              <p className="mt-4 text-[#93a1bd]">
                No accounts, no passwords, no email. Your identity is a Dash Platform
                identity — you sign in by scanning a QR code with your wallet.
              </p>

              <div className="mt-6 space-y-3 text-sm">
                <Benefit icon={<ShieldCheck className="w-4 h-4" />} text="Your identity stays yours — no central server" />
                <Benefit icon={<KeyRound className="w-4 h-4" />} text="Only your wallet signs — the app never sees your keys" />
                <Benefit icon={<MessageSquare className="w-4 h-4" />} text="All posts, profiles and reactions live on-chain" />
              </div>

              {alreadySignedIn ? (
                <div className="mt-8 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
                  <p className="text-sm font-medium text-emerald-400">You are signed in</p>
                  <p className="text-xs text-[#93a1bd] mt-1 font-mono truncate">{session?.identityId}</p>
                  <Link href="/" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/30 transition">
                    Go to dForum
                  </Link>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setShowModal(true)}
                    disabled={!ready}
                    className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#008CE7] hover:bg-[#006bb3] transition px-5 py-3 font-semibold shadow-lg shadow-[#008CE7]/20 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {!ready ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
                    Login with Dash
                  </button>
                  {authError && (
                    <p className="mt-3 text-sm text-red-400">{authError}</p>
                  )}
                </>
              )}
            </div>

            <div className="rounded-2xl border border-[#22304e] bg-[#111a2e] p-6">
              <ol className="space-y-5">
                <Step number={1} title="Scan the QR" body="Open your Dash wallet and scan the dash-key: code shown in the login modal." />
                <Step number={2} title="Approve the request" body="Confirm the key-exchange request in your wallet." />
                <Step number={3} title="Keys registered (first login)" body="On first login you'll register auth keys with dForum — scan a second code." />
                <Step number={4} title="You're in" body="Your session lives in this tab only. Nothing is stored server-side." />
              </ol>
            </div>
          </div>
        </div>
      </main>
      <Footer />

      {showModal && <KeyExchangeModal onClose={() => setShowModal(false)} />}
    </>
  )
}

function Benefit({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex items-center justify-center w-7 h-7 rounded-lg bg-[#18233c] text-[#4db3ff] shrink-0">{icon}</span>
      <p className="text-[#93a1bd]">{text}</p>
    </div>
  )
}

function Step({ number, title, body }: { number: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[#008CE7]/15 text-[#4db3ff] text-sm font-bold shrink-0">{number}</span>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-[#93a1bd] mt-0.5">{body}</p>
      </div>
    </li>
  )
}
