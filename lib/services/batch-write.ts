'use client'

/**
 * Batched document writes — the signing path contract-bound keys require
 * (Platform refuses a non-batch transition from a bound key: 20013).
 *
 * One write, one batch: a single-member BatchTransition wrapping one
 * DocumentCreateTransition or DocumentReplaceTransition, signed as a
 * StateTransition and broadcast through the SDK's broadcastAndWait. This is
 * the same byte layout the unbound legacy path produces, just wrapped in a
 * batch.
 */
import {
  BatchedTransition,
  BatchTransition,
  DocumentCreateTransition,
  DocumentReplaceTransition,
  PrivateKey,
  type Document,
  type IdentityPublicKey,
  type StateTransition,
} from '@dashevo/wasm-sdk'
import { getSdk } from '@/lib/services/evo-sdk-service'

export type BatchWriteKind = 'create' | 'replace'

export interface BatchWriteArgs {
  kind: BatchWriteKind
  /** The document as constructed: revision 1 on create (id re-derived from
   * entropy + nonce), revision + 1 and its id set on replace. */
  document: Document
  ownerId: string
  nonce: bigint
  authKeyWif: string
  identityKey: IdentityPublicKey
}

/**
 * Builds, signs and broadcasts the batched write, waiting for the proof.
 * Returns the document id — for a create, the id consensus derives (the
 * transition mirrors it back onto the document); for a replace, the id
 * already on the document.
 */
export async function batchedWrite(args: BatchWriteArgs): Promise<string> {
  const transition =
    args.kind === 'create'
      ? new DocumentCreateTransition({ document: args.document, identityContractNonce: args.nonce }).toDocumentTransition()
      : new DocumentReplaceTransition({ document: args.document, identityContractNonce: args.nonce }).toDocumentTransition()
  const batched = new BatchedTransition(transition)
  const stateTransition: StateTransition = BatchTransition.fromBatchedTransitions([batched], args.ownerId, 0).toStateTransition()
  stateTransition.setIdentityContractNonce(args.nonce)

  const privateKey = PrivateKey.fromWIF(args.authKeyWif)
  try {
    stateTransition.sign(privateKey, args.identityKey)
  } finally {
    privateKey.free()
  }

  const sdk = await getSdk()
  await sdk.stateTransitions.broadcastAndWait(stateTransition)
  stateTransition.free()

  // After construction the create transition writes the derived id back onto
  // the document; the replace keeps its existing id. Either way it is the id
  // the chain stores.
  const id = args.document.id
  if (!id) throw new Error('The write produced no document id')
  return id.toBase58()
}
