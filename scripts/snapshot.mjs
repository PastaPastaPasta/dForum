#!/usr/bin/env node
/**
 * Static-index snapshot builder.
 *
 * Queries the dForum contract on Platform and writes:
 *   data/snapshot.json      — forums, categories, threads (title/tags/owner/
 *                           forum/sticky/lockedAt), proved counts
 *   data/posts/<id>.json    — the first STATIC_POSTS visible posts of each
 *                           listed thread (the static pages render these)
 *
 * The Pages build reads only these files (never the network) so the site stays
 * static + indexable. The snapshot is a bounded window (it does not ship the
 * full history) — every page re-queries the platform live after hydration.
 *
 * Completeness gate: failures to FETCH (thread window, counts) fail the
 * build — that is the honest signal, and the last good deploy keeps serving.
 * An honest EMPTY answer (no listable threads) does NOT fail the build — the
 * SPA fallback covers the gap. A hidden/orphan thread is deliberately not
 * listed, never republished.
 *
 * Orphan rule (settled 2026-11-26, data-model.md): the opening post of a
 * thread is the earliest post whose $ownerId equals the thread owner, ordered
 * by ($createdAt, $id) — regardless of its moderation state. A thread is
 * listed only if that opening post is itself visible (not moderated, and
 * not past the lock). Orphan status is decided per thread (one ascending
 * query per thread) so the rule holds regardless of window age.
 *
 * Usage: node scripts/snapshot.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { EvoSDK } from '@dashevo/evo-sdk';
import bs58 from 'bs58';
import { redactWif } from './lib/redact.mjs';
import { beforePost, openingPostFromPosts } from '../lib/services/orphan-rules.ts';

const CONTRACT_ID = process.env.NEXT_PUBLIC_DFORUM_CONTRACT_ID || readContractId();
const NETWORK = process.env.NEXT_PUBLIC_NETWORK || 'testnet';
const OUT = 'data/snapshot.json';
const POSTS_DIR = 'data/posts';
const LISTED_TARGET = 60;       // how many listable threads to ship
const FETCH_LIMIT = 60;         // max posts fetched per query page
const HARD_CAP = 300;           // never scan more threads than this
const STATIC_POSTS = 5;          // visible posts shipped per listed thread
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

/** Page through the thread index with startAfter until LISTED_TARGET listable
 * threads are found or HARD_CAP is hit — so orphan spam cannot push every real
 * thread out of the window. The per-thread orphan checks run with bounded
 * concurrency. Throws on any fetch error (the honest failure). Returns the
 * listed threads AND whether the window filled — the caller writes the
 * honest "+" suffix on the home tile. */
async function fetchListableThreads(sdk) {
  const listed = [];
  const seenIds = new Set();
  let after = null;
  let scanned = 0;
  let page = 0;
  let indexExhausted = false;
  while (listed.length < LISTED_TARGET && scanned < HARD_CAP && page < 30) {
    page += 1;
    const pageDocs = await queryList(sdk, 'thread', {
      orderBy: [['$createdAt', 'desc']],
      limit: FETCH_LIMIT,
      ...(after ? { startAfter: after } : {}),
    });
    if (pageDocs.length === 0) { indexExhausted = true; break; }
    scanned += pageDocs.length;
    const candidates = [];
    for (const doc of pageDocs) {
      if (doc.properties?.modState != null) continue;
      if (seenIds.has(doc.id)) continue;
      seenIds.add(doc.id);
      candidates.push(doc);
    }
    for (let i = 0; i < candidates.length; i += FETCH_CONCURRENCY) {
      if (listed.length >= LISTED_TARGET) break;
      const batch = candidates.slice(i, i + FETCH_CONCURRENCY);
      const checked = await Promise.all(batch.map(async (doc) => {
        const opening = await openingPost(sdk, doc);
        return opening ? { thread: doc, opening } : null;
      }));
      for (const item of checked) {
        if (item && listed.length < LISTED_TARGET) listed.push(item);
      }
    }
    // A short page (fewer docs than the limit) means the index is exhausted.
    if (pageDocs.length < FETCH_LIMIT) { indexExhausted = true; break; }
    after = pageDocs[pageDocs.length - 1].id;
  }
  // The window counts as filled only when more threads may remain past the
  // window — an index that ran dry (or the scan budget exhausted by design)
  // is not "+".
  const windowFilled = listed.length >= LISTED_TARGET && !indexExhausted;
  return { listed, windowFilled };
}

/** ($createdAt, $id) ordering — shared with the live app (orphan-rules.ts). */
function isBefore(a, b) {
  return beforePost({ createdAt: a.$createdAt, id: a.id }, { createdAt: b.$createdAt, id: b.id });
}

/** The opening post (orphan rule): the earliest post whose $ownerId equals
 * the thread owner, ordered by ($createdAt, $id) — regardless of moderation
 * state. Located via the post.byAuthor index ($ownerId + $createdAt >=
 * thread.$createdAt) so pre-opening spam cannot hide it. The thread is
 * listable only if that opening post is itself visible (not moderated, and
 * not past the lock). Fails closed here — a failed read throws and fails the
 * build (honest gate). */
async function openingPost(sdk, thread) {
  const ownerId = thread.$ownerId;
  if (!ownerId) return null;
  const lockedAt = thread.properties?.lockedAt ?? null;
  const where = [['$ownerId', '==', ownerId]];
  if (thread.$createdAt != null) where.push(['$createdAt', '>=', thread.$createdAt]);
  // Page through the author's owner-posts until the thread's opening post
  // appears. A short/empty page is a legitimate "no opening post" (null);
  // exhausting the 12-page budget without a break/return is a scan failure
  // — an unknown, not "no opening post", so it must fail the build, not
  // drop the thread from the index.
  let after = null;
  for (let page = 0; page < 12; page++) {
    const posts = await queryList(sdk, 'post', {
      where,
      orderBy: [['$createdAt', 'asc']],
      limit: 25,
      ...(after ? { startAfter: after } : {}),
    });
    if (posts.length === 0) return null; // index exhausted — no opening post
    const mine = posts.filter((p) => p.properties?.threadId === thread.id);
    const earliestOwner = openingPostFromPosts(
      mine.map((p) => ({ createdAt: p.$createdAt, id: p.id, ownerId: p.$ownerId ?? '' })),
      ownerId,
    );
    if (earliestOwner) {
      const opening = mine.find((p) => p.id === earliestOwner.id) ?? null;
      if (!opening) return null; // the chain returned a phantom id — refuse to list
      if (opening.properties?.modState != null) return null; // opening post hidden → not listed
      if (lockedAt != null && opening.$createdAt > lockedAt) return null;
      return opening;
    }
    if (posts.length < 25) return null; // short page — no opening post
    after = posts[posts.length - 1].id;
  }
  // Same honest failure as lib/services/orphan.ts's OrphanScanExhaustedError
  // ("orphan scan exhausted its page budget") — the loop completed without a
  // break/return, so the opening post may exist past the page budget.
  throw new Error('orphan scan exhausted its page budget');
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

  // Page through both indexes until they run dry — a 50-doc window cap is a
  // false-positive gate (a full page is not the same as a full index), and a
  // page that merely filled must not fail the build. Only the page budget is
  // a hard stop: a >1000-item index is a real failure worth surfacing.
  async function fetchAll(type, orderBy) {
    const out = [];
    let after = null;
    for (let page = 0; page < 20; page++) {
      const docs = await queryList(sdk, type, {
        // The forum contract carries no sort index (byCategory is composite) —
        // order only what an index serves.
        ...(orderBy ? { orderBy } : {}),
        limit: 50,
        ...(after ? { startAfter: after } : {}),
      });
      out.push(...docs);
      if (docs.length < 50) return out; // ran dry — no more pages
      after = docs[docs.length - 1].id;
    }
    throw new Error(`completeness gate: ${type} pagination hit the 20-page budget — the index exceeds what the static index can list`);
  }

  const [categories, forums, threadCount] = await Promise.all([
    fetchAll('category', [['sort', 'asc']]),
    fetchAll('forum', undefined),
    countDocuments(sdk, 'thread'),
  ]);

  const forumMap = new Map(forums.map((f) => [f.id, f]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Pages through the thread index until LISTED_TARGET listable threads are
  // found (or HARD_CAP is hit) so orphan spam can't hide every real thread.
  const { listed: listable, windowFilled } = await fetchListableThreads(sdk);

  // Resolve display names for the listed threads' owners — the first paint
  // (and the static pages' nameOf) uses these instead of truncated ids.
  const ownerIds = [...new Set(listable.map(({ thread }) => thread.$ownerId).filter(Boolean))];
  const profiles = {};
  for (let i = 0; i < ownerIds.length; i += 4) {
    const batch = ownerIds.slice(i, i + 4);
    const resolved = await Promise.all(batch.map(async (id) => {
      try {
        const docs = await queryList(sdk, 'profile', { where: [['$ownerId', '==', id]], limit: 1 });
        const doc = docs[0];
        if (!doc) return [id, null];
        if (doc.properties?.modState != null) return [id, 'Hidden profile'];
        const name = doc.properties?.displayName;
        return [id, typeof name === 'string' && name.trim() ? name.trim() : null];
      } catch {
        return [id, null];
      }
    }));
    for (const [id, name] of resolved) {
      if (name) profiles[id] = name;
    }
  }


  // Write per-thread static posts: the first STATIC_POSTS visible posts of
  // each listed thread, in ascending order, starting at the opening post.
  if (existsSync(POSTS_DIR)) rmSync(POSTS_DIR, { recursive: true, force: true });
  mkdirSync(POSTS_DIR, { recursive: true });
  // Counts the static index actually ships — hidden/orphaned threads and
  // hidden posts are deliberately excluded from public numbers.
  let visiblePosts = 0;
  for (const { thread: t, opening } of listable) {
    const lockedAt = t.properties?.lockedAt ?? null;
    // Start the static-posts query at the opening post — a thread whose
    // opening post sits far down the log must not ship zero posts. Page
    // until STATIC_POSTS visible posts are collected (or the thread runs
    // out) so hidden posts cannot silently eat the budget and ship fewer.
    const collected = [];
    let after = null;
    for (let page = 0; page < 4 && collected.length < STATIC_POSTS; page++) {
      const posts = await queryList(sdk, 'post', {
        where: [['threadId', '==', t.id], ['$createdAt', '>=', opening.$createdAt]],
        orderBy: [['$createdAt', 'asc']],
        limit: 25,
        ...(after ? { startAfter: after } : {}),
      });
      if (posts.length === 0) break;
      const fromOpening = posts.filter((p) => !isBefore(p, opening));
      for (const p of fromOpening) {
        if (collected.length >= STATIC_POSTS) break;
        if (p.properties?.modState != null) continue;
        if (lockedAt != null && p.$createdAt > lockedAt) continue;
        collected.push(p);
      }
      if (posts.length < 25) break;
      after = posts[posts.length - 1].id;
    }
    const visible = collected.slice(0, STATIC_POSTS)
      .map((p) => ({
        id: p.id,
        body: shortStr(p.properties?.body, 4000),
        authorId: p.$ownerId,
        createdAt: Number(p.$createdAt),
        updatedAt: Number(p.$updatedAt ?? p.$createdAt),
        modState: null,
        replyToId: typeof p.properties?.replyToId === 'string' ? p.properties.replyToId : null,
      }));
    visiblePosts += visible.length;
    writeFileSync(`${POSTS_DIR}/${t.id}.json`, JSON.stringify(visible) + '\n');
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    network: NETWORK,
    contractId: CONTRACT_ID,
    // counts reflect the honest, listed surface — not the total chain size
    // (hidden/orphaned threads are deliberately not public numbers).
    counts: {
      categories: categories.length,
      forums: forums.filter((f) => !f.properties?.archived).length,
      threads: listable.length,
      posts: visiblePosts,
    },
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
    threadsWindowFilled: windowFilled,
    threads: listable.map(({ thread: t }) => ({
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
    })),
    profiles,
  };

  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  const size = JSON.stringify(snapshot).length;
  console.log(`snapshot written: ${OUT} (${(size / 1024).toFixed(1)} KB) — ${listable.length} listed threads (of ${Number(threadCount)} proved), ${snapshot.counts.posts} posts shipped, ${snapshot.counts.forums} forums`);
  process.exit(0);
}

async function queryList(sdk, type, options) {
  const page = await sdk.documents.query({
    dataContractId: CONTRACT_ID,
    documentTypeName: type,
    where: options.where,
    orderBy: options.orderBy,
    limit: options.limit,
    ...(options.startAfter !== undefined ? { startAfter: options.startAfter } : {}),
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
  return total;
}

main().catch((e) => {
  const parts = [];
  for (const k of ['message', 'name', 'code']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  console.error('ERROR:', redactWif(parts.join(' | ')));
  process.exit(1);
});
