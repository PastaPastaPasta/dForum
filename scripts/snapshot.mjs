#!/usr/bin/env node
/**
 * Static-index snapshot builder.
 *
 * Queries the dForum contract on Platform and writes data/snapshot.json — the
 * build-time data the static pages render first. The Pages build reads only
 * this file (never the network) so the site stays static + indexable.
 *
 * Bounded: all forums/categories, the latest threads, and proved counts.
 * The lists are a bounded window, not the full history — every page re-queries
 * the platform live after hydration, and the sitemap carries the SEO surface.
 *
 * Orphan rule (settled 2026-11-26, data-model.md): the opening post of a
 * thread is the earliest *visible* post whose $ownerId equals the thread
 * owner, ordered by ($createdAt, $id). A thread is listed only if such a post
 * exists. Orphan status is decided per thread (one ascending query per
 * thread) so the rule holds no matter how old the window is — no dependence
 * on a global post window.
 *
 * Posts are deliberately NOT shipped: every client page imports the snapshot
 * bundle, so shipping bodies would put all content in every visitor's JS.
 * Threads carry title/tags/owner/forum and are re-queried live after hydration.
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
const LIST_LIMIT = 50;
const FETCH_CONCURRENCY = 4;

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

  const [categories, forums, threads, reactionCount] = await Promise.all([
    queryList(sdk, 'category', { limit: LIST_LIMIT }),
    queryList(sdk, 'forum', { limit: LIST_LIMIT }),
    queryList(sdk, 'thread', { orderBy: [['$createdAt', 'desc']], limit: THREAD_LIMIT }),
    countDocuments(sdk, 'reaction'),
  ]);

  const forumMap = new Map(forums.map((f) => [f.id, f]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Moderated content is never published on the static index — it stays
  // on-chain (the records remain public) but neither the sitemap nor any
  // prerendered page shows it.
  const visibleThreads = threads.filter((t) => t.properties?.modState == null);

  // Lock enforcement: a post created after its thread was locked is not
  // visible to the static index (the lock is moderator-set by hand; the
  // network never enforces it).
  const isBefore = (a, b) => a.$createdAt < b.$createdAt || (a.$createdAt === b.$createdAt && a.id < b.id);

  // Orphan rule, per thread: the thread is listed iff it has a visible post
  // whose $ownerId equals the thread owner — the opening post. One ascending
  // query per thread (in batches) — the window is never guessed.
  const openingByThread = new Map();
  for (let i = 0; i < visibleThreads.length; i += FETCH_CONCURRENCY) {
    const batch = visibleThreads.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map(async (t) => {
      const ownerId = t.$ownerId;
      if (!ownerId) return { thread: t, opening: null };
      const lockedAt = t.properties?.lockedAt ?? null;
      // The opening post is the earliest visible owner-owned post of the
      // thread. One ascending byThread query per thread (the two-key
      // owner+thread where is rejected by the network — no index covers it),
      // with a wider fallback when the first 10 posts hide the opening post.
      const visibleAndOwned = (p) =>
        p.$ownerId === ownerId && p.properties?.modState == null && (lockedAt == null || p.$createdAt <= lockedAt);
      const early = await queryList(sdk, 'post', {
        where: [['threadId', '==', t.id]],
        orderBy: [['$createdAt', 'asc']],
        limit: 10,
      });
      let opening = early.find(visibleAndOwned) ?? null;
      if (!opening) {
        const wide = await queryList(sdk, 'post', {
          where: [['threadId', '==', t.id]],
          orderBy: [['$createdAt', 'asc']],
          limit: 50,
        });
        opening = wide.find(visibleAndOwned) ?? null;
      }
      return { thread: t, opening };
    }));
    for (const { thread, opening } of results) {
      if (opening) openingByThread.set(thread.id, opening);
    }
  }

  const hiddenByOrphan = new Set(visibleThreads.filter((t) => !openingByThread.has(t.id)).map((t) => t.id));
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

  // Completeness gate: with the thread window bounded to the latest 60 and
  // the count proved authoritative, fail loudly if we could not list any
  // content that exists. (Moderated content is excluded from the static
  // index by design, so the gate compares what is *listed*, not what exists.)
  // Completeness gate. Only documentsCountable types expose a proved count;
  // forum/category are NOT countable in this deployment, so the only honest
  // check for them is the window-limit tell — a fetch filling the window
  // means content we cannot count, so fail loudly rather than silently cap.
  const provedThreads = await countDocuments(sdk, 'thread');
  const provedPosts = await countDocuments(sdk, 'post');
  if (forums.length >= LIST_LIMIT) {
    throw new Error(`completeness gate: forum fetch filled the ${LIST_LIMIT}-doc window — more forums exist than the static index can list`);
  }
  if (categories.length >= LIST_LIMIT) {
    throw new Error(`completeness gate: category fetch filled the ${LIST_LIMIT}-doc window — more categories exist than the static index can list`);
  }
  if (provedThreads > 0 && listedThreads.length === 0) {
    throw new Error(`completeness gate: proved ${provedThreads} threads but listed 0 (or none in the window)`);
  }

  const counts = {
    categories: categories.length,
    forums: forums.length,
    threads: provedThreads,
    posts: provedPosts,
    reactions: reactionCount,
  };

  const hiddenModerated = threads.length - visibleThreads.length;
  const hiddenOrphan = hiddenByOrphan.size;
  if (hiddenModerated > 0) {
    console.log(`snapshot: excluded ${hiddenModerated} moderated thread(s) from the static index`);
  }
  if (hiddenOrphan > 0) {
    console.log(`snapshot: excluded ${hiddenOrphan} thread(s) hidden by the orphan rule`);
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
  };

  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  const size = JSON.stringify(snapshot).length;
  console.log(`snapshot written: ${OUT} (${(size / 1024).toFixed(1)} KB) — ${listedThreads.length} threads (of ${provedThreads} proved), ${counts.posts} posts, ${counts.forums} forums`);
  process.exit(0);
}

async function queryList(sdk, type, options) {
  const page = await sdk.documents.query({
    dataContractId: CONTRACT_ID,
    documentTypeName: type,
    where: options.where,
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
  if (value instanceof Uint8Array) return bs58.encode(value);
  if (Array.isArray(value) && value.length === 32) return bs58.encode(Uint8Array.from(value));
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
  // Errors here fail the build — the gate is the whole point; a swallowed
  // count would let a broken snapshot through silently.
  const map = await sdk.documents.count({
    dataContractId: CONTRACT_ID,
    documentTypeName: type,
  });
  let total = 0n;
  for (const v of map.values()) total += v;
  return Number(total);
}

main().catch((e) => {
  const parts = [];
  for (const k of ['message', 'name', 'code']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  console.error('ERROR:', parts.join(' | '));
  process.exit(1);
});
