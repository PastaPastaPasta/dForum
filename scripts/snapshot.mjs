#!/usr/bin/env node
/**
 * Static snapshot of the whole forum, built incrementally.
 *
 * Every run reads the small owner-only types in full, then pulls thread/post/reaction/profile
 * changes since the cached watermark through the byUpdated ($updatedAt) and moderated
 * ($moderatedAt) indexes. `--full` (or a missing/foreign cache) rescans everything, which is the
 * only way to notice moderator deletes; CI runs it daily.
 *
 * Outputs (all public, all derived from chain data; the build reads only these):
 *   data/site.json              structure, counts, latest activity, settings
 *   data/forum/<forumId>.json   thread summaries (sticky first, then latest activity)
 *   data/thread/<threadId>.json thread + posts (hidden posts kept as placeholders) + reaction counts
 *   data/user/<identityId>.json member card + recent threads/posts
 *   data/members.json           every member with counts
 * Cache: .cache/snapshot-state.json (raw documents + watermark; never deployed).
 *
 * Fails loudly on any read error so the previous deploy keeps serving.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { EvoSDK } from '@dashevo/evo-sdk';
import {
  archiveAuthor, countReactions, effectiveAt, excerpt, isArchive, isHidden, isRetracted, lastPostOf, num,
  postBody, resolveForumTree, sortThreadSummaries, str, summarizeThread, threadForumId, threadPosts,
} from '../lib/forum/model.ts';

const NETWORK = process.env.NEXT_PUBLIC_NETWORK || 'testnet';
const CONTRACT_ID = process.env.NEXT_PUBLIC_DFORUM_CONTRACT_ID || readDeployment().contractId;
const DATA = 'data';
const CACHE = process.env.SNAPSHOT_CACHE || '.cache/snapshot-state.json';
const PAGE = 100;
const OVERLAP_MS = 10 * 60_000;
const FULL = process.argv.includes('--full');

function readDeployment() {
  const record = JSON.parse(readFileSync(`contracts/deployments/${NETWORK}.json`, 'utf8'));
  const c = record.contracts?.team ?? record.contracts?.none ?? record.contracts?.network;
  if (!c?.contractId) throw new Error(`no contract in contracts/deployments/${NETWORK}.json`);
  return c;
}

const toPlain = (v) => (typeof v === 'bigint' ? Number(v) : v);

export function toRaw(doc) {
  const j = doc.toJSON();
  const p = {};
  for (const [k, v] of Object.entries(j)) if (!k.startsWith('$') && v !== null && v !== undefined) p[k] = toPlain(v);
  const raw = {
    id: j.$id,
    ownerId: j.$ownerId,
    revision: Number(j.$revision ?? 1),
    createdAt: Number(j.$createdAt ?? 0),
    updatedAt: Number(j.$updatedAt ?? j.$createdAt ?? 0),
    p,
  };
  if (j.$moderatedAt != null) raw.moderatedAt = Number(j.$moderatedAt);
  return raw;
}

async function connect() {
  const sdk = NETWORK === 'mainnet'
    ? EvoSDK.mainnetTrusted({ settings: { timeoutMs: 60000, retries: 3 } })
    : EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000, retries: 3 } });
  await sdk.connect();
  return sdk;
}

async function withRetry(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw new Error(`${label}: ${e?.message ?? e}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

async function* pages(sdk, type, { where = [], orderBy }) {
  let startAfter;
  for (;;) {
    const res = await withRetry(`${type} query`, () => sdk.documents.query({
      dataContractId: CONTRACT_ID,
      documentTypeName: type,
      where,
      orderBy,
      limit: PAGE,
      ...(startAfter ? { startAfter } : {}),
    }));
    const docs = [];
    let last;
    for (const [key, doc] of res) {
      last = String(key);
      if (doc) docs.push(toRaw(doc));
    }
    if (docs.length) yield docs;
    if (res.size < PAGE || !last) return;
    startAfter = last;
  }
}

async function all(sdk, type, opts) {
  const out = [];
  for await (const page of pages(sdk, type, opts)) out.push(...page);
  return out;
}

async function blockTime(sdk) {
  const res = await withRetry('block time', () => sdk.documents.queryWithProof({
    dataContractId: CONTRACT_ID, documentTypeName: 'forumSettings', limit: 1,
  }));
  return Number(res.metadata.timeMs);
}

function loadCache() {
  if (FULL || !existsSync(CACHE)) return null;
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    return c.contractId === CONTRACT_ID && c.version === 2 ? c : null;
  } catch {
    return null;
  }
}

function upsert(map, docs) {
  for (const d of docs) {
    const cur = map[d.id];
    if (!cur || d.revision > cur.revision || (d.revision === cur.revision && (d.moderatedAt ?? 0) >= (cur.moderatedAt ?? 0))) map[d.id] = d;
  }
}

async function sync(sdk) {
  const snapshotAt = await blockTime(sdk);
  const cache = loadCache();
  const state = cache ?? { version: 2, contractId: CONTRACT_ID, watermark: 0, docs: { thread: {}, post: {}, reaction: {}, profile: {} } };
  const since = cache ? Math.max(0, cache.watermark - OVERLAP_MS) : 0;
  const mode = cache ? `incremental since ${new Date(since).toISOString()}` : 'full';
  for (const type of ['thread', 'post', 'reaction', 'profile']) {
    const where = since ? [['$updatedAt', '>=', since]] : [];
    const changed = await all(sdk, type, { where, orderBy: [['$updatedAt', 'asc']] });
    upsert(state.docs[type], changed);
    if (type !== 'reaction') {
      const moderated = await all(sdk, type, {
        where: [['$moderatedAt', '>=', since]],
        orderBy: [['$moderatedAt', 'asc']],
      });
      upsert(state.docs[type], moderated);
    }
    console.log(`snapshot: ${type} ${mode}: ${changed.length} changed`);
  }
  state.watermark = snapshotAt;
  const small = {
    forumSettings: await all(sdk, 'forumSettings', { where: [['key', '==', 'main']], orderBy: [['key', 'asc']] }),
    category: await all(sdk, 'category', { orderBy: [['sort', 'asc']] }),
    forum: await all(sdk, 'forum', { orderBy: [['slug', 'asc']] }),
    teamMember: await all(sdk, 'teamMember', { orderBy: [['memberId', 'asc']] }),
  };
  const contract = await withRetry('contract', () => sdk.contracts.fetch(CONTRACT_ID));
  return { state, small, snapshotAt, contract };
}

function moderationRoster(contract) {
  try {
    const json = contract.toJSON();
    const mods = json?.config?.moderation?.moderators;
    const ids = mods?.identities ?? mods?.interim?.identities ?? [];
    return { ownerId: json.ownerId, moderators: ids.map(String) };
  } catch {
    return { ownerId: '', moderators: [] };
  }
}

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

export function build({ state, small, snapshotAt, contract }) {
  const settingsDoc = small.forumSettings[0];
  const settings = settingsDoc
    ? Object.fromEntries(Object.entries({
        name: str(settingsDoc, 'name') ?? 'dForum',
        tagline: str(settingsDoc, 'tagline'),
        description: str(settingsDoc, 'description'),
        rules: str(settingsDoc, 'rules'),
        announcement: str(settingsDoc, 'announcement'),
        archiveOwnerId: str(settingsDoc, 'archiveOwnerId'),
        archiveSourceName: str(settingsDoc, 'archiveSourceName'),
        archiveSourceUrl: str(settingsDoc, 'archiveSourceUrl'),
      }).filter(([, v]) => v !== undefined))
    : { name: 'dForum' };
  const archive = settings.archiveOwnerId;
  const { ownerId, moderators } = moderationRoster(contract);
  // Only the contract owner's structure documents count (owner-only types, but be explicit).
  const owned = (docs) => docs.filter((d) => !ownerId || d.ownerId === ownerId);

  const categories = owned(small.category).map((c) => ({
    id: c.id, slug: str(c, 'slug'), title: str(c, 'title'), description: str(c, 'description'), sort: num(c, 'sort') ?? 0,
  })).sort((a, b) => a.sort - b.sort);
  const forumsRaw = owned(small.forum).map((f) => ({
    id: f.id, categoryId: str(f, 'categoryId'), parentForumId: str(f, 'parentForumId'), slug: str(f, 'slug'),
    title: str(f, 'title'), description: str(f, 'description'), sort: num(f, 'sort') ?? 0, archived: f.p.archived === true,
    threadCount: 0, postCount: 0,
  }));
  const forums = resolveForumTree(forumsRaw, categories);
  const forumIds = new Set(forums.map((f) => f.id));

  const threads = Object.values(state.docs.thread);
  const posts = Object.values(state.docs.post);
  const reactionsLive = Object.values(state.docs.reaction).filter((r) => (num(r, 'kind') ?? 0) > 0);
  const reactions = countReactions(reactionsLive);
  const postsByThread = new Map();
  for (const p of posts) {
    const t = str(p, 'threadId');
    if (!postsByThread.has(t)) postsByThread.set(t, []);
    postsByThread.get(t).push(p);
  }

  const summaries = [];
  const threadFiles = [];
  const memberStats = new Map();
  const stat = (id) => {
    if (!memberStats.has(id)) memberStats.set(id, { posts: 0, threads: 0, reactionsReceived: 0, firstAt: Infinity, threadIds: [], postRefs: [] });
    return memberStats.get(id);
  };
  const archiveMembers = new Map();
  let archivePosts = 0;
  for (const thread of threads) {
    if (!forumIds.has(threadForumId(thread))) continue;
    const view = threadPosts(thread, postsByThread.get(thread.id) ?? [], archive);
    if (!view.listable) continue;
    const summary = summarizeThread(thread, view, reactions, archive);
    summaries.push(summary);
    const threadReactions = {};
    for (const p of view.posts) if (reactions[p.id]) threadReactions[p.id] = reactions[p.id];
    threadFiles.push({
      thread,
      forumId: summary.forumId,
      posts: view.posts.map((p) => (isHidden(p) || isRetracted(p) ? { ...p, p: { ...p.p, body: '', body2: undefined } } : p)),
      reactions: threadReactions,
    });
    const owner = stat(thread.ownerId);
    owner.threads += 1;
    owner.threadIds.push(summary);
    for (const p of view.posts) {
      if (isHidden(p) || isRetracted(p)) continue;
      const s = stat(p.ownerId);
      s.posts += 1;
      s.firstAt = Math.min(s.firstAt, p.createdAt);
      s.reactionsReceived += Object.values(reactions[p.id] ?? {}).reduce((a, b) => a + b, 0);
      s.postRefs.push({ p, summary });
      if (isArchive(p, archive)) {
        archivePosts += 1;
        const name = archiveAuthor(p, archive);
        const key = num(p, 'origAuthorId') !== undefined ? `x${num(p, 'origAuthorId')}` : `n${name}`;
        const a = archiveMembers.get(key) ?? { key, name, origAuthorId: num(p, 'origAuthorId'), posts: 0, threads: 0, firstAt: Infinity, lastAt: 0 };
        a.posts += 1;
        if (p === view.opening) a.threads += 1;
        const at = effectiveAt(p, archive);
        a.firstAt = Math.min(a.firstAt, at);
        a.lastAt = Math.max(a.lastAt, at);
        archiveMembers.set(key, a);
      }
    }
  }

  // Forum counts roll up into ancestors; last post is the newest across the subtree.
  const byForum = new Map();
  for (const s of summaries) {
    if (!byForum.has(s.forumId)) byForum.set(s.forumId, []);
    byForum.get(s.forumId).push(s);
  }
  for (const f of forums) {
    const own = byForum.get(f.id) ?? [];
    f.threadCount = own.length;
    f.postCount = own.reduce((n, s) => n + 1 + s.replies, 0);
    const last = own.reduce((a, s) => (!a || s.lastPostAt > a.lastPostAt ? s : a), null);
    if (last) f.lastPost = lastPostOf(last);
  }
  const parentOf = new Map(forums.map((f) => [f.id, f.parentForumId]));
  const rolled = new Map(forums.map((f) => [f.id, { ...f }]));
  for (const f of forums) {
    let parent = parentOf.get(f.id);
    while (parent && rolled.has(parent)) {
      const r = rolled.get(parent);
      r.threadCount += f.threadCount;
      r.postCount += f.postCount;
      if (f.lastPost && (!r.lastPost || f.lastPost.at > r.lastPost.at)) r.lastPost = f.lastPost;
      parent = parentOf.get(parent);
    }
  }
  const forumViews = [...rolled.values()].map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));

  const profiles = new Map(Object.values(state.docs.profile).map((p) => [p.ownerId, p]));
  const members = [];
  for (const [id, s] of memberStats) {
    if (id === archive) continue;
    const prof = profiles.get(id);
    const hidden = prof ? isHidden(prof) : false;
    members.push(Object.fromEntries(Object.entries({
      id,
      name: (!hidden && str(prof, 'displayName')) || '',
      title: str(prof, 'customTitle'),
      avatarUrl: hidden ? undefined : str(prof, 'avatarUrl'),
      bio: hidden ? undefined : str(prof, 'bio'),
      signature: hidden ? undefined : str(prof, 'signature'),
      website: hidden ? undefined : str(prof, 'website'),
      location: hidden ? undefined : str(prof, 'location'),
      joinedAt: Math.min(s.firstAt, prof?.createdAt ?? Infinity),
      posts: s.posts,
      threads: s.threads,
      reactionsReceived: s.reactionsReceived,
      hidden: hidden || undefined,
    }).filter(([, v]) => v !== undefined && v !== '')));
  }
  for (const prof of profiles.values()) {
    if (memberStats.has(prof.ownerId) || isHidden(prof) || prof.ownerId === archive) continue;
    members.push(Object.fromEntries(Object.entries({
      id: prof.ownerId, name: str(prof, 'displayName') ?? '', title: str(prof, 'customTitle'), avatarUrl: str(prof, 'avatarUrl'),
      bio: str(prof, 'bio'), signature: str(prof, 'signature'), website: str(prof, 'website'), location: str(prof, 'location'),
      joinedAt: prof.createdAt, posts: 0, threads: 0, reactionsReceived: 0,
    }).filter(([, v]) => v !== undefined && v !== '')));
  }
  members.sort((a, b) => b.posts - a.posts || a.joinedAt - b.joinedAt);

  const sortedSummaries = sortThreadSummaries(summaries.map((s) => ({ ...s, sticky: false })));
  const latestThreads = [...summaries].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  const threadById = new Map(summaries.map((s) => [s.id, s]));
  const latestPosts = [];
  for (const s of sortedSummaries.slice(0, 15)) {
    const tf = threadFiles.find((t) => t.thread.id === s.id);
    const last = tf?.posts.filter((p) => !isHidden(p) && !isRetracted(p)).at(-1);
    if (!last) continue;
    latestPosts.push({
      ...lastPostOf(threadById.get(s.id)), forumId: s.forumId, excerpt: excerpt(postBody(last), 140),
    });
  }
  const tagCounts = new Map();
  for (const s of summaries) for (const t of s.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const newest = members.filter((m) => m.name).sort((a, b) => b.joinedAt - a.joinedAt)[0];

  const site = {
    version: 2,
    network: NETWORK,
    contractId: CONTRACT_ID,
    generatedAt: Date.now(),
    snapshotAt,
    settings,
    ownerId,
    moderators,
    team: owned(small.teamMember).map((t) => ({ memberId: str(t, 'memberId'), role: str(t, 'role'), sort: num(t, 'sort') ?? 0 }))
      .sort((a, b) => a.sort - b.sort),
    categories,
    forums: forumViews,
    stats: {
      threads: summaries.length,
      posts: summaries.reduce((n, s) => n + 1 + s.replies, 0),
      members: members.length,
      archivePosts,
    },
    latestThreads,
    latestPosts,
    ...(newest ? { newestMember: { id: newest.id, name: newest.name } } : {}),
    tags: [...tagCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 40),
  };

  const userFiles = members.map((m) => {
    const s = memberStats.get(m.id);
    return {
      member: m,
      threads: s ? [...s.threadIds].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30) : [],
      posts: s
        ? [...s.postRefs].sort((a, b) => b.p.createdAt - a.p.createdAt).slice(0, 30).map(({ p, summary }) => ({
            postId: p.id, threadId: summary.id, threadTitle: summary.title, at: effectiveAt(p, archive), authorId: p.ownerId,
            forumId: summary.forumId, excerpt: excerpt(postBody(p), 200),
          }))
        : [],
    };
  });
  return {
    site,
    forumFiles: forums.map((f) => ({ forumId: f.id, threads: sortThreadSummaries(byForum.get(f.id) ?? []) })),
    threadFiles,
    userFiles,
    members,
    archiveMembers: [...archiveMembers.values()].sort((a, b) => b.posts - a.posts),
  };
}

async function main() {
  if (!CONTRACT_ID) throw new Error('no contract id');
  const sdk = await connect();
  const synced = await sync(sdk);
  const out = build(synced);
  const tmp = `${DATA}.next`;
  rmSync(tmp, { recursive: true, force: true });
  writeJson(`${tmp}/site.json`, out.site);
  writeJson(`${tmp}/members.json`, out.members);
  writeJson(`${tmp}/archive-members.json`, out.archiveMembers);
  for (const f of out.forumFiles) writeJson(`${tmp}/forum/${f.forumId}.json`, f);
  for (const t of out.threadFiles) writeJson(`${tmp}/thread/${t.thread.id}.json`, t);
  for (const u of out.userFiles) writeJson(`${tmp}/user/${u.member.id}.json`, u);
  rmSync(DATA, { recursive: true, force: true });
  renameSync(tmp, DATA);
  writeJson(CACHE, synced.state);
  console.log(`snapshot: ${out.site.stats.threads} threads, ${out.site.stats.posts} posts, ${out.site.stats.members} members, at ${new Date(out.site.snapshotAt).toISOString()}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('snapshot failed:', e?.message ?? e);
    process.exit(1);
  });
}
