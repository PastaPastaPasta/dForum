#!/usr/bin/env node
/**
 * Sets the appointed moderator roster in the live contract's config (team mode). Owner-only:
 * signs a DataContractUpdate with the owner's CRITICAL key (testnet: deployer seed index 0;
 * elsewhere DFORUM_OWNER_WIF + DFORUM_OWNER_KEY_ID). The owner always stays on the roster.
 *
 * Usage: node scripts/set-moderators.mjs --add <identityId> [--remove <identityId>] [--network testnet] [--dry-run]
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DataContract, EvoSDK, IdentitySigner } from '@dashevo/evo-sdk';
import { redactWif } from './lib/redact.mjs';

const { values: o } = parseArgs({ options: {
  add: { type: 'string', multiple: true, default: [] }, remove: { type: 'string', multiple: true, default: [] },
  network: { type: 'string', default: 'testnet' }, 'dry-run': { type: 'boolean', default: false },
} });
const PROTOCOL_VERSION = Number(process.env.PLATFORM_PROTOCOL_VERSION || 15);
const record = JSON.parse(readFileSync(`contracts/deployments/${o.network}.json`, 'utf8'));
const contractId = record.contracts.team.contractId;
const ownerId = record.identity.id;

const sdk = o.network === 'mainnet' ? EvoSDK.mainnetTrusted({}) : EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000, retries: 2 } });
await sdk.connect();
const live = await sdk.contracts.fetch(contractId);
const json = live.toJSON(PROTOCOL_VERSION);
const mods = json.config?.moderation?.moderators;
if (mods?.$type !== 'appointedModerators') throw new Error(`contract moderation is ${mods?.$type ?? 'none'}, not appointedModerators`);
const before = new Set(mods.identities.map(String));
const roster = new Set(before);
for (const id of o.add) roster.add(id);
for (const id of o.remove) if (id !== ownerId) roster.delete(id);
roster.add(ownerId);
if (roster.size > 16) throw new Error('at most 16 appointed moderators');
if ([...roster].sort().join() === [...before].sort().join()) { console.log('roster unchanged:', [...roster].join(', ')); process.exit(0); }
mods.identities = [...roster];
json.version = Number(json.version) + 1;
console.log(`contract ${contractId} v${json.version - 1} → v${json.version}; moderators: ${[...roster].join(', ')}`);
if (o['dry-run']) process.exit(0);

let wif = process.env.DFORUM_OWNER_WIF;
let keyId = Number(process.env.DFORUM_OWNER_KEY_ID ?? 1);
if (!wif) {
  if (o.network !== 'testnet') throw new Error('set DFORUM_OWNER_WIF and DFORUM_OWNER_KEY_ID');
  const { deriveIdentityKeys } = await import('./derive-identities.mjs');
  const k = deriveIdentityKeys(0).find((x) => x.securityLevel === 'CRITICAL' && x.purpose === 'AUTHENTICATION');
  wif = k.wif;
  keyId = k.keyIndex;
}
const identity = await sdk.identities.fetch(ownerId);
const identityKey = identity.getPublicKeyById(keyId);
if (!identityKey) throw new Error(`owner key ${keyId} not found`);
const signer = new IdentitySigner();
signer.addKeyFromWif(wif);
const dataContract = DataContract.fromJSON(json, true, PROTOCOL_VERSION);
try {
  await sdk.contracts.update({ dataContract, identityKey, signer });
} catch (e) {
  console.error('update failed:', redactWif(String(e?.message ?? e)));
  process.exit(1);
}
const after = (await sdk.contracts.fetch(contractId)).toJSON(PROTOCOL_VERSION);
console.log(`now v${after.version}: ${after.config.moderation.moderators.identities.join(', ')}`);
process.exit(0);
