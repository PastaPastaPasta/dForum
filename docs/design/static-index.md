# Static index (SEO / AI indexing)

Two stages, never a separate `/index/` tree:

1. `scripts/snapshot.mjs` — snapshot script. Reads the platform with proved queries only: the recent/updated/moderated indexes + negative-cost full reconcile (nightly) + removals. Applies moderation (omit hidden/removed bodies; ban-list filter if forumSettings.hideBannedContent). Writes a snapshot dir (`snapshot/`, gitignored, Actions cache/artifact or R2 — NOT a git branch: git keeps taken-down content forever).
2. `next build` — reads only the snapshot (never the network). Outputs static pages for the canonical routes.

## Routes (canonical, self-static HTML)
- `/` — home (latest forums/threads)
- `/f/{categorySlug}/{forumSlug}/[page/N/]` — forum listing (also `/f/{forumSlug}/` if forum under root)
- `/t/{threadId}/[page/N/]` — thread (opening post + replies)
- `/m/{identityId}/[page/N/]` — member profile listing (threads/posts by identity)
- `/data/v1/manifest.json` — build manifest (contract id+version, snapshot time, counts)
- `/data/v1/forums.json` — all forums
- `/data/v1/f/{forumId}/p{n}.json` — per-forum thread pages (cursor boundaries)
- `/data/v1/t/{threadId}/p{n}.json` — per-thread post pages (cursor boundaries)
- `/sitemap.xml` index → `/sitemaps/{forums-N,threads-N,members-N}.xml` (≤50k URLs each, lastmod)
- `/feed.xml` + `/f/{forumSlug}/feed.xml` — RSS 2.0 (50 items)
- `/robots.txt`, `/llms.txt` — AI crawlers allowed; content-policy notes
- JSON-LD `DiscussionForumPosting` on thread pages
- Footer "snapshot as of {time}" on every static page

## Gates
- Completeness: fetched doc counts must equal proved counts (documentsCountable, per-forum/thread groupBy counts) or the deploy is skipped (last good site keeps serving).
- Sanity: contract id + version from build config matches the snapshot; total posts must not drop >2% vs last good unless removals explain it.
- New threads not yet in the snapshot: SPA fallback via GH Pages `404.html` (404 status, noindex) until the next build runs.

## Incremental
- Hourly: new/edited via `byUpdated`/`recent` (cursor startAfter), moderator changes via `moderated`, moderator deletions via `documentRemovals`.
- Nightly: full reconcile (author deletions are invisible to deltas).
- GH Actions scheduled runs are unreliable + disabled after 60 days of repo inactivity; use `concurrency` group + `workflow_dispatch` emergency rebuild.
- Hydration: static renders first; SDK loads after first paint; posts newer than the snapshot are fetched live; rendered post ids re-checked for removal/hide/edit (`$id in [...]`); staff UI only after login.
