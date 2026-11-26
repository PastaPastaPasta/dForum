#!/usr/bin/env node
import { EvoSDK } from '@dashevo/evo-sdk';
import { redactWif } from './lib/redact.mjs';

async function main() {
  await EvoSDK.getLatestVersionNumber();
  const sdk = EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } });
  await sdk.connect();
  const ids = ['ozZNp21WNWLx79aJXFo2ScEaMtBc9vvfUonqmzADM16', '85NE7sDLE6UEmPu7GXFwTKUZZudXxLZM6WwVkTTQDKEX'];
  try {
    const versions = await sdk.contracts.getLatestVersions({ contractIds: ids });
    for (const [id, v] of versions) {
      if (!v) { console.log('latestVersion:', id, 'none'); continue; }
      console.log('latestVersion:', id);
      console.log('  version:', v.version, 'status:', v.status ?? v.contractStatus ?? '?', 'json:', JSON.stringify(v.toJSON?.() ?? v));
    }
  } catch (e) {
    console.error('getLatestVersions failed:', redactWif(e?.message ?? e));
  }
  const id = 'ozZNp21WNWLx79aJXFo2ScEaMtBc9vvfUonqmzADM16';
  for (let i = 0; i < 4; i++) {
    try {
      const c = await sdk.contracts.fetch(id);
      if (c) {
        console.log('FETCHED', id, 'version:', c.version, 'owner:', c.ownerId);
        console.log('  types:', Object.keys(c.schemas ?? {}).join(', '));
        const mod = c.config?.moderation;
        console.log('  moderation:', JSON.stringify(mod));
        console.log('  post indices:', (c.schemas?.post?.indices ?? []).map((x) => x.name).join(','));
        break;
      } else console.log('  fetch returned undefined (attempt', i, ')');
    } catch (e) {
      console.log('  fetch failed (attempt', i, '):', redactWif(e?.message ?? e));
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  const id2 = '6Dftf346svGz5btcf7NpQ3iPurku4JTit4kzWX7P7VwM';
  try {
    console.log('identity nonce:', await sdk.identities.nonce(id2));
    console.log('identity balance:', await sdk.identities.balance(id2));
  } catch (e) {
    console.error('identity reads failed:', redactWif(e?.message ?? e));
  }
  process.exit(0);
}

main().catch((e) => {
  const parts = [];
  for (const k of ['message', 'name', 'code', 'cause']) if (e[k] !== undefined) parts.push(`${k}=${e[k]}`);
  try { parts.push(`toString=${e.toString()}`); } catch {}
  console.error('ERROR:', redactWif(parts.join(' | ')));
  process.exit(1);
});
