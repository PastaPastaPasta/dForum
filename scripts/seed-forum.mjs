#!/usr/bin/env node
/**
 * Creates or updates the owner-only documents (forumSettings, categories, forums, team rows) from
 * contracts/seed/<network>.json. Idempotent by key/slug/memberId. Signs with the contract owner's
 * CRITICAL key (testnet: identity index 0 of the deployer seed).
 *
 * Usage: node scripts/seed-forum.mjs [--network testnet] [--dry-run]
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Document, EvoSDK, IdentitySigner } from '@dashevo/evo-sdk';
import { deriveIdentityKeys } from './derive-identities.mjs';

const { values: opts } = parseArgs({ options: { network: { type: 'string', default: 'testnet' }, 'dry-run': { type: 'boolean', default: false } } });
const record = JSON.parse(readFileSync(`contracts/deployments/${opts.network}.json`, 'utf8'));
const seed = JSON.parse(readFileSync(`contracts/seed/${opts.network}.json`, 'utf8'));
const contractId = record.contracts.team.contractId;
const ownerId = record.identity.id;
const personaId = (index) => (index === 0 ? ownerId : record.personas.find((p) => p.index === index)?.id);

const sdk = EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000, retries: 2 } });
await sdk.connect();
const crit = deriveIdentityKeys(0).find((k) => k.securityLevel === 'CRITICAL' && k.purpose === 'AUTHENTICATION');
const wif = crit.wif;
const identity = await sdk.identities.fetch(ownerId);
const key = identity.getPublicKeyById(crit.keyIndex);
if (!key) throw new Error('owner CRITICAL key not found');
const signer = new IdentitySigner();
signer.addKeyFromWif(wif);

async function find(type, where, orderBy) {
  const res = await sdk.documents.query({ dataContractId: contractId, documentTypeName: type, where, orderBy, limit: 1 });
  for (const [, doc] of res) if (doc) return doc;
  return null;
}

async function upsert(type, where, orderBy, props) {
  const existing = await find(type, where, orderBy);
  if (opts['dry-run']) { console.log(`${existing ? 'update' : 'create'} ${type}`, props.slug ?? props.key ?? props.memberId ?? ''); return existing?.id?.toBase58?.() ?? 'dry'; }
  if (existing) {
    const cur = existing.toJSON();
    const same = Object.entries(props).every(([k, v]) => JSON.stringify(cur[k]) === JSON.stringify(v));
    if (same) return String(cur.$id);
    const doc = new Document({ properties: props, documentTypeName: type, dataContractId: contractId, ownerId, revision: BigInt(cur.$revision) + 1n, id: cur.$id });
    await sdk.documents.replace({ document: doc, identityKey: key, signer });
    console.log(`updated ${type} ${props.slug ?? props.key ?? ''}`);
    return String(cur.$id);
  }
  const doc = new Document({ properties: props, documentTypeName: type, dataContractId: contractId, ownerId, revision: 1n, entropy: crypto.getRandomValues(new Uint8Array(32)) });
  const created = await sdk.documents.create({ document: doc, identityKey: key, signer });
  const id = created?.id?.toBase58?.() ?? doc.id.toBase58();
  console.log(`created ${type} ${props.slug ?? props.key ?? ''} → ${id}`);
  return id;
}

async function main() {
const s = seed.settings;
const settings = Object.fromEntries(Object.entries({
  key: s.key, name: s.name, tagline: s.tagline, description: s.description, rules: s.rules, announcement: s.announcement,
  archiveOwnerId: s.archiveOwnerIndex !== undefined ? personaId(s.archiveOwnerIndex) : undefined,
  archiveSourceName: s.archiveSourceName, archiveSourceUrl: s.archiveSourceUrl,
}).filter(([, v]) => v !== undefined));
await upsert('forumSettings', [['key', '==', 'main']], [['key', 'asc']], settings);
for (const c of seed.categories) {
  const catId = await upsert('category', [['slug', '==', c.slug]], [['slug', 'asc']], { slug: c.slug, title: c.title, description: c.description, sort: c.sort });
  for (const f of c.forums) {
    await upsert('forum', [['slug', '==', f.slug]], [['slug', 'asc']], {
      categoryId: catId, slug: f.slug, title: f.title, ...(f.description ? { description: f.description } : {}), sort: f.sort, ...(f.archived ? { archived: true } : {}),
    });
  }
}
for (const t of seed.team ?? []) {
  const memberId = personaId(t.index);
  if (memberId) await upsert('teamMember', [['memberId', '==', memberId]], [['memberId', 'asc']], { memberId, role: t.role, sort: t.sort });
}
console.log('seed done');
}
main().then(() => process.exit(0), (e) => { console.error('seed failed:', e?.message, e?.code ?? '', e?.kind ?? ''); process.exit(1); });
