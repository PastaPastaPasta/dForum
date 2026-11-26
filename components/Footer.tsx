import { NETWORK } from '@/lib/constants'

export function Footer() {
  return (
    <footer className="border-t border-[#22304e] mt-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-sm text-[#93a1bd]">
        <div>
          <p className="font-medium text-[#e8edf7]">dForum</p>
          <p className="mt-1">A forum on Dash Platform — centralized ownership, team-based moderation</p>
        </div>
        <div className="text-xs leading-relaxed">
          All data on-chain · Login with Dash · {NETWORK === 'mainnet' ? 'Mainnet' : `${NETWORK.charAt(0).toUpperCase() + NETWORK.slice(1)} build`}
        </div>
      </div>
    </footer>
  )
}
