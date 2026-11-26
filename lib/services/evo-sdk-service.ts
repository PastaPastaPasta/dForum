'use client'

/**
 * Client-side EvoSDK singleton. Imported by client components only.
 *
 * The SDK runs WASM in the browser; connect() resolves the current trusted
 * testnet nodes. The first call connects, later calls reuse the instance.
 */
import { EvoSDK } from '@dashevo/evo-sdk'
import { NETWORK } from '@/lib/constants'

let sdk: EvoSDK | null = null
let initPromise: Promise<EvoSDK> | null = null

async function init(): Promise<EvoSDK> {
  if (sdk) return sdk
  const candidate = NETWORK === 'mainnet'
    ? EvoSDK.mainnetTrusted({ settings: { timeoutMs: 60000 } })
    : EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } })
  await candidate.connect()
  sdk = candidate
  return sdk
}

export async function getSdk(): Promise<EvoSDK> {
  if (sdk) return sdk
  if (!initPromise) {
    initPromise = init()
  }
  try {
    return await initPromise
  } catch (error) {
    initPromise = null
    throw error
  }
}

/** Reset the singleton (e.g. on logout). The next getSdk() reconnects. */
export function resetSdk(): void {
  sdk = null
  initPromise = null
}
