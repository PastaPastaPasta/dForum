'use client'

/** Raw document reads from Platform, normalized to the snapshot's RawDoc shape. */
import type { RawDoc } from '@/lib/forum/types'
import { getSdk } from '@/lib/services/evo-sdk-service'
import { CONTRACT_ID } from '@/lib/constants'

type Where = [string, string, unknown][]
type OrderBy = [string, 'asc' | 'desc'][]

const plain = (v: unknown) => (typeof v === 'bigint' ? Number(v) : v)

export function toRaw(doc: { toJSON(): Record<string, unknown> }): RawDoc {
  const j = doc.toJSON()
  const p: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(j)) if (!k.startsWith('$') && v !== null && v !== undefined) p[k] = plain(v)
  const raw: RawDoc = {
    id: String(j.$id),
    ownerId: String(j.$ownerId),
    revision: Number(j.$revision ?? 1),
    createdAt: Number(j.$createdAt ?? 0),
    updatedAt: Number(j.$updatedAt ?? j.$createdAt ?? 0),
    p,
  }
  if (j.$moderatedAt != null) raw.moderatedAt = Number(j.$moderatedAt)
  return raw
}

export async function queryPage(type: string, opts: { where?: Where; orderBy?: OrderBy; limit?: number; startAfter?: string }) {
  const sdk = await getSdk()
  const res = await sdk.documents.query({
    dataContractId: CONTRACT_ID,
    documentTypeName: type,
    where: (opts.where ?? []) as never,
    orderBy: (opts.orderBy ?? []) as never,
    limit: opts.limit ?? 100,
    ...(opts.startAfter ? { startAfter: opts.startAfter } : {}),
  })
  const docs: RawDoc[] = []
  let last: string | undefined
  for (const [key, doc] of res) {
    last = String(key)
    if (doc) docs.push(toRaw(doc as never))
  }
  return { docs, last, full: res.size >= (opts.limit ?? 100) }
}

/** Pages through an index; stops at maxPages (returns `truncated`). */
export async function queryAll(type: string, opts: { where?: Where; orderBy?: OrderBy }, maxPages = 10) {
  const out: RawDoc[] = []
  let startAfter: string | undefined
  for (let i = 0; i < maxPages; i++) {
    const page = await queryPage(type, { ...opts, startAfter })
    out.push(...page.docs)
    if (!page.full || !page.last) return { docs: out, truncated: false }
    startAfter = page.last
  }
  return { docs: out, truncated: true }
}

export async function getDoc(type: string, id: string): Promise<RawDoc | null> {
  const sdk = await getSdk()
  const doc = await sdk.documents.get(CONTRACT_ID, type, id)
  return doc ? toRaw(doc as never) : null
}
