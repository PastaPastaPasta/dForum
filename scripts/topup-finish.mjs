#!/usr/bin/env node
/** Finish the top-up once the asset lock is mined: create the chain-lock proof and top up. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getPublicKey } from '@noble/secp256k1';
import { AssetLockProof, EvoSDK, Identity, OutPoint, PrivateKey } from '@dashevo/evo-sdk';

async function main() {
  const args = process.argv.slice(2);
  const height = Number(args[0]), txid = args[1], keyFile = args[2];
  const record = JSON.parse(readFileSync('contracts/deployments/testnet.json', 'utf8'));
  const identityId = record.identity.id;
  await EvoSDK.getLatestVersionNumber();
  const hex = readFileSync(keyFile, 'utf8').trim();
  const privateKeyBytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  const sdk = EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } });
  await sdk.connect();
  const assetLockProof = AssetLockProof.createChainAssetLockProof(height, new OutPoint(txid, 0));
  const identity = new Identity(identityId);
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
main().catch((e) => {
  const parts = [];
  for (const k of ['message', 'name', 'code', 'cause']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  console.error('ERROR:', parts.join(' | ').replace(/\b[c9][1-9A-HJ-NP-Za-km-z]{50,51}\b/g, '<redacted-wif>'));
  process.exit(1);
});
