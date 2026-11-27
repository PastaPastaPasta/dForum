'use client'

/**
 * Client-side EvoSDK singleton. Imported by client components only.
 *
 * The SDK is loaded lazily (dynamic import) so the ~30 MB WASM chunk never
 * blocks the initial page load — it is only fetched when a page actually
 * needs the platform. connect() resolves the current trusted nodes.
 */
import { NETWORK } from '@/lib/constants'

type EvoSDK = import('@dashevo/evo-sdk').EvoSDK
type DocumentModule = typeof import('@dashevo/evo-sdk')

let sdk: EvoSDK | null = null
let initPromise: Promise<EvoSDK> | null = null

async function init(): Promise<EvoSDK> {
  if (sdk) return sdk
  const { EvoSDK } = await import('@dashevo/evo-sdk')
  const candidate = NETWORK === 'mainnet'
    ? EvoSDK.mainnetTrusted({ settings: { timeoutMs: 60000, retries: 2 } })
    : EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000, retries: 2 } })
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

type DocumentCls = DocumentModule['Document']
type IdentitySignerCls = DocumentModule['IdentitySigner']

type SdkClasses = {
  Document: DocumentCls
  IdentitySigner: IdentitySignerCls
}

let sdkClassesPromise: Promise<SdkClasses> | null = null

/** Lazily load the SDK's classes — the ~30 MB chunk stays off the first paint. */
export function getSdkClasses(): Promise<SdkClasses> {
  if (!sdkClassesPromise) {
    sdkClassesPromise = import('@dashevo/evo-sdk').then((mod) => ({
      Document: mod.Document,
      IdentitySigner: mod.IdentitySigner,
    }))
  }
  return sdkClassesPromise
}

