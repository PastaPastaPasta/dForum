# Static index (SEO / AI indexing)

Two stages, never a separate `/index/` tree:

1. `scripts/snapshot.mjs` — snapshot script. Reads the platform with proved queries only: the recent/updated/moderated indexes + negative-cost full reconcile (nightly) + removals. Applies moderation (omit hidden/removed bodies; ban-list filter if forumSettings.hideBannedContent). Writes a snapshot dir (`snapshot/`, gitignored, Actions cache/artifact or R2 — NOT a git branch: git keeps taken-down content forever).
2. `next build` — reads only the snapshot (never the network). Outputs static pages for the canonical routes.

## Routes (canonical, self-static HTML)
- `/` — home (latest forums/threads, live-fills from the platform after hydration)
- `/f/{slug}/` — forum listing (path route; prerendered from the snapshot)
- `/t/{threadId}/` — thread (opening post + replies; path route, prerendered from the snapshot)
- `/u/{identityId}/` — member profile (NOT prerendered — every profile renders live; the URL hits the 404 SPA fallback)
- `/login`, `/search`, `/new`, `/settings`, `/moderation` — static shell routes
- `/sitemap.xml` — threads + forums (path routes, trailing slash, moderated content excluded)
- `/robots.txt`, `/llms.txt` — AI crawlers allowed; content-policy notes
- Footer "snapshot as of {time}" on every static page (rendered via the static shell)

The build reads only the snapshot — never the network. `generateStaticParams` throws a clear error if the snapshot is empty (run `node scripts/snapshot.mjs` first); a broken snapshot fails the build and the last good deploy keeps serving.

## Gates
- Completeness: fetched doc counts must equal proved counts (documentsCountable, per-forum/thread groupBy counts) or the deploy is skipped (last good site keeps serving).
- Sanity: contract id + version from build config matches the snapshot; total posts must not drop >2% vs last good unless removals explain it.
- New threads/forums not yet in the snapshot: SPA fallback via GH Pages `404.html` (404 status; `/t/`, `/f/`, `/u/` URLs render the live client components for that path; anything else shows the plain 404) until the next build runs.

## Incremental
- Hourly: new/edited via `byUpdated`/`recent` (cursor startAfter), moderator changes via `moderated`, moderator deletions via `documentRemovals`.
- Nightly: full reconcile (author deletions are invisible to deltas).
- GH Actions scheduled runs are unreliable + disabled after 60 days of repo inactivity; use `concurrency` group + `workflow_dispatch` emergency rebuild.
- Hydration: static renders first; SDK loads after first paint; posts newer than the snapshot are fetched live; rendered post ids re-checked for removal/hide/edit (`$id in [...]`); staff UI only after login.
