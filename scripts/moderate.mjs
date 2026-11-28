#!/usr/bin/env node
/**
 * Moderator command line: the same moderator actions as /moderation, for operators and scripts.
 *
 *   node scripts/moderate.mjs <action> <type> <documentId> [--to <forumId>] [--reason <text>]
 *     actions: hide | unhide | pin | unpin | lock | unlock | move | unmove | delete
 *     type:    thread | post | profile | report
 *
 * Signs with a moderator's CRITICAL key: DFORUM_MODERATOR_ID + DFORUM_MODERATOR_WIF (+ _KEY_ID),
 * or on testnet a persona from the deployer seed (--persona <index>, default 3).
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { EvoSDK, IdentitySigner } from '@dashevo/evo-sdk';
import { redactWif } from './lib/redact.mjs';

const { values: o, positionals: [action, type, id] } = parseArgs({ allowPositionals: true, options: {
  to: { type: 'string' }, reason: { type: 'string', default: '' }, persona: { type: 'string', default: '3' }, network: { type: 'string', default: 'testnet' },
} });
const FIELDS = {
  hide: { modState: 1 }, unhide: { modState: null }, pin: { sticky: true }, unpin: { sticky: null },
  lock: { locked: true }, unlock: { locked: null }, move: { movedToForumId: o.to }, unmove: { movedToForumId: null },
};
if (!action || !type || !id || (!FIELDS[action] && action !== 'delete') || (action === 'move' && !o.to)) {
  console.error('usage: node scripts/moderate.mjs hide|unhide|pin|unpin|lock|unlock|move|unmove|delete <type> <id> [--to <forumId>] [--reason <text>]');
  process.exit(2);
}
const record = JSON.parse(readFileSync(`contracts/deployments/${o.network}.json`, 'utf8'));
const contractId = record.contracts.team.contractId;
let moderatorId = process.env.DFORUM_MODERATOR_ID;
let wif = process.env.DFORUM_MODERATOR_WIF;
let keyId = Number(process.env.DFORUM_MODERATOR_KEY_ID ?? 1);
if (!wif) {
  if (o.network !== 'testnet') throw new Error('set DFORUM_MODERATOR_ID and DFORUM_MODERATOR_WIF');
  const { deriveIdentityKeys } = await import('./derive-identities.mjs');
  const k = deriveIdentityKeys(Number(o.persona)).find((x) => x.securityLevel === 'CRITICAL' && x.purpose === 'AUTHENTICATION');
  wif = k.wif;
  keyId = k.keyIndex;
  moderatorId = record.personas.find((p) => p.index === Number(o.persona))?.id;
}
const sdk = o.network === 'mainnet' ? EvoSDK.mainnetTrusted({}) : EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000, retries: 2 } });
await sdk.connect();
const identity = await sdk.identities.fetch(moderatorId);
if (!identity?.getPublicKeyById(keyId)) throw new Error('moderator key not found');
const signer = new IdentitySigner();
signer.addKeyFromWif(wif);
const reason = o.reason ? { text: o.reason } : undefined;
try {
  if (action === 'delete') {
    await sdk.contracts.moderatorDeleteDocument({ identity, contractId, documentTypeName: type, documentId: id, signer, reason });
  } else {
    await sdk.contracts.moderatorChangeDocumentFields({ identity, contractId, documentTypeName: type, documentId: id, fields: FIELDS[action], signer, reason });
  }
  console.log(`${action} ${type} ${id}: done`);
  process.exit(0);
} catch (e) {
  console.error(`${action} ${type} ${id} failed:`, redactWif(String(e?.message ?? e)));
  process.exit(1);
}
