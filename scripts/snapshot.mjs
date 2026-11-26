#!/usr/bin/env node
/**
 * Static-index snapshot builder.
 *
 * Queries the dForum contract on Platform and writes data/snapshot.json — the
 * build-time data the static pages render first. The Vercel/GitHub Pages build
 * reads only this file (never the network) so the site stays static + indexable.
 *
 * Bounded: all forums/categories, latest threads + posts, counts — no full history.
 *
 * Usage: node scripts/snapshot.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { EvoSDK } from '@dashevo/evo-sdk';
import bs58 from 'bs58';

const CONTRACT_ID = process.env.NEXT_PUBLIC_DFORUM_CONTRACT_ID || readContractId();
const NETWORK = process.env.NEXT_PUBLIC_NETWORK || 'testnet';
const OUT = 'data/snapshot.json';
const THREAD_LIMIT = 60;
const POST_LIMIT = 80;

function readContractId() {
  try {
    const record = JSON.parse(readFileSync('contracts/deployments/testnet.json', 'utf8'));
    return record.contracts?.team?.contractId || record.contracts?.none?.contractId || record.contracts?.network?.contractId;
  } catch {
    return null;
  }
}

function shortStr(s, max = 400) {
  if (s == null) return '';
  const str = String(s);
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

async function main() {
  if (!CONTRACT_ID) {
    console.error('NEXT_PUBLIC_DFORUM_CONTRACT_ID is not set and contracts/deployments/testnet.json has no contract id');
    process.exit(1);
  }
  console.log('snapshot: contract', CONTRACT_ID, 'network', NETWORK);

  await EvoSDK.getLatestVersionNumber();
  const sdk = NETWORK === 'mainnet'
    ? EvoSDK.mainnetTrusted({ settings: { timeoutMs: 60000 } })
    : EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } });
  await sdk.connect();

  const [categories, forums, threads, posts, reactionCounts] = await Promise.all([
    queryList(sdk, 'category', { limit: 50 }),
    queryList(sdk, 'forum', { limit: 50 }),
    queryList(sdk, 'thread', { orderBy: [['$createdAt', 'desc']], limit: THREAD_LIMIT }),
    queryList(sdk, 'post', { orderBy: [['$createdAt', 'desc']], limit: POST_LIMIT }),
    countReactions(sdk),
  ]);

  const forumMap = new Map(forums.map((f) => [f.id, f]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Moderated content is never published on the static index — it stays
  // on-chain (the records remain public) but neither the sitemap nor any
  // prerendered page shows it.
  const visibleThreads = threads.filter((t) => t.properties?.modState == null);
  // Lock enforcement: a post created after its thread was locked is not
  // shown in the static index (the lock is moderator-set by hand; the
  // network never enforces it).
  const lockedAtById = new Map(visibleThreads.map((t) => [t.id, t.properties?.lockedAt ?? null]));
  const visiblePosts = posts.filter((p) => {
    if (p.properties?.modState != null) return false;
    const lockedAt = lockedAtById.get(p.properties?.threadId);
    if (lockedAt != null && (p.$createdAt ?? 0) > lockedAt) return false;
    return true;
  });

  // Orphan rule: a thread is listed only when its earliest visible post
  // belongs to the thread owner (data-model.md). Without an owner-owned
  // post the thread is hidden from listings — the URL still renders live.
  const postsByThread = new Map();
  for (const p of visiblePosts) {
    const threadId = p.properties?.threadId;
    if (!threadId) continue;
    if (!postsByThread.has(threadId)) postsByThread.set(threadId, []);
    postsByThread.get(threadId).push(p);
  }
  const hiddenByOrphan = new Set(
    visibleThreads
      .filter((t) => {
        const ps = postsByThread.get(t.id) ?? [];
        if (ps.length === 0) return true;
        const earliest = ps.reduce((a, b) => (a.$createdAt < b.$createdAt ? a : b));
        return earliest.$ownerId !== t.$ownerId;
      })
      .map((t) => t.id),
  );
  const listedThreads = visibleThreads.filter((t) => !hiddenByOrphan.has(t.id));

  const snapshotThreads = listedThreads.map((t) => ({
    id: t.id,
    forumId: t.properties?.forumId ?? null,
    forumSlug: forumMap.get(t.properties?.forumId)?.properties?.slug ?? null,
    title: shortStr(t.properties?.title),
    tags: Array.isArray(t.properties?.tags) ? t.properties.tags : [],
    sticky: Boolean(t.properties?.sticky),
    lockedAt: t.properties?.lockedAt ?? null,
    modState: null,
    ownerId: t.$ownerId ?? null,
    createdAt: t.$createdAt ?? 0,
    updatedAt: t.$updatedAt ?? 0,
  }));

  const snapshotPosts = visiblePosts.map((p) => ({
    id: p.id,
    threadId: p.properties?.threadId ?? null,
    forumId: p.properties?.forumId ?? null,
    forumSlug: forumMap.get(p.properties?.forumId)?.properties?.slug ?? null,
    body: shortStr(p.properties?.body, 2000),
    modState: null,
    ownerId: p.$ownerId ?? null,
    createdAt: p.$createdAt ?? 0,
  }));

  // Completeness gate: if the proved count says there is content the raw
  // queries did not return, fail loudly — the deploy keeps the last good
  // snapshot. (Moderated content is counted separately and excluded.)
  const provedThreads = await countDocuments(sdk, 'thread');
  const provedPosts = await countDocuments(sdk, 'post');
  if (threads.length === 0 && provedThreads > 0) {
    throw new Error(`completeness gate: proved ${provedThreads} threads but listed 0`);
  }
  if (posts.length === 0 && provedPosts > 0) {
    throw new Error(`completeness gate: proved ${provedPosts} posts but listed 0`);
  }

  const counts = {
    categories: categories.length,
    forums: forums.length,
    threads: provedThreads,
    posts: provedPosts,
    reactions: reactionCounts,
  };

  const hiddenTotal = (threads.length - visibleThreads.length) + (posts.length - visiblePosts.length);
  if (hiddenTotal > 0) {
    console.log(`snapshot: excluded ${hiddenTotal} moderated document(s) from the static index`);
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    network: NETWORK,
    contractId: CONTRACT_ID,
    counts,
    categories: categories.map((c) => ({
      id: c.id,
      slug: c.properties?.slug ?? null,
      title: shortStr(c.properties?.title),
      description: shortStr(c.properties?.description),
      sort: c.properties?.sort ?? 0,
    })),
    forums: forums.map((f) => ({
      id: f.id,
      categoryId: f.properties?.categoryId ?? null,
      categorySlug: categoryMap.get(f.properties?.categoryId)?.properties?.slug ?? null,
      slug: f.properties?.slug ?? null,
      title: shortStr(f.properties?.title),
      description: shortStr(f.properties?.description),
      sort: f.properties?.sort ?? 0,
      archived: Boolean(f.properties?.archived),
    })),
    threads: snapshotThreads,
    posts: snapshotPosts,
  };

  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  const size = JSON.stringify(snapshot).length;
  console.log(`snapshot written: ${OUT} (${(size / 1024).toFixed(1)} KB) — ${threads.length} threads, ${posts.length} posts`);
  process.exit(0);
}

async function queryList(sdk, type, options) {
  const page = await sdk.documents.query({
    dataContractId: CONTRACT_ID,
    documentTypeName: type,
    orderBy: options.orderBy,
    limit: options.limit,
  });
  const out = [];
  for (const doc of page.values()) {
    const obj = doc.toObject?.() ?? doc;
    out.push(normalize(obj));
  }
  return out;
}

function normalize($obj) {
  const rawId = $obj.$id ?? $obj.id;
  const idStr = identifierify(rawId);
  const props = {};
  for (const [key, value] of Object.entries($obj)) {
    if (key.startsWith('$') || key === 'dataContractId' || key === 'documentTypeName' || key === 'revision') continue;
    props[key] = normalizeValue(value);
  }
  return {
    id: idStr,
    properties: props,
    $createdAt: Number($obj.$createdAt ?? $obj.createdAt ?? 0),
    $updatedAt: Number($obj.$updatedAt ?? $obj.updatedAt ?? 0),
    $ownerId: identifierify($obj.$ownerId ?? $obj.ownerId),
  };
}

/** Convert any identifier-like value to a base58 string. */
function identifierify(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    if (/^[0-9a-fA-F]{64}$/.test(value)) return bs58.encode(Buffer.from(value, 'hex'));
    try { return bs58.encode(bs58.decode(value)); } catch { return value; }
  }
  // Uint8Array / Array of bytes
  if (value instanceof Uint8Array) return bs58.encode(value);
  if (Array.isArray(value) && value.length === 32) return bs58.encode(Uint8Array.from(value));
  // object with numeric keys (byte array as plain object)
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    if (keys.length === 32 && keys.every((k) => /^\d+$/.test(k))) {
      const bytes = new Uint8Array(32);
      for (const k of keys) bytes[Number(k)] = Number(value[k]) & 0xff;
      return bs58.encode(bytes);
    }
  }
  return null;
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    // identifier array (e.g. tags is NOT an identifier; leave scalars)
    if (value.length === 0) return [];
    if (value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      return value.map((v) => normalizeValue(v));
    }
    const idents = value.map((v) => identifierify(v));
    return idents.every(Boolean) ? idents : value.map((v) => normalizeValue(v));
  }
  if (value instanceof Uint8Array) return identifierify(value);
  if (typeof value === 'object' && value !== null) {
    const asIdent = identifierify(value);
    if (asIdent) return asIdent;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeValue(v);
    return out;
  }
  return value;
}

async function countDocuments(sdk, type) {
  try {
    const map = await sdk.documents.count({
      dataContractId: CONTRACT_ID,
      documentTypeName: type,
    });
    let total = 0n;
    for (const v of map.values()) total += v;
    return Number(total);
  } catch {
    return 0;
  }
}

async function countReactions(sdk) {
  try {
    const map = await sdk.documents.count({
      dataContractId: CONTRACT_ID,
      documentTypeName: 'reaction',
    });
    let total = 0n;
    for (const v of map.values()) total += v;
    return Number(total);
  } catch {
    return 0;
  }
}

main().catch((e) => {
  const parts = [];
  for (const k of ['message', 'name', 'code']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  console.error('ERROR:', parts.join(' | '));
  process.exit(1);
});
