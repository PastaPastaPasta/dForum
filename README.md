# dForum

All storage on Dash Platform. All interactions via "login with Dash" (App Connect v2). An hourly-rebuilt static index for search, AI and SEO — every live action re-fetches from the platform at runtime.

Baseline / parity target: dash.org/forum (XenForo-style: categories → forums → threads → posts, likes, pins, locks, search, profiles, member badges, moderation).

**Live site**: https://pastapastapasta.github.io/dForum/ (subdomain — the `forum.dashhq.org` custom domain is wired into the build but its DNS is not added yet; deploy remains blocked until the CNAME exists).

## Architecture

Next.js 14 static export (TypeScript + Tailwind, react 18) with the Dash Platform as the single source of truth.

- `scripts/snapshot.mjs` — live platform reads: categories, forums, threads, posts, counts (proving completeness). Never a git branch — the workflow regenerates it hourly (and on push/dispatch) before the static build. Moderated content is dropped from the static index, and threads with no owner-owned visible post (orphan rule) are not listed.
- `npm run build` — prerenders every route from the snapshot, never from the network. Routes are **path routes** (`/t/{id}/`, `/f/{slug}/`, `/u/{id}/`) with `dynamicParams = false`; new threads/forums made since the last snapshot render live through the `404.html` SPA fallback (`app/not-found.tsx`) which re-mounts the same client components for those paths.
- The client re-queries the platform at runtime (`useLive`, `LiveFeed`) — posts newer than the snapshot fill in after hydration. The evo-sdk (~15 MB WASM) is loaded lazily on first live query, never at first paint (First Load JS ~125 kB).
- `scripts/generate-static-seo.mjs` — writes `sitemap.xml`, `robots.txt`, `llms.txt`, `/data/v1/manifest.json` from the snapshot. Moderated content is excluded from all of them.

### Content model (one contract, protocol 14, 9 types)

`forumSettings` (owner-only, one row) · `category` (owner-only) · `forum` (owner-only) · `teamMember` (owner-only) · `thread` (public) · `post` (public) · `reaction` (public) · `report` (public, reporter included) · `profile` (public).

- Every message is a `post`; a thread holds `title`, `tags`, `sticky`, `lockedAt`; flat reply chronology with `replyToId` for quotes. Forum id is immutable in v1 (no thread moves).
- No edit history: show "edited" when `$updatedAt > $createdAt` (moderator `changeFields` bump `$revision` without moving `$updatedAt`). No counters — counts computed live. Pagination via indexed ranges.
- `modState` non-null = hidden (console writes 1). Every render path — client, snapshot, sitemap — treats any non-null `modState` as hidden: body suppressed, listing suppressed, snapshot-excluded. Threads listed only when the earliest visible post's owner == thread owner (orphan rule).
- Post/thread bodies: ≤4000 characters / ≤5120 bytes (platform hard cap 5120/value).

### Moderation (native platform moderation, protocol 14)

- **Team mode** (default): `appointedModerators` in contract config — the owner + up to 16 named identities. Non-elected, owner-managed, enforced at consensus.
- `none` mode: no moderation block at all (nothing bannable/removable/moderatable).
- `network` mode: elected moderators (testnet-only; not recommended).
- The moderation console (`/moderation`) signs with a CRITICAL auth key pasted by the operator — **dropped from app state for the tab** (never stored, never written outside the tab): the WASM signer is freed on wipe (`pagehide`, `visibilitychange` → hidden, in-app navigation, 10-minute idle, unmount) and the WIF is dropped from React state. Honest wording: “dropped from app state” — not a guarantee about memory. The owner identity always moderates and holds full contract authority (roster + moderation config); the console refuses the owner key off localhost — keep it offline for contract updates. The chain forbids moderating your own documents, so self-actions disable automatically with an explanatory note. The host gate warns on non-canonical hosts (localhost permitted for testing).
- Moderation actions (hide/unhide, pin, lock, ban, suspend, warn, clear warnings, delete) prompt a confirmation before anything destructive; deletion keeps the record and stores only `threadId`/`forumId`.

### Identity & login

App Connect v2 ("login with Dash", vendored `platform-auth` under `vendor/platform-auth/`). Session = identity id + auth key in sessionStorage (`dforum:auth:*`), never persisted cross-tab/cross-device; the login key itself is never stored anywhere.

### Static index strategy

The canonical routes are themselves static HTML (no `/index/` tree). The hourly workflow regenerates the snapshot, builds, and deploys to GitHub Pages; if the snapshot or build fails, the previous deployment keeps serving (the workflow fails loudly).

## Build & deploy

```bash
npm ci
node scripts/snapshot.mjs   # live platform snapshot (writes data/snapshot.json)
npm run build               # prerenders from the snapshot (zero network)
node scripts/generate-static-seo.mjs
python3 -m http.server 8899 --directory out   # preview the static site
```

Deploy is via `.github/workflows/pages.yml` (hourly cron + push to `main` + dispatch). The workflow has a **build job** (checkout → npm ci → tsc → snapshot → build → SEO files → upload-pages-artifact) with `BASE_PATH=/dForum`, and a separate **deploy job** (`upload-pages-artifact` → `deploy-pages`). The split gives every build a clean `contents: read` sandbox and keeps the deploy permission scoped to the deploy job. Static site served from `out/`; the committed `data/snapshot.json` is a stub — a real snapshot never lands in git.

## Local dev

- GitHub Pages subdomain: `https://pastapastapasta.github.io/dForum/`
- Live content (thread/post pages, search) is only fully visible after login — the snapshot is public-readable.
- The moderation console requires a CRITICAL key for a contract moderator identity; without it the console renders but actions disable.

## Security notes

- Secrets are never in the repo. The deployer seed lives in the shared secret store (`~/.secrets/dforum/testnet-deployer`, linked into `.env.local`, gitignored). `.env.testing` and `.env*` are gitignored.
- The moderation console's CRITICAL key never leaves the operator's browser — the WASM signer is freed and the WIF dropped from app state on wipe (pagehide, tab-hide, in-app navigation, 10-minute idle, unmount).
- CSP is declared via `<meta http-equiv>` (static export is header-less): same-origin scripts/styles, WASM/blob workers, `connect-src 'self' https: wss:` (the Dash Platform is hosted on masternode IPs, so the connect-src cannot be narrowed without breaking the app).
- Public files (sitemap, llms.txt, manifest) only carry public content, and moderated content is excluded.
- Write fees: post 0.00134 DASH, thread 0.00164, reaction 0.00091, category 0.00038, forumSettings 0.00024 (credits ÷ 1e11) — all well under the 0.005 target (see `docs/design/spike-results.md`).

## Repository

| Path | Role |
| --- | --- |
| `app/` | Next.js app router pages (path routes `/t/[id]`, `/f/[slug]`; shell pages only) |
| `components/` | Navbar, Footer, Avatar, LiveFeed, KeyExchangeModal, ThreadRow, ThreadClient, ForumClient, ProfileClient |
| `lib/` | Auth (App Connect), services (evo-sdk, snapshot, document, moderation), session, constants |
| `contracts/` | build.mjs + generated contracts (none/team/network) + deployments record |
| `scripts/` | snapshot.mjs, generate-static-seo.mjs, provision-identity.mjs, spikes/ |
| `vendor/platform-auth/` | Vendored App Connect v2 client |
| `docs/design/` | Design rationale + spike results |
| `data/snapshot.json` | Stub only; a real snapshot is never committed |

## License

MIT.
