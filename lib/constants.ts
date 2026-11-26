/**
 * Deployment constants. Values come from env at build time; the real contract
 * id is also recorded in contracts/deployments/testnet.json.
 */
import deploymentRecord from '../contracts/deployments/testnet.json'

const record = deploymentRecord as {
  network?: string
  contracts?: {
    team?: { contractId?: string }
    none?: { contractId?: string }
    network?: { contractId?: string }
  }
}

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || record?.network || 'testnet') as 'testnet' | 'mainnet'

export const CONTRACT_ID =
  process.env.NEXT_PUBLIC_DFORUM_CONTRACT_ID ||
  record?.contracts?.team?.contractId ||
  record?.contracts?.none?.contractId ||
  record?.contracts?.network?.contractId ||
  ''

export const KEY_EXCHANGE_CONTRACT_ID = process.env.NEXT_PUBLIC_KEY_EXCHANGE_CONTRACT_ID || '7UaqHGBJBbRLJ4fUWS45cnud8PPUugJWoGTt1SKwHJ2P'

export const IDENTITY_ID = process.env.NEXT_PUBLIC_DFORUM_OWNER_ID || ''

export const APP_NAME = 'dForum'
export const APP_TAGLINE = 'A decentralized forum on Dash Platform'

export const NETWORK_IDS: Record<string, string> = {
  mainnet: 'm',
  testnet: 't',
  devnet: 'd',
}

/** localStorage/sessionStorage keys — scoped per deployment. */
export const STORAGE_KEY_PREFIX = process.env.NEXT_PUBLIC_STORAGE_SCOPE || 'dforum'
export const SESSION_KEY = `${STORAGE_KEY_PREFIX}:session`
export const SESSION_AU_KEY = `${STORAGE_KEY_PREFIX}:session:auth`

/** App chrome + content limits mirrored from contracts/build.mjs. */
export const LIMITS = {
  title: 150,
  body: 4000,
  bio: 1000,
  tagline: 160,
  description: 500,
  announcement: 500,
  maxTags: 5,
  maxReplies: 5,
} as const

export const KIND_REACTIONS = ['like', 'upvote', 'heart', 'fire', 'clap', 'star', 'thumbsup', 'meh'] as const
