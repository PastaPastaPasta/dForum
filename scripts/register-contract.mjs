#!/usr/bin/env node
/**
 * Register the dForum contract on the configured network.
 *
 * Mirrors dash-forge deploy-v2.mjs:
 *   - identity from the deployment record (contracts/deployments/<network>.json)
 *   - chain nonce from the chain, incremented once (the identity nonce, low 40 bits)
 *   - contract id = hashDouble(ownerId || nonce)
 *   - DataContract.fromJSON(json, true, 14) -> DataContractCreateTransition -> sign -> broadcastAndWait
 *   - verify by fetching the contract back
 *
 * Writes the deployment record on success. The private key comes from
 * the identity file, never from the record.
 *
 * Usage: node scripts/register-contract.mjs [--mode none|team|network] [--network testnet] [--dry-run]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataContract, DataContractCreateTransition, EvoSDK, IdentityPublicKey, PrivateKey } from '@dashevo/evo-sdk';
import { criticalAuthKey, deriveIdentityKeys, loadMnemonic } from './derive-identities.mjs';
import { redactWif } from './lib/redact.mjs';

const PROTOCOL_VERSION = Number(process.env.PLATFORM_PROTOCOL_VERSION || 15);
const MAX_STATE_TRANSITION_SIZE = 20480;
const PUT_SETTINGS = { connectTimeoutMs: 10000, timeoutMs: 90000, retries: 3 };
const NONCE_MASK = 0xFFFFFFFFFFn;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  let num = 0n;
  for (const c of s) {
    const idx = BASE58_ALPHABET.indexOf(c);
    if (idx === -1) throw new Error(`invalid base58 character ${c}`);
    num = num * 58n + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) { bytes.unshift(Number(num & 0xffn)); num = num >> 8n; }
  for (const c of s) { if (c === '1') bytes.unshift(0x00); else break; }
  return Buffer.from(bytes);
}
function b58encode(bytes) {
  let num = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let out = '';
  while (num > 0n) { out = BASE58_ALPHABET[Number(num % 58n)] + out; num = num / 58n; }
  for (const byte of bytes) { if (byte === 0x00) out = '1' + out; else break; }
  return out;
}
function hashDouble(buf) {
  return createHash('sha256').update(createHash('sha256').update(buf).digest()).digest();
}
function u64be(v) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(v));
  return buf;
}
const contractId = (ownerB58, nonce) => b58encode(hashDouble(Buffer.concat([b58decode(ownerB58), u64be(nonce)])));

async function main() {
  const args = process.argv.slice(2);
  let mode = 'team', network = 'testnet', dryRun = false, force = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode') mode = args[++i];
  else if (args[i] === '--network') network = args[++i];
  else if (args[i] === '--dry-run') dryRun = true;
  else if (args[i] === '--force') force = true;
}
if (!['none', 'team', 'network'].includes(mode)) throw new Error(`--mode must be none|team|network, got ${mode}`);

const recordPath = join('contracts', 'deployments', `${network}.json`);
const record = JSON.parse(readFileSync(recordPath, 'utf8'));

// Refuse to silently overwrite a live registration. The team contract is
// live on testnet — re-registering it would orphan the existing one (this
// script is how the live registration was made in the first place).
const existing = record.contracts?.[mode];
if (existing && !force) {
  console.error(`refusing to overwrite the live ${mode} contract registration (${existing.contractId})`);
  console.error(`  pass --force to register anyway (a NEW contract id will be written; the old one stays live)`);
  process.exit(1);
}
const ownerId = record.identity?.id;
if (!ownerId) throw new Error(`${recordPath} has no identity.id — register the identity first`);

const json = JSON.parse(readFileSync(join('contracts', 'generated', `dforum.${mode}.json`), 'utf8'));
const keys = deriveIdentityKeys(0);
const critKey = criticalAuthKey(keys);

console.log(`network: ${network}`);
console.log(`mode: ${mode}`);
console.log(`owner identity: ${ownerId}`);

await EvoSDK.getLatestVersionNumber();
const sdk = network === 'mainnet'
  ? EvoSDK.mainnet({ settings: { timeoutMs: 60000 } })
  : EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } });
await sdk.connect();
console.log('connected');

const identity = await sdk.identities.fetch(ownerId);
if (!identity) throw new Error(`identity ${ownerId} not found on ${network}`);
const onChainKey = identity.getPublicKeyById(critKey.keyIndex);
if (!onChainKey || String(onChainKey.data).toLowerCase() !== critKey.publicKeyHex.toLowerCase()) {
  throw new Error(`key ${critKey.keyIndex} of ${ownerId} on chain does not match the identity file`);
}
if (onChainKey.disabledAt != null) throw new Error(`key ${critKey.keyIndex} of ${ownerId} was disabled`);

const chainNonce = BigInt((await sdk.identities.nonce(ownerId)) ?? 0n) & NONCE_MASK;
const nonce = chainNonce + 1n;
const id = contractId(ownerId, nonce);
console.log(`chain identity nonce: ${chainNonce} -> nonce: ${nonce} -> id: ${id}`);

const contract = DataContract.fromJSON(
  { $formatVersion: '1', id, ownerId, version: 1, config: json.config, description: json.description, keywords: json.keywords, schemaDefs: json.schemaDefs, documentSchemas: json.documentSchemas },
  true,
  PROTOCOL_VERSION,
);
if (contract.id.toBase58() !== id) throw new Error(`contract id mismatch: ${contract.id.toBase58()} != ${id}`);

const transition = new DataContractCreateTransition(contract, nonce, PROTOCOL_VERSION);
const st = transition.toStateTransition();
const publicKey = new IdentityPublicKey({
  keyId: critKey.keyIndex,
  purpose: critKey.purpose,
  securityLevel: critKey.securityLevel,
  keyType: critKey.keyType,
  isReadOnly: false,
  data: Buffer.from(critKey.publicKeyHex, 'hex'),
});
const privateKey = PrivateKey.fromWIF(critKey.wif);
st.sign(privateKey, publicKey);
const stBytes = st.toBytes();
const size = stBytes.length;
// The on-chain tx hash of the signed transition (what the explorer shows).
const registrationTxHash = st.hash(false);
console.log(`signed create transition: ${size} B (limit ${MAX_STATE_TRANSITION_SIZE}, room ${MAX_STATE_TRANSITION_SIZE - size})`);
if (size > MAX_STATE_TRANSITION_SIZE) throw new Error(`transition exceeds max size ${MAX_STATE_TRANSITION_SIZE}`);
if (size > MAX_STATE_TRANSITION_SIZE - 1024) {
  throw new Error(`transition is tight: only ${MAX_STATE_TRANSITION_SIZE - size} B of room — the contract is too large to register safely`);
}

if (dryRun) {
  console.log('dry run: not broadcasting');
  process.exit(0);
}

const before = BigInt((await sdk.identities.balance(ownerId)) ?? 0n);
console.log(`balance before: ${before}`);
try {
  await sdk.stateTransitions.broadcastAndWait(st, PUT_SETTINGS);
  console.log('broadcast accepted');
} catch (e) {
  const parts = [];
  for (const k of ['message', 'name', 'code', 'cause', 'type']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  parts.push(`toString=${e?.toString?.()}`);
  try { parts.push(`json=${JSON.stringify(e)}`); } catch {}
  const parts2 = [];
  let c = e;
  while (c && parts2.length < 6) { if (c.cause) { parts2.push(`cause.${c.cause?.name ?? 'x'}: ${c.cause?.message ?? c.cause}`); c = c.cause; } else break; }
  console.error(`broadcast failed: ${redactWif(parts.join(' | '))}${parts2.length ? ' | ' + redactWif(parts2.join(' | ')) : ''}`);
  process.exit(1);
}

// Wait for the contract to be visible on chain (a node may answer a block late).
let fetched = null;
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  fetched = await sdk.contracts.fetch(id);
  if (fetched) break;
}
if (!fetched) throw new Error(`broadcast accepted but ${id} could not be fetched`);
console.log(`registered: ${id} (version ${fetched.version})`);

const after = BigInt((await sdk.identities.balance(ownerId)) ?? 0n);
const cost = before - after;
console.log(`balance after: ${after} (cost ${cost} credits = ${(Number(cost) / 1e11).toFixed(8)} DASH)`);

const entry = {
  contractId: id,
  ownerId,
  mode,
  version: Number(fetched.version),
  identityNonce: nonce.toString(),
  registeredAt: new Date().toISOString(),
  costCredits: cost.toString(),
  sizeBytes: size,
  transitionSha256: createHash('sha256').update(stBytes).digest('hex'),
  registrationTxHash,
};
record.contracts = record.contracts ?? {};
record.contracts[mode] = entry;
writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
console.log(`deployment record updated: ${recordPath}`);
console.log(`next step: NEXT_PUBLIC_DFORUM_CONTRACT_ID=${id} npm run build`);
}

main().catch((e) => {
  const parts = [];
  for (const k of ['message', 'name', 'code', 'cause']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  console.error('ERROR:', redactWif(parts.join(' | ')));
  process.exit(1);
});
