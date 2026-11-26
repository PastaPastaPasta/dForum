#!/usr/bin/env node
/**
 * Deterministic derivation of dForum's testnet identity keys from a single
 * BIP39 seed. Used by the provisioning and registration scripts. The mnemonic
 * lives in `E2E_SEED_PHRASE` (env or .env.local, both gitignored).
 *
 * Determinism contract: the same mnemonic always yields the same WIFs.
 * Nothing here prints private key material unless --reveal is passed.
 *
 * Run:  node scripts/derive-identities.mjs <identityIndex> [--reveal]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import bs58check from 'bs58check';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const WIF_VERSION_TESTNET = 0xef;
export const KEY_TYPE = 'ECDSA_SECP256K1';

/** Key layout of every dForum bot identity. Writes are signed with the AUTHENTICATION/CRITICAL key. */
export const KEY_ROLES = [
  { keyIndex: 0, purpose: 'AUTHENTICATION', securityLevel: 'MASTER' },
  { keyIndex: 1, purpose: 'AUTHENTICATION', securityLevel: 'CRITICAL' },
  { keyIndex: 2, purpose: 'AUTHENTICATION', securityLevel: 'HIGH' },
  { keyIndex: 3, purpose: 'TRANSFER', securityLevel: 'CRITICAL' },
  { keyIndex: 4, purpose: 'ENCRYPTION', securityLevel: 'MEDIUM' },
];

/** Key id of the AUTHENTICATION/CRITICAL key — the one that signs state transitions. */
export const CRITICAL_AUTH_KEY_ID = 1;

function readEnvFile(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadMnemonic() {
  const fromEnv = process.env.E2E_SEED_PHRASE ?? readEnvFile(join(REPO_ROOT, '.env.local')).E2E_SEED_PHRASE;
  const mnemonic = (fromEnv ?? '').trim().replace(/\s+/g, ' ');
  if (!mnemonic) {
    throw new Error('E2E_SEED_PHRASE is not set (checked the environment and .env.local)');
  }
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('E2E_SEED_PHRASE is not a valid BIP39 mnemonic (checksum failed)');
  }
  return mnemonic;
}

/** App-specific hardened derivation path. */
export function derivationPath(identityIndex, keyIndex) {
  return `m/9'/2'/5'/0'/${identityIndex}'/${keyIndex}'`;
}

export function privateKeyToWif(privateKeyBytes) {
  if (privateKeyBytes?.length !== 32) {
    throw new Error(`Expected a 32-byte private key, got ${privateKeyBytes?.length}`);
  }
  const payload = new Uint8Array(34);
  payload[0] = WIF_VERSION_TESTNET;
  payload.set(privateKeyBytes, 1);
  payload[33] = 0x01;
  return bs58check.encode(payload);
}

export function deriveIdentityKeys(identityIndex, mnemonic = loadMnemonic()) {
  if (!Number.isInteger(identityIndex) || identityIndex < 0) {
    throw new Error(`identityIndex must be a non-negative integer, got ${identityIndex}`);
  }
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic));
  return KEY_ROLES.map((role) => {
    const path = derivationPath(identityIndex, role.keyIndex);
    const node = master.derive(path);
    if (!node.privateKey || !node.publicKey) {
      throw new Error(`Derivation produced no key material for ${path}`);
    }
    const wif = privateKeyToWif(node.privateKey);
    return {
      ...role,
      path,
      keyType: 'ECDSA_SECP256K1',
      wif,
      publicKeyHex: Buffer.from(node.publicKey).toString('hex'),
      publicKey: node.publicKey,
    };
  });
}

export function criticalAuthKey(keys) {
  const key = keys.find((k) => k.keyIndex === CRITICAL_AUTH_KEY_ID);
  if (!key) throw new Error(`no CRITICAL auth key at id ${CRITICAL_AUTH_KEY_ID}`);
  return key;
}

export function loadIdentityIds() {
  const testing = readEnvFile(join(REPO_ROOT, '.env.testing'));
  const csv = testing.E2E_IDENTITY_IDS ?? process.env.E2E_IDENTITY_IDS ?? '';
  return csv.split(',').map((s) => s.trim()).filter(Boolean);
}

export { readEnvFile };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const reveal = args.includes('--reveal');
  const index = Number(args.find((a) => !a.startsWith('--')));
  if (!Number.isInteger(index) || index < 0) {
    console.error('Usage: node scripts/derive-identities.mjs <identityIndex> [--reveal]');
    process.exit(1);
  }
  const keys = deriveIdentityKeys(index);
  for (const key of keys) {
    console.log(`key ${key.keyIndex} (${key.purpose}/${key.securityLevel}) path ${key.path} pubkey ${key.publicKeyHex}`);
    if (reveal) console.log(`  wif ${key.wif}`);
  }
  console.log(`CRITICAL_AUTH_KEY_ID=${CRITICAL_AUTH_KEY_ID}`);
}
