# Static index and live overlay

## Snapshot (`scripts/snapshot.mjs`)

- **Watermark.** Each run starts by reading the platform block time (`queryWithProof` metadata). That time becomes the watermark.
- **Small types are read in full:** forumSettings, category, forum and teamMember. The contract is read for the owner and roster.
- **Incremental reads.** thread, post, reaction and profile are read by `$updatedAt >=` the last watermark minus 10 minutes, plus `$moderatedAt >=` for moderated types. Results merge into the raw-document cache (`.cache/snapshot-state.json`), where the higher revision wins.
- **`--full`** (and any missing cache, contract change, or cache older than 24 hours) rescans everything; CI also passes `--full` on manual dispatch. Every run, full or incremental, also reads the contract's removal records, so moderator deletes drop out within the hour; hides, edits and author deletes arrive through the `byUpdated` and `moderated` indexes.
- **Outputs**, through the same rules as the browser (lib/forum/model.ts):
  - `data/site.json`: settings, roster, categories, forums with rolled-up counts and last post, stats, latest threads and posts, tags.
  - `data/forum/<id>.json`: thread summaries, pinned first, then latest activity.
  - `data/thread/<id>.json`: the thread, every post in order (hidden and retracted posts as empty placeholders), and reaction counts.
  - `data/user/<id>.json` and `data/members.json`.
  - `data/archive-members.json`.
- Any read error fails the run. CI then fails, and the last good deploy keeps serving.

## Build

Next.js 14 static export.

- **Routes:**
  - `/`
  - `/f/<slug>/` and `/f/<slug>/page/<n>/` (30 threads per page)
  - `/t/<id>/` and `/t/<id>/page/<n>/` (20 posts per page)
  - `/u/<id>/`, `/members/`, `/whats-new/`, `/tags/<tag>/`, `/rules/`, `/search/`
  - `/new/`, `/settings/`, `/alerts/`, `/login/`, `/moderation/`
- **Network:** the build reads only `data/` and never the network.
- **Post-build** (`npm run index:site`, after `postbuild` writes the hashed CSP):
  - `sitemap.xml`, `robots.txt`, `llms.txt`
  - RSS: `feed.xml` and `f/<slug>/feed.xml`
  - the public static API: `data/v2/site.json`, `data/v2/forum/<id>.json`, `data/v2/thread/<id>.json`
  - a Pagefind full-text index over the thread pages (`data-pagefind-body`; composer and reaction controls excluded)

## Live overlay (lib/live/overlay.ts)

- **Delta queries.** After hydration each page subscribes to one shared store. It runs the same delta queries as the snapshot (byUpdated and moderated, from `snapshotAt` minus 10 minutes) and polls every 45 s while the tab is visible. Pages fold the delta into their static data with `lib/forum/live-merge.ts`:
  - new threads (once their opening post is visible)
  - new replies, which bump counts, last post and "What's new"
  - edits, hides, moves, locks and pins
  - profile changes
- **Reactions.** Thread pages also load all of the thread's reactions (`reaction.byThread`) for exact counts and the member's own reaction.
- **Newer content.** Threads and members newer than the snapshot have no prerendered page. GitHub Pages serves `404.html`, which renders them live from the chain (`components/site/LiveFallback.tsx`).
- **Own writes** show immediately (`injectLocal`), before the next poll.
- The SDK (about 30 MB of WASM) loads lazily. First Load JS is about 140 KB.

## Hosting

GitHub Pages (`forum.dashhq.org`), via `.github/workflows/pages.yml`: hourly cron, push to `main`, and dispatch. The build job has read-only permissions; a separate deploy job publishes. The snapshot cache lives in the Actions cache, never in git, so taken-down content is not kept forever. At full dash.org scale (about 18k thread pages) the export is a few hundred MB, inside Pages limits; Cloudflare R2 behind the same workflow is the fallback if it outgrows them.
