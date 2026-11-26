#!/usr/bin/env node
/**
 * S8 body-size probe — one live write with a ~2 KB body post.
 *
 * Verifies the fee regime for a realistic forum post (the seed docs were
 * tiny). Creates ONE real post on the testnet contract; safe to re-run
 * (skips if a probe post is already found).
 *
 * Usage: node scripts/spikes/s8-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { Document, EvoSDK, IdentitySigner } from '@dashevo/evo-sdk';
import { criticalAuthKey, deriveIdentityKeys } from '../derive-identities.mjs';

const record = JSON.parse(readFileSync('contracts/deployments/testnet.json', 'utf8'));
const CONTRACT_ID = record.contracts.team.contractId;
const OWNER_ID = record.identity.id;
const THREAD_ID = '2cZ7p1ZzYuziaDSiGSpmwu7aK7R8SMoDD7Z6bLsGYVap'; // seed thread
const SEQUENCE_MASK = (1n << 40n) - 1n;
const BODY =
  'S8 body probe — ' +
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ' +
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. '.repeat(16);

async function main() {
  if (!record.contracts.team) throw new Error('no team contract');
  const sdk = EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } });
  await sdk.connect();

  const identity = await sdk.identities.fetch(OWNER_ID);
  if (!identity) throw new Error('owner identity not found');
  const keys = deriveIdentityKeys(0);
  const crit = criticalAuthKey(keys);
  const identityKey = identity.getPublicKeyById(crit.keyIndex);
  if (!identityKey) throw new Error('CRITICAL key not found on chain');
  const signer = new IdentitySigner();
  signer.addKeyFromWif(crit.wif);

  console.log('body length (chars):', BODY.length, 'bytes:', Buffer.byteLength(BODY, 'utf8'));

  // idempotency: skip if a probe post already exists on this thread
  const page = await sdk.documents.query({
    dataContractId: CONTRACT_ID,
    documentTypeName: 'post',
    where: [['threadId', '==', THREAD_ID]],
  });
  for (const doc of page.values()) {
    if (String(doc.properties?.body ?? '').startsWith('S8 body probe')) {
      console.log('probe post already exists — skipping (', String(doc.id).slice(0, 18), '…)');
      return;
    }
  }

  const rawNonce = (await sdk.wasm.getIdentityContractNonce(OWNER_ID, CONTRACT_ID)) ?? 0n;
  const newNonce = (rawNonce & SEQUENCE_MASK) + 1n;
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const document = new Document({
    properties: {
      threadId: THREAD_ID,
      forumId: 'B3F2hJCE6N8ZgDZpbBwKm3JWXYQYmekJed54JaRvENDh',
      body: BODY,
    },
    documentTypeName: 'post',
    dataContractId: CONTRACT_ID,
    ownerId: OWNER_ID,
    revision: 1n,
    entropy,
    identityContractNonce: newNonce,
  });

  const balBefore = BigInt((await sdk.identities.balance(OWNER_ID)) ?? 0n);
  const t0 = Date.now();
  const created = await sdk.documents.create({ document, identityKey, signer });
  const elapsed = Date.now() - t0;
  const balAfter = BigInt((await sdk.identities.balance(OWNER_ID)) ?? 0n);
  const cost = balBefore - balAfter;
  console.log('created:', String(created.id), 'cost:', cost.toString(), 'credits (', (Number(cost) / 1e11).toFixed(6), 'DASH)', 'in', elapsed, 'ms');
}

main().catch((e) => { console.error(e); process.exit(1); });
