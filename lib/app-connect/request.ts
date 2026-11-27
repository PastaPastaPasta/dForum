/**
 * dForum's App Connect v2 request + URIs.
 *
 * One request, one body — a carrier only wraps the same bytes in its own URI.
 * Mainnet emits `dashpay://connect` alone (the protocol carrier, required
 * there). Testnet keeps the transitional `dash-key:` as a fallback for wallets
 * that have not shipped the new carrier: the primary QR and the first link
 * are always dashpay://connect, the fallback is a second link only.
 */
import bs58 from 'bs58'
import {
  buildAppConnectUri,
  KeySecurityLevel,
  type AppConnectCarrier,
  type AppConnectRequest,
} from 'platform-auth'
import {
  APP_CONNECT_BUDGET,
  APP_CONNECT_LABEL,
  APP_CONNECT_LIFETIME_MS,
} from './config'
import { CONTRACT_ID } from '@/lib/constants'
import type { YapprKeyExchangeNetworkName } from 'platform-auth'

export interface BuildDForumAppConnectRequestInput {
  /** Fresh compressed secp256k1 public key (33 bytes). */
  appEphemeralPubKey: Uint8Array
  /** 16 bytes, per (browser install, network). */
  connectionId: Uint8Array
  /** ms since epoch. */
  createdAt: number
}

export function buildDForumAppConnectRequest(input: BuildDForumAppConnectRequestInput): AppConnectRequest {
  const contractId = bs58.decode(CONTRACT_ID)
  if (contractId.length !== 32) throw new Error('dForum contract id is not a 32-byte id')

  return {
    appEphemeralPubKey: input.appEphemeralPubKey,
    appId: contractId,
    label: APP_CONNECT_LABEL,
    authBindings: [
      {
        kind: 'singleContract',
        id: contractId,
        securityLevel: KeySecurityLevel.HIGH,
        totalBudget: APP_CONNECT_BUDGET,
        expiresAt: input.createdAt + APP_CONNECT_LIFETIME_MS,
      },
    ],
    encBindings: [],
    createdAt: input.createdAt,
    connectionId: input.connectionId,
  }
}

export function appConnectCarriers(network: YapprKeyExchangeNetworkName): AppConnectCarrier[] {
  if (network === 'mainnet') return ['dashpay']
  return ['dashpay', 'dash-key']
}

export function buildDForumAppConnectUris(
  request: AppConnectRequest,
  network: YapprKeyExchangeNetworkName,
): Array<{ carrier: AppConnectCarrier; uri: string }> {
  return appConnectCarriers(network).map((carrier) => ({
    carrier,
    uri: buildAppConnectUri(request, network, undefined, carrier),
  }))
}
