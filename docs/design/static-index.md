# Static index (SEO / AI indexing)

Two stages, never a separate `/index/` tree. Both stages read only what the
snapshot holds — the build never touches the network.

1. `scripts/snapshot.mjs` — a full rebuild, not an incremental delta. Queries
   the platform for every category (≤50), every forum (≤50), the latest
   threads (up to 60 listed; the scan paginates via a `startAfter` cursor,
   never a timestamp, so orphan-spam cannot push real threads out of the
   window), and the per-type proved counts (categories/forums/threads/posts/
   reactions). Moderated content (any non-null `modState`) is excluded, as are
   threads whose opening post is hidden or absent (the orphan rule — see
   `docs/design/data-model.md`). Writes `data/snapshot.json` (forums/categories/
   threads, never post bodies — the bundle is imported by every client page)
   and `data/posts/<threadId>.json` for each listed thread (the first 5 visible
   posts at/after the opening post — the static thread page renders these).
   Both files are gitignored, regenerated hourly by the workflow — never a git
   branch: git keeps taken-down content forever.
2. `next build` — prerenders every route from the snapshot. New content made
   since the snapshot renders live through the `404.html` SPA fallback.

## Routes (canonical, self-static HTML)
- `/` — home (latest threads, forums, categories, live-fills from the platform after hydration)
- `/f/{slug}/` — forum listing (path route; prerendered from the snapshot)
- `/t/{id}/` — thread (path route; prerendered from the snapshot)
- `/u/{identityId}/` — member profile (path route; prerendered for owners listed in the snapshot)
- `/login`, `/search`, `/new`, `/settings`, `/moderation` — static shell routes
- `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/data/v1/manifest.json` — written by `scripts/generate-static-seo.mjs` (sitemap: threads + forums, path routes, trailing slash, moderated content excluded)

The build reads only the snapshot — never the network. `generateStaticParams`
is fed from the snapshot; a broken snapshot fails the build and the last good
deploy keeps serving.

## Gates
- Completeness: any fetch/count error throws — the build then fails and the
  last good deploy keeps serving. An honest empty answer (zero listable
  threads) does NOT fail the build — the SPA fallback covers the gap.
- Threads are listed only when the opening post exists AND is itself
  visible (the orphan rule, applied identically to the snapshot and the live
  clients). Hidden or ownerless threads are excluded from the snapshot, the
  sitemap, llms.txt, the manifest and the prerendered pages.
- Index-window overflow (forums/categories filled their 50-doc window) fails
  the build loudly — silently truncated indexes would lie about the site.
- Moderated content is never published on the static index (site map,
  prerendered pages, llms.txt, manifest) — it stays on-chain and renders only
  live.

## Incremental / freshness
- Hourly: full snapshot (bounded window: latest 60 threads, ≤50 forums/categories) then a rebuild. No incremental delta pipeline: a bounded window plus an honest 404-fallback covers the gap, and a full rebuild is simple and reproducible.
- New threads/forums/posts not yet in the snapshot: SPA fallback via GH Pages `404.html` (404 status; `/t/`, `/f/`, `/u/` URLs render the live client components for that path; anything else shows the plain 404) until the next build runs — the hourly cron keeps the gap small.
- Hydration: static renders first; the SDK loads after first paint; the live layer re-queries the platform and fills in everything newer (and the moderated-state of what was prerendered is re-checked against the live query).
