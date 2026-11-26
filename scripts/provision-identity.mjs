#!/usr/bin/env node
/**
 * One-time, manual provisioning of a dForum testnet identity.
 *
 * Stages:
 *   --gen-asset-lock-key <keyfile>        generate a one-time asset-lock keypair, print the address to fund
 *   --provision <faucetTxid> <vout> <keyfile>   build the type-8 asset lock spending the faucet output,
 *                                              broadcast it, wait for it to be mined, and create the
 *                                              identity (chain-lock proof). Never prints keys.
 *
 * The /work/tmp keyfile holds the 32-byte asset-lock private key (hex, mode 600).
 * The funding key is the same keypair the asset lock signs and the faucet output pays to.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { getPublicKey, utils as secpUtils } from '@noble/secp256k1';
import bs58check from 'bs58check';
import {
  AssetLockProof,
  EvoSDK,
  Identity,
  IdentityPublicKey,
  IdentitySigner,
  OutPoint,
  PrivateKey,
} from '@dashevo/evo-sdk';
import {
  CRITICAL_AUTH_KEY_ID,
  deriveIdentityKeys,
  loadMnemonic,
} from './derive-identities.mjs';
import { buildAssetLock, estimateFirmSize, txidFromRaw, p2pkhScript, BURN_SCRIPT } from './lib/asset-lock.mjs';
import { broadcastRaw, waitForMined, fetchTestnetNodes, getBlockchainStatus, Dapi } from './lib/dapi.mjs';
import { redactWif } from './lib/redact.mjs';

const TESTNET_P2PKH_VERSION = 0x8c;
const SDK_TIMEOUT_MS = 30000;

function describeErr(e) {
  if (!e) return String(e);
  const parts = [];
  for (const k of ['message', 'name', 'code', 'cause']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  return redactWif(parts.join(' | '));
}

export function generateAssetLockKeypair() {
  const privateKeyBytes = secpUtils.randomSecretKey();
  const publicKeyHex = Buffer.from(getPublicKey(privateKeyBytes, true)).toString('hex');
  return { privateKeyBytes, publicKeyHex };
}

export function loadAssetLockKeypair(keyFile) {
  const hex = readFileSync(keyFile, 'utf8').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${keyFile} is not a 64-hex private key`);
  const privateKeyBytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  const publicKeyHex = Buffer.from(getPublicKey(privateKeyBytes, true)).toString('hex');
  return { privateKeyBytes, publicKeyHex };
}

export function addressForPublicKey(publicKeyHex) {
  const pub = Buffer.from(publicKeyHex, 'hex');
  if (pub.length !== 33) throw new Error(`expected 33-byte compressed public key, got ${pub.length}`);
  const inner = createHash('sha256').update(pub).digest();
  const hash160 = createHash('ripemd160').update(inner).digest();
  const payload = Buffer.concat([Buffer.from([TESTNET_P2PKH_VERSION]), hash160]);
  return bs58check.encode(payload);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--gen-asset-lock-key' && args[1]) {
    const assetLock = generateAssetLockKeypair();
    writeFileSync(args[1], `${Buffer.from(assetLock.privateKeyBytes).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    const address = addressForPublicKey(assetLock.publicKeyHex);
    console.log(`asset-lock private key written to ${args[1]} (mode 600)`);
    console.log(`assetLockPublicKey: ${assetLock.publicKeyHex}`);
    console.log(`address to fund: ${address}`);
    process.exit(0);
  }

  if (args[0] === '--create' && args[1] && args[2] && args[3] && args[4]) {
    // Create/top-up an identity on an already-mined asset lock.
    //   --create <height> <txid> <creditIndex> <keyfile>
    await EvoSDK.getLatestVersionNumber();
    const height = Number(args[1]);
    const txid = args[2];
    const creditIndex = Number(args[3]);
    const keyFile = args[4];
    const indexIdx = args.indexOf('--index');
    const identityIndex = indexIdx >= 0 ? Number(args[indexIdx + 1]) : 0;
    if (!Number.isInteger(height) || !Number.isInteger(creditIndex)) throw new Error('--create <height> <txid> <creditIndex> <keyfile>');
    if (!Number.isInteger(identityIndex) || identityIndex < 0) throw new Error('--index must be a non-negative integer');

    // Wait until a synced node reports a consensus height >= the mined height.
    const nodes = await fetchTestnetNodes();
    for (;;) {
      let synced = false;
      for (const node of nodes) {
        try {
          const status = await getBlockchainStatus(node);
          if (status.chain.isSynced && status.chain.blocksCount >= height) {
            console.log(`consensus height ${status.chain.blocksCount} (via ${node}) >= mined height ${height}`);
            synced = true;
            break;
          }
        } catch { /* try the next node */ }
      }
      if (synced) break;
      console.log(`consensus height not yet at ${height}; waiting 10s …`);
      await new Promise((r) => setTimeout(r, 10000));
    }

    const assetLock = loadAssetLockKeypair(keyFile);
    const assetLockProof = AssetLockProof.createChainAssetLockProof(height, new OutPoint(txid, creditIndex));
    const identityId = assetLockProof.createIdentityId();
    console.log(`identity id from proof: ${identityId.toBase58()}`);

    const keys = deriveIdentityKeys(identityIndex);
    const identity = new Identity(identityId);
    const signer = new IdentitySigner();
    for (const key of keys) {
      identity.addPublicKey(new IdentityPublicKey({
        keyId: key.keyIndex,
        purpose: key.purpose.toLowerCase(),
        securityLevel: key.securityLevel.toLowerCase(),
        keyType: key.keyType.toLowerCase(),
        isReadOnly: false,
        data: key.publicKey,
      }));
      signer.addKeyFromWif(key.wif);
    }

    const sdk = EvoSDK.testnetTrusted({ settings: { timeoutMs: SDK_TIMEOUT_MS } });
    await sdk.connect();
    console.log(`registering identity ${identityId.toBase58()} (index ${identityIndex}) …`);
    await sdk.identities.create({
      identity,
      assetLockProof,
      assetLockPrivateKey: PrivateKey.fromBytes(assetLock.privateKeyBytes, 'testnet'),
      signer,
    });
    const id = identityId.toBase58();
    const balance = await sdk.identities.balance(id);
    console.log(`identity registered: ${id}  balance=${balance} credits`);
    console.log('Append the identity id to E2E_IDENTITY_IDS in .env.testing (comma-separated).');
    process.exit(0);
  }

  if (args[0] === '--provision' && args[1] && args[2] && args[3]) {
    const faucetTxid = args[1];
    const vout = Number(args[2]);
    const keyFile = args[3];
    const indexIdx = args.indexOf('--index');
    const identityIndex = indexIdx >= 0 ? Number(args[indexIdx + 1]) : 0;
    if (!Number.isInteger(vout) || vout < 0) throw new Error('--provision <faucetTxid> <vout> <keyfile>');
    if (!Number.isInteger(identityIndex) || identityIndex < 0) throw new Error('--index must be a non-negative integer');
    await EvoSDK.getLatestVersionNumber();

    // The faucet tx output value is read from Insight (PeP: the funding output we already confirmed).
    const outRes = await fetch(`https://insight.testnet.networks.dash.org/insight-api/tx/${faucetTxid}`);
    if (!outRes.ok) throw new Error(`Insight HTTP ${outRes.status}`);
    const faucetTx = await outRes.json();
    const out = faucetTx.vout?.[vout];
    if (!out) throw new Error(`output ${vout} not found in tx ${faucetTxid}`);
    const value = BigInt(Math.round(Number(out.value) * 1e8));
    console.log(`faucet output ${faucetTxid}:${vout} = ${out.value} tDASH (${value} duffs)`);

    // Build the asset lock: spends the faucet output, burns everything but the fee,
    // credits Platform (the payload credit) to the asset-lock key's own hash.
    const assetLock = loadAssetLockKeypair(keyFile);
    const creditHash160 = createHash('ripemd160').update(createHash('sha256').update(Buffer.from(assetLock.publicKeyHex, 'hex')).digest()).digest();
    const built = buildAssetLock({
      utxos: [{ txid: faucetTxid, vout, value }],
      fundingKey: assetLock.privateKeyBytes,
      creditPubKeyHash: creditHash160,
    });
    console.log(`asset lock built: txid=${built.txid} lock=${built.lockDuffs} fee=${built.feeDuffs} burnVout=${built.burnVout} creditIndex=${built.creditIndex}`);

    // Broadcast.
    const { txid } = await broadcastRaw(built.raw, { log: (m) => console.log(`[broadcast] ${m}`) });
    console.log(`asset lock broadcast: ${txid}`);
    if (txid.toLowerCase() !== built.txid.toLowerCase()) {
      throw new Error(`node reported a different txid (${txid}) than locally computed (${built.txid})`);
    }

    // Wait for the lock to be mined, then wait for consensus to catch up.
    const mined = await waitForMined(built.txid, { log: (m) => console.log(`[mined] ${m}`) });
    const height = mined.height;
    console.log(`asset lock mined at height ${height}`);

    // Wait until a synced node reports a consensus height >= the mined height (the SDK requires it).
    const nodes = await fetchTestnetNodes();
    for (;;) {
      let synced = false;
      for (const node of nodes) {
        try {
          const status = await getBlockchainStatus(node);
          if (status.chain.isSynced && status.chain.blocksCount >= height) {
            console.log(`consensus height ${status.chain.blocksCount} (via ${node}) >= mined height ${height}`);
            synced = true;
            break;
          }
        } catch { /* try the next node */ }
      }
      if (synced) break;
      console.log(`consensus height not yet at ${height}; waiting 10s …`);
      await new Promise((r) => setTimeout(r, 10000));
    }

    // Create the identity with a chain proof at the mined height.
    const assetLockProof = AssetLockProof.createChainAssetLockProof(height, new OutPoint(built.txid, built.creditIndex));
    const identityId = assetLockProof.createIdentityId();
    console.log(`identity id from proof: ${identityId.toBase58()}`);

    const keys = deriveIdentityKeys(identityIndex);
    const identity = new Identity(identityId);
    const signer = new IdentitySigner();
    for (const key of keys) {
      identity.addPublicKey(new IdentityPublicKey({
        keyId: key.keyIndex,
        purpose: key.purpose.toLowerCase(),
        securityLevel: key.securityLevel.toLowerCase(),
        keyType: key.keyType.toLowerCase(),
        isReadOnly: false,
        data: key.publicKey,
      }));
      signer.addKeyFromWif(key.wif);
    }

    const sdk = EvoSDK.testnetTrusted({ settings: { timeoutMs: SDK_TIMEOUT_MS } });
    await sdk.connect();
    console.log(`registering identity ${identityId.toBase58()} (index ${identityIndex}) …`);
    await sdk.identities.create({
      identity,
      assetLockProof,
      assetLockPrivateKey: PrivateKey.fromBytes(assetLock.privateKeyBytes, 'testnet'),
      signer,
    });
    const id = identityId.toBase58();
    const balance = await sdk.identities.balance(id);
    console.log(`identity registered: ${id}  balance=${balance} credits`);
    console.log('Append the identity id to E2E_IDENTITY_IDS in .env.testing (comma-separated).');
    process.exit(0);
  }

  console.error('Usage:');
  console.error('  node scripts/provision-identity.mjs --gen-asset-lock-key <keyfile>');
  console.error('  node scripts/provision-identity.mjs --provision <faucetTxid> <vout> <keyfile> [--index <n>]');
  console.error('  node scripts/provision-identity.mjs --create <height> <txid> <creditIndex> <keyfile> [--index <n>]');
  process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', describeErr(e));
  process.exit(1);
});
