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

/** localStorage/sessionStorage scope — namespaces this app's keys by name.
 * Every same-origin page can read sessionStorage, so the host gate (lib/host.ts)
 * is what protects the key material, not this prefix. */
export const STORAGE_KEY_PREFIX = process.env.NEXT_PUBLIC_STORAGE_SCOPE || 'dforum'

/** App chrome + content limits mirrored from contracts/build.mjs. */
export const LIMITS = {
  title: 150,
  body: 4000,
  bodyMaxBytes: 5120,
  bio: 1000,
  displayName: 40,
  signature: 300,
  website: 200,
  maxTags: 5,
} as const
