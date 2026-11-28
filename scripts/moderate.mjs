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
    // As in the console: deleting a thread's opening post (or a post in a thread whose opening post
    // can't be found) hides the thread too, or the author's next post would relist it.
    if (type === 'post') {
      const post = (await sdk.documents.get(contractId, 'post', id))?.toJSON();
      const thread = post && (await sdk.documents.get(contractId, 'thread', post.threadId))?.toJSON();
      if (thread && thread.modState == null) {
        let opening = null;
        const all = [];
        let startAfter;
        let complete = false;
        for (let i = 0; i < 5 && !opening; i++) {
          const res = await sdk.documents.query({ dataContractId: contractId, documentTypeName: 'post', where: [['threadId', '==', thread.$id]], orderBy: [['$createdAt', 'asc']], limit: 100, ...(startAfter ? { startAfter } : {}) });
          const docs = [...res.values()].filter(Boolean).map((d) => d.toJSON());
          all.push(...docs);
          // Imported threads order by original date: read the whole thread for those.
          if (thread.origId == null) opening = docs.find((d) => d.$ownerId === thread.$ownerId) ?? null;
          if (docs.length < 100) { complete = true; break; }
          startAfter = docs[docs.length - 1].$id;
        }
        // An imported thread too long to read in full can't be judged: hide it (fail closed).
        if (thread.origId != null && complete) {
          const own = all.filter((d) => d.$ownerId === thread.$ownerId).sort((a, b) => (a.origCreatedAt ?? a.$createdAt) - (b.origCreatedAt ?? b.$createdAt));
          opening = own[0] ?? null;
        }
        if (!opening || opening.$id === id) {
          await sdk.contracts.moderatorChangeDocumentFields({ identity, contractId, documentTypeName: 'thread', documentId: thread.$id, fields: { modState: 1 }, signer, reason: reason ?? { text: 'Opening post deleted' } });
          console.log(`hide thread ${thread.$id}: done (its opening post is being deleted)`);
        }
      }
    }
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
