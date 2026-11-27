# dForum

All storage on Dash Platform. All interactions via "login with Dash" (App Connect v2). An hourly-rebuilt static index for search, AI and SEO — every live action re-fetches from the platform at runtime.

Baseline / parity target: dash.org/forum (XenForo-style: categories → forums → threads → posts, likes, pins, locks, search, profiles, member badges, moderation).

**Live site**: https://forum.dashhq.org (GitHub Pages custom domain — DNS is live).

> **Live-index posture.** The site is a static shell served from `forum.dashhq.org` — it loads the snapshot first (fast, indexable) and live-fills from the platform after first paint (the evo-sdk lazy-loads on the first live query; the live fill never depends on the snapshot beyond first paint). Login, posting and moderation run on this canonical host (they refuse to run everywhere else).

## Architecture

Next.js 14 static export (TypeScript + Tailwind, react 18) with the Dash Platform as the single source of truth.

- `scripts/snapshot.mjs` — live platform reads: categories, forums, threads, posts and counts, with a completeness gate (any fetch or count failure throws — the build then fails and the last good deploy keeps serving). Never a git branch — the workflow regenerates it hourly (and on push/dispatch) before the static build. Moderated and ownerless threads are dropped from the static index (orphan rule), and any index-window overflow (forums/categories filled their 50-doc window) also fails the build loudly. An honest empty answer (zero listable threads) does NOT fail the build — the SPA fallback covers the gap.
- `npm run build` — prerenders every route from the snapshot, never from the network. Routes are **path routes** (`/t/{id}/`, `/f/{slug}/`, `/u/{id}/`) with `dynamicParams = false`; new threads/forums made since the last snapshot render live through the `404.html` SPA fallback (`app/not-found.tsx`) which re-mounts the same client components for those paths.
- The client re-queries the platform at runtime (`useLive`, `LiveFeed`) — posts newer than the snapshot fill in after hydration. The evo-sdk (~30 MB WASM) is loaded lazily on first live query, never at first paint (First Load JS ~125 kB).
- `scripts/generate-static-seo.mjs` — writes `sitemap.xml`, `robots.txt`, `llms.txt`, `/data/v1/manifest.json` from the snapshot. Moderated content is excluded from all of them.

### Content model (one contract, protocol 14, 9 types)

`forumSettings` (owner-only, one row) · `category` (owner-only) · `forum` (owner-only) · `teamMember` (owner-only) · `thread` (public) · `post` (public) · `reaction` (public) · `report` (public, reporter included) · `profile` (public).

- Every message is a `post`; a thread holds `title`, `tags`, `sticky`, `lockedAt`; flat reply chronology with `replyToId` for quotes. Forum id is immutable in v1 (no thread moves).
- No edit history: show "edited" when `$updatedAt > $createdAt` (moderator `changeFields` bump `$revision` without moving `$updatedAt`). No counters — counts computed live. Pagination via indexed ranges.
- `modState` non-null = hidden (console writes 1). Every render path — client, snapshot, sitemap — treats any non-null `modState` as hidden: body suppressed, listing suppressed, snapshot-excluded. Threads are listed only when the earliest owner-owned post (ordered by `$createdAt`, `$id`, regardless of moderation state) exists AND is itself visible — hidden, ownerless, or fully-locked threads are dropped everywhere (snapshot, live listings, sitemap, llms.txt).
- Post/thread bodies: ≤4000 characters / ≤5120 bytes (platform hard cap 5120/value).

### Moderation (native platform moderation, protocol 14)

- **Team mode** (default): `appointedModerators` in contract config — the owner + up to 16 named identities. Non-elected, owner-managed, enforced at consensus.
- `none` mode: no moderation block at all (nothing bannable/removable/moderatable).
- `network` mode: elected moderators (testnet-only; not recommended).
- The moderation console (`/moderation`) signs with a CRITICAL auth key pasted by the operator — **dropped from app state for the tab** (never stored, never written outside the tab): the WASM signer is freed on wipe (`pagehide`, `visibilitychange` → hidden, in-app navigation, 10-minute idle, unmount) and the WIF is dropped from React state. Honest wording: “dropped from app state” — not a guarantee about memory. The owner identity always moderates and holds full contract authority (roster + moderation config); the console refuses the owner key off localhost — keep it offline for contract updates. The chain forbids moderating your own documents, so self-actions disable automatically with an explanatory note. The host gate hard-refuses the console on non-canonical hosts — there is no acknowledgement checkbox for a CRITICAL key (login shows a read-only notice and stays put).
- Moderation actions (hide/unhide, pin, lock, ban, suspend, warn, clear warnings, delete) prompt a confirmation before anything destructive; deletion keeps the record and stores only `threadId`/`forumId`.

### Identity & login

App Connect v2 ("login with Dash", `dashpay://connect` — vendored `platform-auth` under `vendor/platform-auth/`). The wallet registers a HIGH-level, contract-bound auth key (singleContract → dForum's contract, ~0.5 DASH lifetime budget, 90-day expiry) as part of the approval; the app verifies the answer on chain and stores the resulting key in sessionStorage (`dforum:auth:*`), never persisted cross-tab/cross-device. The login key itself is never stored anywhere. Writes are batched — a bound key only signs batched transitions.

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

Deploy is via `.github/workflows/pages.yml` (hourly cron + push to `main` + dispatch). The workflow has a **build job** (checkout → npm ci → tsc → snapshot → build → SEO files → upload-pages-artifact), and a separate **deploy job** (`upload-pages-artifact` → `deploy-pages`). The split gives every build a clean `contents: read` sandbox and keeps the deploy permission scoped to the deploy job. Static site served from `out/`; `data/snapshot.json` is gitignored (CI regenerates the real one) — a stub is written by `scripts/ensure-snapshot-stub.mjs` so a fresh clone still type-checks. A real snapshot never lands in git.

## Local dev

- Custom domain: `https://forum.dashhq.org`
- The site is fully readable signed-out (home, forums, threads, profiles, search) — the snapshot is public-readable and live content renders from it plus the platform. Sign-in, posting and moderation run on the canonical host.
- The moderation console requires a CRITICAL key for a contract moderator identity; without it the console renders but actions disable.

## Security notes

- Secrets are never in the repo. The deployer seed lives in the shared secret store (`~/.secrets/dforum/testnet-deployer`, linked into `.env.local`, gitignored). `.env.testing` and `.env*` are gitignored.
- The moderation console's CRITICAL key never leaves the operator's browser — the WASM signer is freed and the WIF dropped from app state on wipe (pagehide, tab-hide, in-app navigation, 10-minute idle, unmount).
- CSP is declared via a per-page `<meta http-equiv>` written by the post-build step (`scripts/csp.mjs`, after `next build`): the export is header-less, and inline scripts (the RSC payload) can't be allowed without `'unsafe-inline'` — so each page's inline scripts are hashed (sha256) and the meta allows exactly those hashes. External scripts load from `'self'`; workers/wasm stay allowed. `connect-src 'self' https: wss:` (the Dash Platform is hosted on masternode IPs, so the connect-src cannot be narrowed without breaking the app). Framework `frame-ancestors` is not expressible in a meta CSP — the moderation console and login page instead enforce a JavaScript frame-buster (`window.top !== window.self` → top navigates away).
- Public files (sitemap, llms.txt, manifest) only carry public content, and moderated content is excluded.
- **App Connect session-key bounds.** The App Connect v2 flow registers a HIGH-level auth key bound to dForum's contract (`singleContract`, ~0.5 DASH lifetime budget, 90-day expiry) as part of the approval; the chain enforces the bounds and budgets — the key can only sign document operations on dForum's contract, and only until the budget or expiry passes. The mitigations layer on top: the host gate (login and the moderation console are hard-refused on non-canonical origins — no acknowledgement flow — and simply stay put, read-only, on the read-only deploy), sessionStorage scoped to the tab, never persisted cross-tab/cross-device, an expiry check on restore (a session-restored key is only trusted for 24 h), the HIGH key never leaves the browser beyond the platform request, no storage of the login key, and batched writes (bound keys sign batches only). The owner keeps the full-contract CRITICAL key offline (full contract authority includes the roster and moderation config — the console refuses it off localhost). **Revoking the session key:** disconnect dForum in the wallet (or disable/rotate the HIGH key from the identity's key UI) — the wallet's grant record is keyed by (identity, app id, connection id), so a re-login supersedes the earlier grant.
- **Host gate.** The key-signing surfaces are gated by the host: `localhost` and `forum.dashhq.org` are pre-approved. **Login** and **the moderation console** — on any other origin — refuse outright: no acknowledgement checkbox, no key-signing flow, only an open-on-the-canonical-host affordance. The dedicated canonical host is the goal.
- Write fees: post 0.00134 DASH, thread 0.00164, reaction 0.00091, category 0.00038, forumSettings 0.00024 (credits ÷ 1e11) — all well under the 0.005 target (see `docs/design/spike-results.md`).

## Repository

| Path | Role |
| --- | --- |
| `app/` | Next.js app router pages (path routes `/t/[id]`, `/f/[slug]`; shell pages only) |
| `components/` | Navbar, Footer, Avatar, LiveFeed, RelativeTime, KeyExchangeModal, ThreadRow, ThreadClient, ForumClient, ProfileClient, HomeClient, SearchClient, NewThreadClient |
| `lib/` | Auth (App Connect v2: use-login, request, port, key-mapping, connection-id; controller, adapters, decoder), services (evo-sdk, batch-write, snapshot-server, document, moderation, orphan, moderator-fields), use-profiles, session, constants |
| `contracts/` | build.mjs + generated contracts (none/team/network) + deployments record |
| `scripts/` | snapshot.mjs, generate-static-seo.mjs, provision-identity.mjs, spikes/ |
| `vendor/platform-auth/` | Vendored App Connect v2 client |
| `docs/design/` | Design rationale + spike results |
| `data/snapshot.json` | Gitignored; real snapshot regenerated by CI (stub written by prebuild) |

## License

MIT.
