#!/usr/bin/env node
/**
 * Top up the deployment identity with fresh testnet DASH.
 *
 * Stages (same as provision-identity.mjs):
 *   --gen-asset-lock-key <keyfile>     generate a one-time asset-lock keypair, print the address to fund
 *   --topup <faucetTxid> <vout> <keyfile>
 *     builds the type-8 asset lock spending the faucet output, broadcasts it, waits for it
 *     to be mined, waits for consensus, proves the chain asset-lock proof, and tops the
 *     identity's balance up.
 *
 * The identity must exist already. Writes a record into contracts/deployments/testnet.json
 * under contracts.<mode>.lastTopUp.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getPublicKey, utils as secpUtils } from '@noble/secp256k1';
import bs58check from 'bs58check';
import {
  AssetLockProof,
  EvoSDK,
  Identity,
  OutPoint,
  PrivateKey,
} from '@dashevo/evo-sdk';
import { buildAssetLock } from './lib/asset-lock.mjs';
import { broadcastRaw, waitForMined, fetchTestnetNodes, getBlockchainStatus } from './lib/dapi.mjs';
import { redactWif } from './lib/redact.mjs';

const TESTNET_P2PKH_VERSION = 0x8c;

function describeErr(e) {
  const parts = [];
  for (const k of ['message', 'name', 'code', 'cause']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  return redactWif(parts.join(' | '));
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--gen-asset-lock-key' && args[1]) {
    const privateKeyBytes = secpUtils.randomSecretKey();
    const publicKeyHex = Buffer.from(getPublicKey(privateKeyBytes, true)).toString('hex');
    writeFileSync(args[1], `${Buffer.from(privateKeyBytes).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    const pub = Buffer.from(publicKeyHex, 'hex');
    const inner = createHash('sha256').update(pub).digest();
    const hash160 = createHash('ripemd160').update(inner).digest();
    const address = bs58check.encode(Buffer.concat([Buffer.from([TESTNET_P2PKH_VERSION]), hash160]));
    console.log(`asset-lock private key written to ${args[1]} (mode 600)`);
    console.log(`address to fund: ${address}`);
    process.exit(0);
  }

  if (args[0] === '--topup' && args[1] && args[2] && args[3]) {
    const faucetTxid = args[1];
    const vout = Number(args[2]);
    const keyFile = args[3];
    const recordPath = 'contracts/deployments/testnet.json';
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const identityId = record.identity.id;

    await EvoSDK.getLatestVersionNumber();

    const outRes = await fetch(`https://insight.testnet.networks.dash.org/insight-api/tx/${faucetTxid}`);
    if (!outRes.ok) throw new Error(`Insight HTTP ${outRes.status}`);
    const faucetTx = await outRes.json();
    const out = faucetTx.vout?.[vout];
    if (!out) throw new Error(`output ${vout} not found`);
    const value = BigInt(Math.round(Number(out.value) * 1e8));
    console.log(`faucet output = ${out.value} tDASH (${value} duffs)`);

    const hex = readFileSync(keyFile, 'utf8').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`keyfile ${keyFile} is not a 64-char hex private key`);
    const privateKeyBytes = Uint8Array.from(Buffer.from(hex, 'hex'));
    const pub = getPublicKey(privateKeyBytes, true);
    const hash160 = createHash('ripemd160').update(createHash('sha256').update(pub).digest()).digest();

    const built = buildAssetLock({
      utxos: [{ txid: faucetTxid, vout, value }],
      fundingKey: privateKeyBytes,
      creditPubKeyHash: hash160,
    });
    console.log(`asset lock built: txid=${built.txid} lock=${built.lockDuffs} fee=${built.feeDuffs}`);

    const { txid } = await broadcastRaw(built.raw, { log: (m) => console.log(`[broadcast] ${m}`) });
    console.log(`asset lock broadcast: ${txid}`);

    const mined = await waitForMined(built.txid, { log: (m) => console.log(`[mined] ${m}`) });
    const height = mined.height;
    console.log(`asset lock mined at height ${height}`);

    const nodes = await fetchTestnetNodes();
    for (;;) {
      let synced = false;
      for (const node of nodes) {
        try {
          const status = await getBlockchainStatus(node);
          if (status.chain.isSynced && status.chain.blocksCount >= height) { synced = true; break; }
        } catch {}
      }
      if (synced) break;
      console.log(`consensus not yet at ${height}; waiting 10s …`);
      await new Promise((r) => setTimeout(r, 10000));
    }

    const assetLockProof = AssetLockProof.createChainAssetLockProof(height, new OutPoint(built.txid, built.creditIndex));
    const identity = new Identity(identityId);

    const sdk = EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } });
    await sdk.connect();
    console.log(`topping up identity ${identityId} …`);
    // The SDK's proof read (consensus height) can lag the node list cairn already
    // saw; retry until the platform keeps up — the lock is mined, so retries are cheap.
    let newBalance;
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        newBalance = await sdk.identities.topUp({
          identity,
          assetLockProof,
          assetLockPrivateKey: PrivateKey.fromBytes(privateKeyBytes, 'testnet'),
        });
        if (newBalance !== undefined) break;
      } catch (e) {
        const msg = String(e?.message ?? e);
        console.log(`  top-up attempt ${attempt} refused: ${msg.slice(0, 200)}`);
        if (attempt === 8) throw e;
        await new Promise((r) => setTimeout(r, 20000));
      }
    }
    console.log(`identity topped up: balance=${newBalance} credits`);
    process.exit(0);
  }

  console.error('Usage:');
  console.error('  node scripts/topup-identity.mjs --gen-asset-lock-key <keyfile>');
  console.error('  node scripts/topup-identity.mjs --topup <faucetTxid> <vout> <keyfile>');
  process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', describeErr(e));
  process.exit(1);
});
