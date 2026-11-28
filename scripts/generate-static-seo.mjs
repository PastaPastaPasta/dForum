#!/usr/bin/env node
/**
 * Post-build files for search engines, AI crawlers and feed readers (reads data/, writes out/):
 *   sitemap.xml, robots.txt, llms.txt, feed.xml, f/<slug>/feed.xml,
 *   data/v2/site.json, data/v2/forum/<id>.json, data/v2/thread/<id>.json (the public static API)
 * Hidden and removed content never appears: the snapshot already excludes it.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { POSTS_PER_PAGE, THREADS_PER_PAGE } from '../lib/forum/types.ts';
import { effectiveAt, excerpt, isHidden, isRetracted, postBody } from '../lib/forum/model.ts';

const OUT = 'out';
const SITE = (process.env.SITE_URL || 'https://forum.dashhq.org').replace(/\/+$/, '');
const read = (p) => JSON.parse(readFileSync(join('data', p), 'utf8'));
const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
const iso = (ms) => new Date(ms).toISOString();

if (!existsSync('data/site.json')) {
  console.error('data/site.json missing — run scripts/snapshot.mjs first');
  process.exit(1);
}
const site = read('site.json');
const archive = site.settings.archiveOwnerId;
const threadFiles = existsSync('data/thread') ? readdirSync('data/thread').filter((f) => f.endsWith('.json')) : [];
const forumFile = (id) => (existsSync(`data/forum/${id}.json`) ? read(`forum/${id}.json`) : { threads: [] });

// sitemap
const urls = [{ loc: '/', lastmod: site.snapshotAt }, { loc: '/whats-new/' }, { loc: '/members/' }, { loc: '/rules/' }];
for (const f of site.forums) {
  const threads = forumFile(f.id).threads;
  const pages = Math.max(1, Math.ceil(threads.length / THREADS_PER_PAGE));
  for (let n = 1; n <= pages; n++) urls.push({ loc: n === 1 ? `/f/${f.slug}/` : `/f/${f.slug}/page/${n}/`, lastmod: f.lastPost?.at });
}
for (const file of threadFiles) {
  const t = read(`thread/${file}`);
  const pages = Math.max(1, Math.ceil(t.posts.length / POSTS_PER_PAGE));
  const last = t.posts.at(-1);
  for (let n = 1; n <= pages; n++) urls.push({ loc: n === 1 ? `/t/${t.thread.id}/` : `/t/${t.thread.id}/page/${n}/`, lastmod: last ? Math.max(last.updatedAt, effectiveAt(last, archive)) : undefined });
}
for (const t of site.tags) urls.push({ loc: `/tags/${t.tag}/` });
const members = existsSync('data/members.json') ? read('members.json') : [];
for (const m of members) if (!m.hidden) urls.push({ loc: `/u/${m.id}/` });
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(SITE + u.loc)}</loc>${u.lastmod ? `<lastmod>${iso(u.lastmod).slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`);

writeFileSync(join(OUT, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /login/
Disallow: /moderation/
Disallow: /settings/
Disallow: /new/
Disallow: /alerts/

Sitemap: ${SITE}/sitemap.xml
`);

const name = site.settings.name || 'dForum';
writeFileSync(join(OUT, 'llms.txt'), `# ${name}

> ${site.settings.tagline || 'A forum stored on Dash Platform.'}

${site.settings.description || ''}

Every thread, post, reaction and profile is a document on Dash Platform (${site.network}, data contract ${site.contractId}), written by the member's own Dash identity. This site is a static index rebuilt about hourly from the chain; newer activity loads live in the browser.${site.settings.archiveSourceName ? ` It includes history imported from ${site.settings.archiveSourceName}; imported posts are labeled with their original author and date.` : ''}

- ${site.stats.threads} threads, ${site.stats.posts} messages, ${site.stats.members} members (index updated ${iso(site.snapshotAt)})
- Machine-readable data: ${SITE}/data/v2/site.json, ${SITE}/data/v2/forum/<forumId>.json, ${SITE}/data/v2/thread/<threadId>.json
- Feeds: ${SITE}/feed.xml and ${SITE}/f/<forum-slug>/feed.xml

## Forums

${site.categories.map((c) => `### ${c.title}\n${site.forums.filter((f) => f.categoryId === c.id).map((f) => `- [${f.title}](${SITE}/f/${f.slug}/): ${f.description || ''} (${f.threadCount} threads)`).join('\n')}`).join('\n\n')}
`);

// RSS: newest threads site-wide and per forum
function rss(title, link, items) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(title)}</title>
<link>${esc(SITE + link)}</link>
<atom:link href="${esc(SITE + link)}feed.xml" rel="self" type="application/rss+xml" />
<description>${esc(site.settings.tagline || name)}</description>
<lastBuildDate>${new Date(site.snapshotAt || Date.now()).toUTCString()}</lastBuildDate>
${items.map((t) => `<item>
  <title>${esc(t.title)}</title>
  <link>${esc(`${SITE}/t/${t.id}/`)}</link>
  <guid isPermaLink="true">${esc(`${SITE}/t/${t.id}/`)}</guid>
  <pubDate>${new Date(t.createdAt).toUTCString()}</pubDate>
  <description>${esc(t.excerpt)}</description>
</item>`).join('\n')}
</channel>
</rss>
`;
}
const threadSummaries = site.forums.flatMap((f) => forumFile(f.id).threads);
const withExcerpt = (t) => {
  let ex = ''
  if (existsSync(`data/thread/${t.id}.json`)) {
    const first = read(`thread/${t.id}.json`).posts.find((p) => !isHidden(p) && !isRetracted(p));
    if (first) ex = excerpt(postBody(first), 400);
  }
  return { ...t, excerpt: ex };
};
const newest = (list) => [...list].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map(withExcerpt);
writeFileSync(join(OUT, 'feed.xml'), rss(name, '/', newest(threadSummaries)));
for (const f of site.forums) {
  mkdirSync(join(OUT, 'f', f.slug), { recursive: true });
  writeFileSync(join(OUT, 'f', f.slug, 'feed.xml'), rss(`${f.title} | ${name}`, `/f/${f.slug}/`, newest(forumFile(f.id).threads)));
}

// Public static API (same files the build used).
mkdirSync(join(OUT, 'data', 'v2'), { recursive: true });
cpSync('data/site.json', join(OUT, 'data/v2/site.json'));
if (existsSync('data/forum')) cpSync('data/forum', join(OUT, 'data/v2/forum'), { recursive: true });
if (existsSync('data/thread')) cpSync('data/thread', join(OUT, 'data/v2/thread'), { recursive: true });
console.log(`seo: ${urls.length} sitemap urls, ${threadFiles.length} threads, feeds for ${site.forums.length} forums`);
