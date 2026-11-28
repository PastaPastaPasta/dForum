#!/usr/bin/env node
/**
 * Writes an empty data/site.json when no snapshot exists, so a fresh clone type-checks and
 * builds. CI always runs scripts/snapshot.mjs first; the stub never claims to be real
 * (generatedAt 0, the site shows its "not built yet" state).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('data/site.json')) process.exit(0);
let contractId = '';
try {
  const r = JSON.parse(readFileSync('contracts/deployments/testnet.json', 'utf8'));
  contractId = r.contracts?.team?.contractId ?? '';
} catch { /* no record */ }
mkdirSync('data', { recursive: true });
writeFileSync('data/site.json', JSON.stringify({
  version: 2, network: 'testnet', contractId, generatedAt: 0, snapshotAt: 0, settings: { name: 'dForum' },
  ownerId: '', moderators: [], team: [], categories: [], forums: [],
  stats: { threads: 0, posts: 0, members: 0, archivePosts: 0 }, latestThreads: [], latestPosts: [], tags: [],
}));
writeFileSync('data/members.json', '[]');
console.log('snapshot stub written (empty — CI generates the real one)');
