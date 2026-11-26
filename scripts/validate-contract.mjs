#!/usr/bin/env node
/**
 * Offline validation of the generated dForum contract JSON.
 *
 * Loads each generated contract with full validation against protocol 14 —
 * the same parse a node's action transform runs. No network, no signing.
 * The `id`/`ownerId` placeholders in the generated file are replaced with a
 * test identity and the id derived the same way rs-dpp derives it (hashDouble
 * of ownerId and nonce). No contract content is changed.
 *
 * Usage: node scripts/validate-contract.mjs [--dir contracts/generated]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DataContract, EvoSDK } from '@dashevo/evo-sdk';
import { redactWif } from './lib/redact.mjs';

const args = process.argv.slice(2);
let dir = 'contracts/generated';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir') dir = args[++i];
}
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));
const PROTOCOL_VERSION = 14;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes) {
  let num = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let out = '';
  while (num > 0n) { out = BASE58_ALPHABET[Number(num % 58n)] + out; num = num / 58n; }
  for (const byte of bytes) { if (byte === 0x00) out = '1' + out; else break; }
  return out;
}
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
function hashDouble(buf) {
  return createHash('sha256').update(createHash('sha256').update(buf).digest()).digest();
}
function u64be(v) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(v));
  return buf;
}

// any 32-byte test owner; a valid encoded one from forge's self-test.
const ownerB58 = b58encode(Buffer.alloc(32, 7));
const ownerBuf = b58decode(ownerB58);
const contractId = b58encode(hashDouble(Buffer.concat([ownerBuf, u64be(1)])));

await EvoSDK.getLatestVersionNumber();
let failed = false;
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const json = { ...raw, id: contractId, ownerId: ownerB58, version: 1 };
  try {
    const contract = DataContract.fromJSON(json, true, PROTOCOL_VERSION);
    if (contract.id.toBase58() !== contractId) {
      throw new Error(`id mismatch: parsed ${contract.id.toBase58()} != derived ${contractId}`);
    }
    const types = Object.keys(contract.schemas);
    const moderation = contract.config?.moderation;
    console.log(`OK  ${file}  (${types.length} types: ${types.join(', ')})  ${moderation ? `moderated (${moderation.moderators?.$type ?? 'unknown'})` : 'unmoderated'}`);
  } catch (e) {
    failed = true;
    console.error(`FAIL  ${file}: ${redactWif(e?.message ?? e)}`);
  }
}
process.exit(failed ? 1 : 0);
