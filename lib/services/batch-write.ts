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
import type { Document, IdentityPublicKey, StateTransition } from '@dashevo/wasm-sdk'
import { getSdk } from '@/lib/services/evo-sdk-service'
import { CONTRACT_ID } from '@/lib/constants'

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
  /** After an ambiguous failure: did the write land anyway? */
  landed?: (documentId: string) => Promise<boolean>
}

const TRANSIENT = /Tenderdash is not available|\(code 14\)|UNAVAILABLE|Deadline expired|timed out|no available (addresses|nodes)|connection (refused|reset)|transport error/i
const errText = (e: unknown) => String((e as { message?: unknown })?.message ?? e)

/**
 * Builds, signs and broadcasts the batched write, waiting for the proof.
 * Returns the document id — for a create, the id consensus derives (the
 * transition mirrors it back onto the document); for a replace, the id
 * already on the document.
 */
export async function batchedWrite(args: BatchWriteArgs): Promise<string> {
  // Defence in depth on the signing path — the chain's key bounds already
  // enforce both, but a caller bug should refuse before signing, not after.
  if (!args.ownerId) throw new Error('Batched write requires an owner id')
  const documentContractId = args.document.dataContractId?.toBase58?.() ?? null
  if (documentContractId && documentContractId !== CONTRACT_ID) {
    throw new Error(`Refusing to sign a write for contract ${documentContractId} — dForum contract is ${CONTRACT_ID}`)
  }
  const documentOwnerId = args.document.ownerId?.toBase58?.() ?? null
  if (documentOwnerId && documentOwnerId !== args.ownerId) {
    throw new Error('Batched write owner does not match the document owner')
  }
  const { BatchedTransition, BatchTransition, DocumentCreateTransition, DocumentReplaceTransition, PrivateKey } = await import('@dashevo/evo-sdk')
  let transition
  if (args.kind === 'create') {
    transition = new DocumentCreateTransition({ document: args.document, identityContractNonce: args.nonce }).toDocumentTransition()
  } else {
    // The document carries the new revision; some SDK builds bump it again inside the
    // transition constructor, so pin it to what the chain expects (current + 1).
    const replace = new DocumentReplaceTransition({ document: args.document, identityContractNonce: args.nonce })
    const wanted = args.document.revision
    if (wanted !== undefined && replace.revision !== wanted) replace.revision = wanted
    transition = replace.toDocumentTransition()
  }
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
  const documentId = args.document.id?.toBase58?.() ?? ''
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await sdk.stateTransitions.broadcastAndWait(stateTransition)
        break
      } catch (e) {
        if (documentId && args.landed && (await args.landed(documentId).catch(() => false))) break
        if (attempt >= 3 || !TRANSIENT.test(errText(e))) throw e
        await new Promise((r) => setTimeout(r, 1500 * attempt))
      }
    }
  } finally {
    stateTransition.free()
  }

  // After construction the create transition writes the derived id back onto
  // the document; the replace keeps its existing id. Either way it is the id
  // the chain stores.
  const id = args.document.id
  if (!id) throw new Error('The write produced no document id')
  return id.toBase58()
}
