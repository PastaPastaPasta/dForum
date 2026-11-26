#!/usr/bin/env node
/**
 * S1 spike: the deployer's CRITICAL authentication key (unbound, raw WIF) can
 * build and sign a contract moderation transition offline.
 *
 * No broadcast, no money: this verifies the mechanical path (key -> signer /
 * sign -> encode) so the live moderation path — whose only free variable is the
 * signer — is accounted for. The live ban is exercised in the moderation UI QA.
 *
 * Usage: node scripts/spikes/s1-moderation-signing.mjs [identityId]
 */
import { ContractUserModeration, IdentitySigner, PrivateKey, IdentityPublicKey } from '@dashevo/evo-sdk';
import { criticalAuthKey, deriveIdentityKeys } from '../derive-identities.mjs';

async function main() {
  const ownerArg = process.argv[2] ?? '6Dftf346svGz5btcf7NpQ3iPurku4JTit4kzWX7P7VwM';
  const contractId = 'ozZNp21WNWLx79aJXFo2ScEaMtBc9vvfUonqmzADM16';

  await (await import('@dashevo/evo-sdk')).EvoSDK.getLatestVersionNumber();

  const keys = deriveIdentityKeys(0);
  const crit = criticalAuthKey(keys);
  const publicKey = new IdentityPublicKey({
    keyId: crit.keyIndex,
    purpose: crit.purpose,
    securityLevel: crit.securityLevel,
    keyType: crit.keyType,
    isReadOnly: false,
    data: Buffer.from(crit.publicKeyHex, 'hex'),
  });
  const privateKey = PrivateKey.fromWIF(crit.wif);

  // Build a ban of the (arbitrary, unused) owner — build/sign only, no broadcast.
  const mod = new ContractUserModeration({
    ownerId: ownerArg,
    dataContractId: contractId,
    identityContractNonce: 1n,
    action: 'ban',
    identityId: ownerArg,
    reason: { code: null, text: 'S1 offline signing check: must never be broadcast' },
  });
  const st = mod.toStateTransition();
  st.sign(privateKey, publicKey);
  const bytes = st.toBytes();
  console.log(`built + signed the ban transition: ${bytes.length} B (unbound CRITICAL key: id ${crit.keyIndex})`);
  console.log('S1 PASS: CRITICAL unbound key signs moderation offline');
  console.log('note: self-targeting is refused on chain by the transform (unpaid); the offline path is what this proves');
  process.exit(0);
}

main().catch((e) => {
  const parts = [];
  for (const k of ['message', 'name', 'code']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  console.error('S1 FAIL:', parts.join(' | '));
  process.exit(1);
});
