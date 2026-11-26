#!/usr/bin/env node
/**
 * Live write-path spike on the dForum testnet contract.
 *
 * Idempotent: finds existing seed documents (forumSettings key=main, category
 * slug=general, forum slug=general, thread title='Hello dForum') and creates only
 * what is missing. Then reads back: the post by id, the forum's thread page, the
 * forum's post page (where forumId ==), and a grouped count of posts per thread.
 * Reports per-write fee (S8). This creates REAL test documents on the testnet
 * deployment — the seed data of the forum.
 *
 * Usage: node scripts/spikes/write-path.mjs
 */
import { readFileSync } from 'node:fs';
import {
  Document,
  EvoSDK,
  IdentitySigner,
} from '@dashevo/evo-sdk';
import { criticalAuthKey, deriveIdentityKeys } from '../derive-identities.mjs';
import { redactWif } from '../lib/redact.mjs';

const record = JSON.parse(readFileSync('contracts/deployments/testnet.json', 'utf8'));
const CONTRACT_ID = record.contracts.team.contractId;
const OWNER_ID = record.identity.id;
const SEQUENCE_MASK = (1n << 40n) - 1n;

async function main() {
  console.log('contract:', CONTRACT_ID, 'owner:', OWNER_ID);

  const sdk = EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } });
  await sdk.connect();
  console.log('connected');

  const identity = await sdk.identities.fetch(OWNER_ID);
  if (!identity) throw new Error('owner identity not found');
  const keys = deriveIdentityKeys(0);
  const crit = criticalAuthKey(keys);
  const identityKey = identity.getPublicKeyById(crit.keyIndex);
  if (!identityKey) throw new Error('CRITICAL key not found on chain');
  const signer = new IdentitySigner();
  signer.addKeyFromWif(crit.wif);

  const bal0 = BigInt((await sdk.identities.balance(OWNER_ID)) ?? 0n);
  console.log('balance before:', bal0);

  const costs = {};
  const docs = {};

  async function findOne(type, where) {
    const page = await sdk.documents.query({
      dataContractId: CONTRACT_ID,
      documentTypeName: type,
      where,
      limit: 10,
    });
    const first = [...page.values()][0];
    return first ? { id: String(first.id), doc: first } : null;
  }

  async function writeDoc(type, data, label) {
    const rawNonce = (await sdk.wasm.getIdentityContractNonce(OWNER_ID, CONTRACT_ID)) ?? 0n;
    const newNonce = (rawNonce & SEQUENCE_MASK) + 1n;

    const entropy = crypto.getRandomValues(new Uint8Array(32));
    const document = new Document({
      properties: data,
      documentTypeName: type,
      dataContractId: CONTRACT_ID,
      ownerId: OWNER_ID,
      revision: 1n,
      entropy,
      identityContractNonce: newNonce,
    });

    const balBeforeWrite = BigInt((await sdk.identities.balance(OWNER_ID)) ?? 0n);
    const t0 = Date.now();
    const created = await sdk.documents.create({ document, identityKey, signer });
    const elapsed = Date.now() - t0;
    const balAfterWrite = BigInt((await sdk.identities.balance(OWNER_ID)) ?? 0n);
    const id = String(created.id);
    console.log(`  ${type} ${id.slice(0, 18)}… created nonce=${newNonce} (${elapsed} ms, cost ${balBeforeWrite - balAfterWrite} credits)`);
    costs[label] = balBeforeWrite - balAfterWrite;
    return { id, document: created };
  }

  async function findByScan(type, candidates, matches) {
    // Query by the indexed forumId, then narrow in JS (the contract refuses
    // non-indexed where clauses — by-title is not an index).
    const page = await sdk.documents.query({
      dataContractId: CONTRACT_ID,
      documentTypeName: type,
      where: [['forumId', '==', docs.forum.id]],
      limit: 50,
    });
    const hit = [...page.values()].filter(matches)[0];
    return hit ? { id: String(hit.id) } : null;
  }

  async function existingOrCreate(type, where, data, label, scanFilter) {
    const existing = scanFilter ? await findByScan(type, null, scanFilter) : await findOne(type, where);
    if (existing) {
      console.log(`  ${type} ${existing.id.slice(0, 18)}… already exists — reusing`);
      return { id: existing.id };
    }
    return await writeDoc(type, data, label);
  }

  docs.forumSettings = await existingOrCreate(
    'forumSettings', [['key', '==', 'main']],
    { key: 'main', name: 'dForum', tagline: 'A forum on Dash Platform',
      description: 'A decentralized forum, all data on Dash Platform', rules: 'Be kind.',
      announcement: 'Welcome to dForum!', hideBannedContent: true },
    'forumSettings',
  );

  docs.category = await existingOrCreate(
    'category', [['slug', '==', 'general']],
    { slug: 'general', title: 'General', description: 'General dForum announcements', sort: 1 },
    'category',
  );

  docs.forum = await existingOrCreate(
    'forum', [['slug', '==', 'general']],
    { categoryId: docs.category.id, slug: 'general', title: 'General',
      description: 'Discuss general things', sort: 1, archived: false },
    'forum',
  );

  docs.thread = await existingOrCreate(
    'thread', null,
    { forumId: docs.forum.id, title: 'Hello dForum', tags: ['announcement'], sticky: false },
    'thread',
    (d) => d.properties?.title === 'Hello dForum',
  );

  docs.post = await existingOrCreate(
    'post', null,
    { threadId: docs.thread.id, forumId: docs.forum.id, body: 'First post!' },
    'post',
    (d) => d.properties?.body === 'First post!',
  );

  // reaction — keyed on postId (one reactor per post, unique); query via the
  // indexed byPostOwner (postId first).
  docs.reaction = await existingOrCreate(
    'reaction', [['postId', '==', docs.post.id]],
    { postId: docs.post.id, postOwnerId: OWNER_ID, threadId: docs.thread.id, kind: 1 },
    'reaction',
  );

  const bal1 = BigInt((await sdk.identities.balance(OWNER_ID)) ?? 0n);
  console.log('balance after:', bal1, 'total spent:', bal0 - bal1, 'credits');

  if (docs.post) {
    try {
      const back = await sdk.documents.get(CONTRACT_ID, 'post', docs.post.id);
      console.log('post read back: $id=', String(back?.id), 'revision=', back?.revision, 'body=', back?.properties?.body);
    } catch (e) { console.error('post read-back failed:', redactWif(e?.message ?? e)); }
  }

  if (docs.forum) {
    try {
      const page = await sdk.documents.query({
        dataContractId: CONTRACT_ID,
        documentTypeName: 'post',
        where: [['forumId', '==', docs.forum.id]],
        orderBy: [['$createdAt', 'asc']],
        limit: 20,
      });
      console.log('S5a posts in forum: count=', page.size, [...page.keys()].slice(0, 5).join(', '));
    } catch (e) { console.error('S5a query failed:', redactWif(e?.message ?? e)); }

    try {
      // groupBy per In-value: posts per threadId (the S5 test — In on
      // rangeCountable via evo-sdk).
      const countMap = await sdk.documents.count({
        dataContractId: CONTRACT_ID,
        documentTypeName: 'post',
        where: [['threadId', 'in', [docs.thread.id]]],
        groupBy: ['threadId'],
      });
      const entries = [...countMap.entries()].map(([k, v]) => `${String(k).slice(0, 10)}=${v}`);
      console.log('S5b posts per thread (In on rangeCountable):', entries.join(', '));
    } catch (e) { console.error('S5b count failed:', redactWif(e?.message ?? e)); }

    try {
      const page = await sdk.documents.query({
        dataContractId: CONTRACT_ID,
        documentTypeName: 'thread',
        where: [['forumId', '==', docs.forum.id]],
        orderBy: [['$createdAt', 'desc']],
        limit: 20,
      });
      console.log('S3a threads in forum: count=', page.size, [...page.keys()].slice(0, 5).join(', '));
    } catch (e) { console.error('S3a query failed:', redactWif(e?.message ?? e)); }
  }

  console.log('--- per-write fees (credits) ---');
  for (const [label, cost] of Object.entries(costs)) console.log(`  ${label}: ${cost}`);
  console.log('TOTAL:', Object.values(costs).reduce((a, b) => a + b, 0n));

  console.log('--- ids ---');
  for (const [k, v] of Object.entries(docs)) console.log(`  ${k}: ${v?.id ?? null}`);

  process.exit(0);
}

main().catch((e) => {
  const parts = [];
  for (const k of ['message', 'name', 'code']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  console.error('ERROR:', redactWif(parts.join(' | ')));
  process.exit(1);
});
