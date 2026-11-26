#!/usr/bin/env node
/**
 * Post-build SEO + AI-crawler static files.
 *
 * Runs AFTER `next build` (reads data/snapshot.json, writes into out/):
 *   out/sitemap.xml                — canonical public routes from the snapshot
 *   out/robots.txt                 — allow all + sitemap location
 *   out/llms.txt                   — short AI summary for crawlers
 *   out/data/v1/manifest.json      — contract id, snapshot time, counts
 *
 * No network access: snapshot data only, so the deploy is reproducible.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'out';
const SITE = 'https://forum.dashhq.org';

function readSnapshot() {
  try {
    return JSON.parse(readFileSync('data/snapshot.json', 'utf8'));
  } catch {
    console.error('snapshot not readable — run node scripts/snapshot.mjs first');
    process.exit(1);
  }
}

function sitemap() {
  const snap = readSnapshot();
  const urls = [`${SITE}/`, `${SITE}/login`, `${SITE}/search`];
  for (const f of snap.forums || []) {
    if (f.slug && !f.archived) urls.push(`${SITE}/f/${encodeURIComponent(f.slug)}/`);
  }
  for (const t of snap.threads || []) {
    if (t.id && !t.modState && !t.archived) urls.push(`${SITE}/t/${encodeURIComponent(t.id)}/`);
  }
  const body = urls
    .map((loc) => `  <url><loc>${loc}</loc><lastmod>${snap.generatedAt ? snap.generatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10)}</lastmod></url>`)
    .join('\n');
  writeFileSync(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
  );
  console.log(`sitemap.xml: ${urls.length} URLs`);
}

function robots() {
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;
  writeFileSync(join(OUT, 'robots.txt'), body);
}

function llms() {
  const snap = readSnapshot();
  const forums = (snap.forums || [])
    .filter((f) => f.slug && !f.archived)
    .map((f) => `- [${escapeMd(f.title)}](${SITE}/f/${encodeURIComponent(f.slug)}/)`)
    .join('\n');
  const body = `# dForum — a decentralized forum on Dash Platform

Centralized ownership, team-based (non-elected) moderation, every message stored on Dash Platform. All interactions via login-with-Dash. Snapshot as of ${snap.generatedAt ?? 'unknown'}.

## Forums
${forums || '- (none yet)'}

## Threads
${(snap.threads || [])
  .slice(0, 20)
  .map((t) => `- [${escapeMd(t.title)}](${SITE}/t/${encodeURIComponent(t.id)}/)`)
  .join('\n') || '- (none yet)'}

## Live
- [/](${SITE}/) — latest threads, forums, real-time data on the platform
- [/search](${SITE}/search/) — search threads
- [/login](${SITE}/login/) — login with Dash
`;
  writeFileSync(join(OUT, 'llms.txt'), body);
}

function escapeMd(s) {
  return String(s ?? '').replace(/[[\]()#*_~`<>]/g, (c) => `\\${c}`);
}

function manifest() {
  const snap = readSnapshot();
  mkdirSync(join(OUT, 'data', 'v1'), { recursive: true });
  writeFileSync(
    join(OUT, 'data', 'v1', 'manifest.json'),
    JSON.stringify(
      {
        network: snap.network,
        contractId: snap.contractId,
        snapshotAt: snap.generatedAt,
        counts: snap.counts,
      },
      null,
      2,
    ) + '\n',
  );
}

sitemap();
robots();
llms();
manifest();
