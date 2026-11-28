#!/usr/bin/env node
/**
 * Backfill a XenForo 2 forum (dash.org/forum) into dForum.
 *
 *   crawl      fetch nodes, thread lists and threads into a local cache (resumable)
 *              --source html  public pages (optionally through the Wayback Machine: --wayback)
 *              --source api   XenForo REST API (XF-Api-Key with read access; the forum operator's key)
 *              --refresh      refetch the node index, forum lists and the newest thread pages, so a
 *                             later backfill picks up new threads and replies
 *   plan       counts, bytes, and estimated credits for what `load` would write
 *   structure  create categories/forums (owner-only types: signs with the contract OWNER key)
 *   load       write threads/posts as the ARCHIVIST identity, oldest first, resumable and
 *              idempotent (ledger + the unique byOrigin index)
 *   archive    close the forums marked with `structure --archive-forums` (owner key); run after
 *              load, since archived forums refuse all new threads and posts at consensus
 *   trust      --until now|open|<ISO>: close or reopen the window in which archivist documents
 *              are shown with their imported authors and dates (forumSettings.archiveTrustUntil)
 *
 * Key material never comes from flags. Testnet derives from the deployer seed in .env.local
 * (owner = identity index 0, archivist = --archivist-index, default 5). Elsewhere set
 * DFORUM_OWNER_WIF / DFORUM_ARCHIVIST_WIF (and DFORUM_OWNER_ID / DFORUM_ARCHIVIST_ID).
 *
 * The archivist must not be the contract owner or a moderator: moderators cannot remove
 * documents owned by the owner or other moderators, so archive takedowns would be impossible.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { redactWif } from '../lib/redact.mjs';
import { parseForumPage, parseNodeIndex, parseThreadPage } from '../../lib/import/xf-html.ts';
import { splitMarkdownByBytes, xfHtmlToMarkdown } from '../../lib/import/to-markdown.ts';
import { bbcodeToMarkdown } from '../../lib/import/bbcode.ts';
import { buildImportPlan, postChunks, threadDocProps, postDocProps, normalizeTags } from '../../lib/import/plan.ts';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string', default: 'html' },
    base: { type: 'string', default: 'https://www.dash.org/forum/' },
    wayback: { type: 'boolean', default: false },
    'wayback-stamp': { type: 'string', default: '2025' },
    'api-key-file': { type: 'string' },
    'api-user': { type: 'string', default: '1' },
    cache: { type: 'string', default: '.cache/import/dashorg' },
    forums: { type: 'string' },
    'max-threads': { type: 'string' },
    'max-pages': { type: 'string', default: '1000' },
    delay: { type: 'string', default: '1500' },
    network: { type: 'string', default: 'testnet' },
    'archivist-index': { type: 'string', default: '5' },
    'budget-dash': { type: 'string', default: '5' },
    limit: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
    'archive-forums': { type: 'string' },
    until: { type: 'string' },
  },
});
const command = positionals[0];
const CACHE = opts.cache;
const DELAY = Number(opts.delay);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1)); };
const log = (...a) => console.log('[import]', ...a);

// ---- crawl ---------------------------------------------------------------------------------

function sourceUrl(url) {
  return opts.wayback ? `https://web.archive.org/web/${opts['wayback-stamp']}id_/${url}` : url;
}

let lastFetch = 0;
async function fetchText(url, { headers = {}, attempts = 6, redirect = 'follow' } = {}) {
  for (let i = 1; ; i++) {
    const wait = lastFetch + DELAY - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetch = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': 'dForum-importer/1.0 (+https://forum.dashhq.org)', ...headers }, redirect });
    } catch (e) {
      if (i >= attempts) throw new Error(`fetch ${url}: ${e.message}`);
      await sleep(DELAY * 2 ** i);
      continue;
    }
    // Gone, or refused by the archive: skip the page rather than abort the crawl.
    if ([403, 404, 410, 451].includes(res.status)) { log(`skip ${url}: HTTP ${res.status}`); return null; }
    if (res.ok) return res.text();
    if (i >= attempts || ![408, 425, 429, 500, 502, 503, 504, 520, 522, 524].includes(res.status)) {
      throw new Error(`fetch ${url}: HTTP ${res.status}`);
    }
    const retryAfter = Number(res.headers.get('retry-after')) * 1000;
    await sleep(Math.max(retryAfter || 0, DELAY * 2 ** i));
  }
}

/** Raw pages are cached; `fresh` refetches (and re-caches) a page that may have changed. */
async function cachedPage(kind, key, url, fresh = false) {
  const path = join(CACHE, 'raw', kind, `${key}.html`);
  if (!fresh && existsSync(path)) return readFileSync(path, 'utf8');
  const html = await fetchText(sourceUrl(url));
  if (html === null) return null;
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, html);
  return html;
}

const base = opts.base.endsWith('/') ? opts.base : `${opts.base}/`;
const pageUrl = (url, page) => (page > 1 ? `${url.replace(/\/$/, '')}/page-${page}` : url);

async function crawlHtml() {
  const refresh = opts.refresh;
  const indexHtml = await cachedPage('index', 'index', base, refresh);
  if (!indexHtml) throw new Error(`no node index at ${base}`);
  const index = parseNodeIndex(indexHtml, base);
  const wanted = opts.forums ? new Set(opts.forums.split(',').map(Number)) : null;
  const maxThreads = opts['max-threads'] ? Number(opts['max-threads']) : Infinity;
  const structure = { categories: [] };
  const queue = [];
  for (const cat of index.categories) {
    const c = { origId: cat.origId, title: cat.title, description: cat.description, forums: [] };
    structure.categories.push(c);
    for (const node of cat.nodes) queue.push({ node, category: c, parent: null });
  }
  while (queue.length) {
    const { node, category, parent } = queue.shift();
    if (node.kind === 'link' || !node.origId) continue;
    const entry = { origId: node.origId, kind: node.kind, title: node.title, description: node.description, url: node.url, parentOrigId: parent, threads: [] };
    category.forums.push(entry);
    const included = !wanted || wanted.has(node.origId) || (parent !== null && wanted.has(parent));
    const html = await cachedPage('forum', `${node.origId}-1`, node.url, refresh);
    if (!html) { log(`forum ${node.origId} unavailable`); continue; }
    const first = parseForumPage(html, node.url);
    for (const sub of first.subNodes ?? []) queue.push({ node: sub, category, parent: node.origId });
    if (!included || node.kind !== 'forum') continue;
    const lastPage = Math.min(first.lastPage || 1, Number(opts['max-pages']));
    let threads = [...first.threads];
    for (let p = 2; p <= lastPage && threads.length < maxThreads; p++) {
      const ph = await cachedPage('forum', `${node.origId}-${p}`, pageUrl(node.url, p), refresh);
      if (ph) threads.push(...parseForumPage(ph, node.url).threads);
    }
    threads = threads.slice(0, maxThreads);
    log(`forum ${node.origId} "${node.title}": ${threads.length} threads`);
    for (const t of threads) {
      entry.threads.push(t.origId);
      const out = join(CACHE, 'threads', `${t.origId}.json`);
      const known = readJson(out, null);
      if (known && !refresh) continue;
      // On refresh only page 1 (for the page count) and pages from the last known one onward can
      // hold new replies; earlier pages come from the cache.
      const knownPages = known?.pages ?? 1;
      const th = await cachedPage('thread', `${t.origId}-1`, t.url, refresh);
      if (!th) { log(`thread ${t.origId} unavailable`); continue; }
      const page1 = parseThreadPage(th, t.url);
      const posts = [...page1.posts];
      const tLast = Math.min(page1.lastPage || 1, Number(opts['max-pages']));
      for (let p = 2; p <= tLast; p++) {
        const ph = await cachedPage('thread', `${t.origId}-${p}`, pageUrl(t.url, p), refresh && p >= knownPages);
        if (ph) posts.push(...parseThreadPage(ph, t.url).posts);
      }
      const seen = new Set();
      writeJson(out, {
        origId: t.origId,
        forumOrigId: node.origId,
        title: page1.title || t.title,
        author: t.author,
        createdAt: t.createdAt,
        sticky: t.sticky,
        locked: t.locked,
        tags: page1.tags ?? [],
        url: t.url,
        pages: tLast,
        posts: posts
          .filter((p) => !seen.has(p.origId) && seen.add(p.origId))
          .map((p) => ({ origId: p.origId, author: p.author, authorId: p.authorId ?? null, createdAt: p.createdAt, markdown: xfHtmlToMarkdown(p.html, { baseUrl: t.url }) })),
      });
    }
  }
  writeJson(join(CACHE, 'structure.json'), structure);
  log('crawl done');
}

async function crawlApi() {
  const keyFile = opts['api-key-file'];
  if (!keyFile) throw new Error('--source api needs --api-key-file (a XenForo API key with node/thread read scope)');
  const headers = { 'XF-Api-Key': readFileSync(keyFile, 'utf8').trim(), 'XF-Api-User': opts['api-user'] };
  const api = async (path) => {
    // The API key must never follow a redirect to another origin.
    const text = await fetchText(`${base}api/${path}`, { headers, redirect: 'error' });
    if (text === null) return null;
    return JSON.parse(text);
  };
  const nodes = (await api('nodes/flattened'))?.nodes_flat ?? [];
  const wanted = opts.forums ? new Set(opts.forums.split(',').map(Number)) : null;
  const maxThreads = opts['max-threads'] ? Number(opts['max-threads']) : Infinity;
  const structure = { categories: [] };
  const byId = new Map();
  for (const { node } of nodes) {
    if (node.parent_node_id === 0 && node.node_type_id === 'Category') {
      const c = { origId: node.node_id, title: node.title, description: node.description ?? '', forums: [] };
      structure.categories.push(c);
      byId.set(node.node_id, { category: c });
    }
  }
  for (const { node } of nodes) {
    if (byId.has(node.node_id)) continue;
    let top = byId.get(node.parent_node_id);
    let parentOrigId = node.parent_node_id;
    while (top && !top.category) top = byId.get(top.parent);
    if (!top) continue;
    if (byId.get(parentOrigId)?.category) parentOrigId = null;
    const kind = node.node_type_id === 'Forum' ? 'forum' : node.node_type_id === 'Category' ? 'category' : 'link';
    byId.set(node.node_id, { category: top.category, parent: node.parent_node_id });
    if (kind === 'link') continue;
    const entry = { origId: node.node_id, kind, title: node.title, description: node.description ?? '', url: node.view_url, parentOrigId, threads: [] };
    top.category.forums.push(entry);
    const included = !wanted || wanted.has(node.node_id) || (parentOrigId && wanted.has(parentOrigId));
    if (!included || kind !== 'forum') continue;
    for (let page = 1; entry.threads.length < maxThreads; page++) {
      const res = await api(`forums/${node.node_id}/threads?page=${page}&order=post_date&direction=asc`);
      const list = res?.threads ?? [];
      for (const t of list) {
        if (entry.threads.length >= maxThreads) break;
        if (t.discussion_state !== 'visible' || t.discussion_type === 'redirect') continue;
        entry.threads.push(t.thread_id);
        const out = join(CACHE, 'threads', `${t.thread_id}.json`);
        if (existsSync(out)) continue;
        const posts = [];
        for (let pp = 1; ; pp++) {
          const pr = await api(`threads/${t.thread_id}/posts?page=${pp}`);
          for (const p of pr?.posts ?? []) {
            if (p.message_state !== 'visible') continue;
            posts.push({ origId: p.post_id, author: p.username, authorId: p.user_id || null, createdAt: p.post_date * 1000, markdown: bbcodeToMarkdown(p.message, { baseUrl: base }) });
          }
          if (!pr?.pagination || pp >= pr.pagination.last_page) break;
        }
        writeJson(out, {
          origId: t.thread_id, forumOrigId: node.node_id, title: t.title, author: t.username, createdAt: t.post_date * 1000,
          sticky: !!t.sticky, locked: !t.discussion_open, tags: t.tags ?? [], url: t.view_url, posts,
        });
      }
      if (!res?.pagination || page >= res.pagination.last_page) break;
    }
    log(`forum ${node.node_id} "${node.title}": ${entry.threads.length} threads`);
  }
  writeJson(join(CACHE, 'structure.json'), structure);
  log('crawl done');
}

// ---- plan ----------------------------------------------------------------------------------

function loadCrawl() {
  const structure = readJson(join(CACHE, 'structure.json'), null);
  if (!structure) throw new Error(`no crawl in ${CACHE} — run crawl first`);
  const dir = join(CACHE, 'threads');
  const threads = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))) : [];
  return { structure, threads };
}

function plan() {
  const { structure, threads } = loadCrawl();
  const p = buildImportPlan(structure, threads);
  log(`categories ${p.categories}, forums ${p.forums}, threads ${p.threads}, posts ${p.posts} (+${p.continuations} continuation posts), body bytes ${p.bytes}`);
  log(`estimated cost ≈ ${(p.estimatedCredits / 1e11).toFixed(4)} DASH (thread ~0.0017, post ~0.0015 + size)`);
  log(`skipped: ${p.skipped.length} (${p.skipped.slice(0, 5).map((s) => s.reason).join('; ')})`);
  return p;
}

/** Structure ids are per contract: a new registration starts a fresh map. */
const mapFile = (contractId) => join(CACHE, `structure-map-${contractId}.json`);

// ---- platform ------------------------------------------------------------------------------

async function platform() {
  const sdkMod = await import('@dashevo/evo-sdk');
  const { EvoSDK } = sdkMod;
  const sdk = opts.network === 'mainnet'
    ? EvoSDK.mainnetTrusted({ settings: { timeoutMs: 60000, retries: 2 } })
    : EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000, retries: 2 } });
  await sdk.connect();
  const record = readJson(`contracts/deployments/${opts.network}.json`, {});
  const contractId = process.env.NEXT_PUBLIC_DFORUM_CONTRACT_ID || record.contracts?.team?.contractId;
  if (!contractId) throw new Error('no contract id');
  return { sdk, sdkMod, contractId, record };
}

async function signerFor(role, { sdk, sdkMod, record }) {
  const envWif = process.env[role === 'owner' ? 'DFORUM_OWNER_WIF' : 'DFORUM_ARCHIVIST_WIF'];
  let identityId = process.env[role === 'owner' ? 'DFORUM_OWNER_ID' : 'DFORUM_ARCHIVIST_ID'];
  let wif = envWif;
  let derivedKeyId;
  if (!wif) {
    if (opts.network !== 'testnet') throw new Error(`set DFORUM_${role.toUpperCase()}_WIF`);
    const { deriveIdentityKeys } = await import('../derive-identities.mjs');
    const index = role === 'owner' ? 0 : Number(opts['archivist-index']);
    const keys = deriveIdentityKeys(index);
    const k = keys.find((x) => x.securityLevel === (role === 'owner' ? 'CRITICAL' : 'HIGH') && x.purpose === 'AUTHENTICATION');
    wif = k.wif;
    derivedKeyId = k.keyIndex;
    if (role === 'owner') identityId = record.identity.id;
    else identityId = identityId || record.personas?.find((p) => p.index === index)?.id;
  }
  if (!identityId) throw new Error(`no ${role} identity id`);
  const identity = await sdk.identities.fetch(identityId);
  if (!identity) throw new Error(`${role} identity ${identityId} not found`);
  const keyId = derivedKeyId ?? Number(process.env[role === 'owner' ? 'DFORUM_OWNER_KEY_ID' : 'DFORUM_ARCHIVIST_KEY_ID']);
  const key = Number.isInteger(keyId) ? identity.getPublicKeyById(keyId) : null;
  if (!key) throw new Error(`${role} key not on identity ${identityId}`);
  const signer = new sdkMod.IdentitySigner();
  signer.addKeyFromWif(wif);
  return { identityId, key, signer };
}

async function createDoc(ctx, who, type, properties) {
  const { sdk, sdkMod, contractId } = ctx;
  const document = new sdkMod.Document({
    properties,
    documentTypeName: type,
    dataContractId: contractId,
    ownerId: who.identityId,
    revision: 1n,
    entropy: crypto.getRandomValues(new Uint8Array(32)),
  });
  const created = await sdk.documents.create({ document, identityKey: who.key, signer: who.signer });
  return created?.id?.toBase58?.() ?? document.id.toBase58();
}

/** Replaces a document and confirms the new revision landed (rc SDKs differ on who bumps it). */
async function replaceDoc(ctx, who, type, current, properties) {
  const document = new ctx.sdkMod.Document({
    properties, documentTypeName: type, dataContractId: ctx.contractId, ownerId: who.identityId,
    revision: BigInt(current.$revision) + 1n, id: current.$id,
  });
  await ctx.sdk.documents.replace({ document, identityKey: who.key, signer: who.signer });
  const after = await ctx.sdk.documents.get(ctx.contractId, type, current.$id);
  if (!after || Number(after.toJSON().$revision) <= Number(current.$revision)) throw new Error(`${type} ${current.$id}: replace did not land`);
}

async function findByOrigin(ctx, ownerId, type, origId) {
  const res = await ctx.sdk.documents.query({
    dataContractId: ctx.contractId,
    documentTypeName: type,
    where: [['$ownerId', '==', ownerId], ['origId', '==', origId]],
    orderBy: [['$ownerId', 'asc'], ['origId', 'asc']],
    limit: 1,
  });
  for (const [id, doc] of res) if (doc) return String(id);
  return null;
}

/** Retries a create; on an ambiguous failure, reconcile through byOrigin before resubmitting. */
async function idempotentCreate(ctx, who, type, props) {
  for (let i = 1; ; i++) {
    try {
      return await createDoc(ctx, who, type, props);
    } catch (e) {
      const msg = String(e?.message ?? e);
      const existing = await findByOrigin(ctx, who.identityId, type, props.origId).catch(() => null);
      if (existing) return existing;
      if (/duplicate|unique/i.test(msg)) throw new Error(`${type} origId ${props.origId}: unique conflict but not found by byOrigin`);
      if (i >= 4) throw e;
      log(`${type} origId ${props.origId}: retry ${i} after ${redactWif(msg).slice(0, 120)}`);
      await sleep(3000 * i);
    }
  }
}

// ---- structure -----------------------------------------------------------------------------

async function structure() {
  const { structure: s } = loadCrawl();
  const ctx = await platform();
  const owner = await signerFor('owner', ctx);
  const mapPath = mapFile(ctx.contractId);
  const map = readJson(mapPath, { categories: {}, forums: {} });
  // A dry run plans in memory only: persisting placeholder ids would poison the real run.
  const saveMap = () => { if (!opts['dry-run']) writeJson(mapPath, map); };
  const archived = new Set((opts['archive-forums'] ?? '').split(',').filter(Boolean).map(Number));
  const existingForums = new Map();
  const existingCats = new Map();
  for (const [type, target] of [['forum', existingForums], ['category', existingCats]]) {
    let startAfter;
    for (;;) {
      const res = await ctx.sdk.documents.query({ dataContractId: ctx.contractId, documentTypeName: type, orderBy: [['slug', 'asc']], limit: 100, ...(startAfter ? { startAfter } : {}) });
      let last;
      for (const [id, doc] of res) { last = String(id); if (doc) target.set(doc.toJSON().slug, String(id)); }
      if (res.size < 100 || !last) break;
      startAfter = last;
    }
  }
  const slugOf = (title, origId) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${origId}`.replace(/^-/, '');
  let sort = 100;
  for (const cat of s.categories) {
    const slug = slugOf(cat.title, cat.origId);
    if (!map.categories[cat.origId]) {
      map.categories[cat.origId] = existingCats.get(slug) ?? (opts['dry-run'] ? 'dry' : await createDoc(ctx, owner, 'category', {
        slug, title: cat.title.slice(0, 80).padEnd(3, '.'), ...(cat.description ? { description: cat.description.slice(0, 300) } : {}), sort: sort,
      }));
      log(`category ${cat.title} → ${map.categories[cat.origId]}`);
      saveMap();
    }
    sort += 100;
    let fsort = 0;
    // Parents before children.
    const ordered = [...cat.forums].sort((a, b) => Number(!!a.parentOrigId) - Number(!!b.parentOrigId));
    for (const f of ordered) {
      fsort += 10;
      if (map.forums[f.origId]) continue;
      const fslug = slugOf(f.title, f.origId);
      const parent = f.parentOrigId ? map.forums[f.parentOrigId] : undefined;
      map.forums[f.origId] = existingForums.get(fslug) ?? (opts['dry-run'] ? 'dry' : await createDoc(ctx, owner, 'forum', {
        categoryId: map.categories[cat.origId],
        ...(parent && parent !== 'dry' ? { parentForumId: parent } : {}),
        slug: fslug,
        title: f.title.slice(0, 80).padEnd(3, '.'),
        ...(f.description ? { description: f.description.slice(0, 500) } : {}),
        sort: fsort,
        origId: f.origId,
      }));
      log(`forum ${f.title} → ${map.forums[f.origId]}`);
      saveMap();
    }
    // Archived forums refuse every write at consensus (the archivist's too), so they are closed by
    // the `archive` command after the load, not at creation.
    for (const f of ordered) if (archived.has(f.origId) || archived.has(cat.origId)) map.toArchive = [...new Set([...(map.toArchive ?? []), f.origId])];
    saveMap();
  }
  log('structure done');
  process.exit(0);
}

// ---- load ----------------------------------------------------------------------------------

async function load() {
  const { structure: s, threads } = loadCrawl();
  const ctx = await platform();
  const map = readJson(mapFile(ctx.contractId), null);
  if (!map) throw new Error('run structure first');
  const archivist = await signerFor('archivist', ctx);
  const ledgerPath = join(CACHE, `ledger-${ctx.contractId}.json`);
  const ledger = readJson(ledgerPath, { threads: {}, posts: {}, spentCredits: 0 });
  const dry = opts['dry-run'];
  const saveLedger = () => { if (!dry) writeJson(ledgerPath, ledger); };
  const budget = Number(opts['budget-dash']) * 1e11;
  const limit = opts.limit ? Number(opts.limit) : Infinity;
  const startBalance = BigInt(await ctx.sdk.identities.balance(archivist.identityId));

  // One chronological stream across all threads: thread doc right before its first post.
  const events = [];
  for (const t of threads) {
    const forumId = map.forums[t.forumOrigId];
    if (!forumId || forumId === 'dry') continue;
    t.posts.sort((a, b) => a.createdAt - b.createdAt || a.origId - b.origId);
    t.posts.forEach((p, i) => events.push({ t, p, i, at: p.createdAt, forumId }));
  }
  events.sort((a, b) => a.at - b.at || a.t.origId - b.t.origId || a.i - b.i);
  let written = 0;
  let lastCheck = 0;
  for (const ev of events) {
    if (written >= limit) break;
    const { t, p, forumId } = ev;
    if (!ledger.threads[t.origId]) {
      if (ev.i !== 0) continue;
      const props = threadDocProps(t, forumId);
      if (dry) { log('would create thread', props.title); ledger.threads[t.origId] = 'dry'; continue; }
      ledger.threads[t.origId] = await idempotentCreate(ctx, archivist, 'thread', props);
      written++;
      saveLedger();
      log(`thread ${t.origId} → ${ledger.threads[t.origId]} "${props.title}"`);
    }
    const threadId = ledger.threads[t.origId];
    const chunks = postChunks(p);
    for (const [k, chunk] of chunks.entries()) {
      const origId = p.origId * 100 + k;
      if (ledger.posts[origId]) continue;
      const props = postDocProps(t, p, chunk, k, threadId, forumId);
      if (dry) { ledger.posts[origId] = 'dry'; written++; continue; }
      ledger.posts[origId] = await idempotentCreate(ctx, archivist, 'post', props);
      written++;
      saveLedger();
    }
    if (written - lastCheck >= 25) {
      lastCheck = written;
      const now = BigInt(await ctx.sdk.identities.balance(archivist.identityId));
      ledger.spentCredits = Number(startBalance - now) + (ledger.spentBefore ?? 0);
      log(`progress: ${written} writes, spent ${(Number(startBalance - now) / 1e11).toFixed(4)} DASH this run`);
      if (Number(startBalance - now) > budget) { log('budget reached — stopping'); break; }
    }
  }
  const end = BigInt(await ctx.sdk.identities.balance(archivist.identityId));
  ledger.spentBefore = (ledger.spentBefore ?? 0) + Number(startBalance - end);
  saveLedger();
  log(`load done: ${written} writes this run, ${(Number(startBalance - end) / 1e11).toFixed(4)} DASH`);
  process.exit(0);
}

// ---- archive -------------------------------------------------------------------------------

async function archive() {
  const ctx = await platform();
  const map = readJson(mapFile(ctx.contractId), null);
  if (!map?.toArchive?.length) { log('no forums marked for archiving (structure --archive-forums)'); process.exit(0); }
  const owner = await signerFor('owner', ctx);
  for (const origId of map.toArchive) {
    const id = map.forums[origId];
    const doc = id && (await ctx.sdk.documents.get(ctx.contractId, 'forum', id));
    if (!doc) { log(`forum ${origId}: not found`); continue; }
    const j = doc.toJSON();
    if (j.archived === true) { log(`forum ${j.title}: already archived`); continue; }
    if (opts['dry-run']) { log(`would archive ${j.title}`); continue; }
    const props = Object.fromEntries(Object.entries(j).filter(([k, v]) => !k.startsWith('$') && v !== null));
    await replaceDoc(ctx, owner, 'forum', j, { ...props, archived: true });
    log(`archived ${j.title}`);
  }
  process.exit(0);
}

// ---- trust window ----------------------------------------------------------------------------

/** Sets forumSettings.archiveTrustUntil: `--until now` closes the window (archivist documents
 * created later lose their imported dates and authors), `--until open` reopens it for a later
 * backfill, or an ISO date. */
async function trust() {
  const until = opts.until;
  if (!until) throw new Error('trust needs --until now|open|<ISO date>');
  const at = until === 'open' ? undefined : until === 'now' ? Date.now() : Date.parse(until);
  if (at !== undefined && !Number.isFinite(at)) throw new Error(`bad --until ${until}`);
  const ctx = await platform();
  const owner = await signerFor('owner', ctx);
  const res = await ctx.sdk.documents.query({ dataContractId: ctx.contractId, documentTypeName: 'forumSettings', where: [['key', '==', 'main']], orderBy: [['key', 'asc']], limit: 1 });
  const doc = [...res.values()].find(Boolean);
  if (!doc) throw new Error('no forumSettings document; run scripts/seed-forum.mjs first');
  const j = doc.toJSON();
  // Reopening would re-trust anything the archivist key wrote while the window was closed (a leaked
  // key's forgeries included), so refuse while such documents exist.
  if (at === undefined || (j.archiveTrustUntil && at > j.archiveTrustUntil)) {
    const archivist = j.archiveOwnerId;
    for (const type of ['thread', 'post']) {
      if (!archivist || !j.archiveTrustUntil) break;
      const res = await ctx.sdk.documents.query({
        dataContractId: ctx.contractId, documentTypeName: type,
        where: [['$ownerId', '==', archivist], ['$createdAt', '>', j.archiveTrustUntil]], orderBy: [['$ownerId', 'asc'], ['$createdAt', 'asc']], limit: 1,
      });
      if ([...res.values()].some(Boolean)) {
        throw new Error(`the archivist wrote ${type}s after the trust window closed (${new Date(j.archiveTrustUntil).toISOString()}); reopening would trust them. Review and remove them first.`);
      }
    }
    // Edits made while the window was closed (an imported post rewritten with a leaked key) would be
    // re-trusted too. No index pairs owner and $updatedAt, so walk byUpdated from the cutoff.
    for (const type of ['thread', 'post']) {
      if (!archivist || !j.archiveTrustUntil) break;
      let from = j.archiveTrustUntil;
      let startAfter;
      for (;;) {
        const res = await ctx.sdk.documents.query({
          dataContractId: ctx.contractId, documentTypeName: type,
          where: [['$updatedAt', '>', from]], orderBy: [['$updatedAt', 'asc']], limit: 100, ...(startAfter ? { startAfter } : {}),
        });
        let last;
        for (const [id, d] of res) {
          last = String(id);
          if (d && d.toJSON().$ownerId === archivist) {
            throw new Error(`archivist ${type} ${id} was edited after the trust window closed; reopening would trust the edit. Review it first.`);
          }
        }
        if (res.size < 100 || !last) break;
        startAfter = last;
      }
    }
  }
  const props = Object.fromEntries(Object.entries(j).filter(([k, v]) => !k.startsWith('$') && v !== null && k !== 'archiveTrustUntil'));
  if (at !== undefined) props.archiveTrustUntil = at;
  if (opts['dry-run']) { log('would set archiveTrustUntil', at === undefined ? 'open' : new Date(at).toISOString()); process.exit(0); }
  await replaceDoc(ctx, owner, 'forumSettings', j, props);
  log(`archive trust ${at === undefined ? 'open' : `until ${new Date(at).toISOString()}`}`);
  process.exit(0);
}

const commands = { crawl: () => (opts.source === 'api' ? crawlApi() : crawlHtml()), plan, structure, load, archive, trust };
if (!commands[command]) {
  console.error('usage: node scripts/import/xenforo.mjs crawl|plan|structure|load|archive|trust [options]  (see the header)');
  process.exit(2);
}
Promise.resolve(commands[command]()).catch((e) => {
  console.error('[import] failed:', redactWif(String(e?.message ?? e)));
  process.exit(1);
});
export { normalizeTags, splitMarkdownByBytes };
