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
// The public origin the deployed site is served from, plus the base path the
// build was served under (GH Pages serves project sites at /<repo>). Set
// SITE_URL/BASE_PATH when the site moves — the sitemap, robots.txt and
// llms.txt all use them, so a wrong host here means bad indexing.
const SITE = (process.env.SITE_URL || 'https://forum.dashhq.org').replace(/\/+$/, '');
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const SITE_PREFIX = SITE + BASE_PATH;

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
  const urls = [`${SITE_PREFIX}/`, `${SITE_PREFIX}/login/`, `${SITE_PREFIX}/search/`];
  for (const f of snap.forums || []) {
    if (f.slug && !f.archived) urls.push(`${SITE_PREFIX}/f/${encodeURIComponent(f.slug)}/`);
  }
  for (const t of snap.threads || []) {
    if (t.id && !t.modState && !t.archived) urls.push(`${SITE_PREFIX}/t/${encodeURIComponent(t.id)}/`);
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
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_PREFIX}/sitemap.xml\n`;
  writeFileSync(join(OUT, 'robots.txt'), body);
}

function llms() {
  const snap = readSnapshot();
  const forums = (snap.forums || [])
    .filter((f) => f.slug && !f.archived)
    .map((f) => `- [${escapeMd(f.title)}](${SITE_PREFIX}/f/${encodeURIComponent(f.slug)}/)`)
    .join('\n');
  const body = `# dForum — a decentralized forum on Dash Platform

Centralized ownership, team-based (non-elected) moderation, every message stored on Dash Platform. All interactions via login-with-Dash. Snapshot as of ${snap.generatedAt ?? 'unknown'}.

## Forums
${forums || '- (none yet)'}

## Threads
${(snap.threads || [])
  .slice(0, 20)
  .map((t) => `- [${escapeMd(t.title)}](${SITE_PREFIX}/t/${encodeURIComponent(t.id)}/)`)
  .join('\n') || '- (none yet)'}

## Live
- [/](${SITE_PREFIX}/) — latest threads, forums, real-time data on the platform
- [/search](${SITE_PREFIX}/search/) — search threads
- [/login](${SITE_PREFIX}/login/) — login with Dash
`;
  writeFileSync(join(OUT, 'llms.txt'), body);
}

function escapeMd(s) {
  // Strip CR/LF first — a title can otherwise inject fake sections into
  // llms.txt (prompt-injection surface for AI crawlers).
  return String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[[\]()#*_~`<>]/g, (c) => `\\${c}`);
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
