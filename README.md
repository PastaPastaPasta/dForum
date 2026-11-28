# dForum

A community forum stored entirely on Dash Platform: threads, posts, reactions, reports, profiles and moderation are documents in one data contract, written by members' own Dash identities. Members log in with their Dash wallet (App Connect v2). A static index rebuilt every hour serves fast, crawlable pages, and anything newer loads live from the chain.

**Live (testnet):** https://forum.dashhq.org. Baseline: dash.org/forum, including its imported history.

## How it fits together

```
Dash Platform (contract v4) ──hourly──> scripts/snapshot.mjs ──> data/*.json ──> next build ──> static pages
        │                                                                     + sitemap, RSS, llms.txt, JSON API, search index
        └──live (browser)──> changed-since-snapshot queries ──> merged into every page; writes signed in the tab
```

| Path | What it is |
| --- | --- |
| `contracts/build.mjs` | Contract schema (modes `team`, `none`, `network`); `generated/` holds the outputs; `deployments/testnet.json` records the registration, roster and test personas |
| `lib/forum/` | Shared rules (model, live merge, types) used by the snapshot, the build and the browser; the member write actions |
| `lib/live/` | Live overlay, alerts, profile names, Platform reads |
| `lib/import/` | XenForo parsers, HTML/BBCode to Markdown, import plan |
| `lib/app-connect/`, `lib/auth/`, `vendor/platform-auth/` | Login with Dash (App Connect v2) |
| `lib/services/` | Document writes (batched, contract-bound keys), moderation transitions, write-error copy |
| `app/`, `components/` | Next.js 14 static export: forum index, forums, threads, members, search, alerts, settings, login, moderation |
| `scripts/` | snapshot, SEO/feeds, CSP, contract registration, seeding, moderator roster, moderator CLI, importer, static server |
| `e2e/` | Testnet end-to-end scenario driven through the real login |
| `docs/design/` | Design: data model, moderation, static index, importer, parity, testing |

## Commands

```bash
npm ci
npm test && npx tsc --noEmit && npx next lint
node scripts/snapshot.mjs [--full]     # chain → data/ (incremental; CI caches .cache/)
npm run build                          # static export to out/ (+ hashed CSP)
npm run index:site                     # sitemap, robots, llms.txt, RSS, data/v2 API, Pagefind search index
npm run serve                          # GitHub Pages emulation on :8899 (404 SPA fallback)
```

## Operating the forum (owner and moderators)

| Task | How |
| --- | --- |
| Register a contract | `node scripts/register-contract.mjs --mode team` (owner CRITICAL key) |
| Settings, categories, forums, team labels | edit `contracts/seed/<network>.json`, then run `node scripts/seed-forum.mjs` |
| Appoint or remove moderators | `node scripts/set-moderators.mjs --add <id> [--remove <id>]` (contract update) |
| Moderate | `/moderation` in the browser (moderator CRITICAL key, held in the tab only) or `node scripts/moderate.mjs` |
| Import dash.org/forum history | `node scripts/import/xenforo.mjs crawl|plan|structure|load` (see docs/design/importer.md) |

Keys never live in the repo. Testnet derives them from the deployer seed in the shared secret store (`dforum/testnet-deployer`, linked as `.env.local`). Other networks read `DFORUM_*_WIF` environment variables.

## Security notes

- **Login keys.** Login gives this tab a HIGH key that the member's wallet registers. That key is bound to this contract alone, has a fee budget of about 0.5 DASH and a 90-day expiry; the chain enforces all three. The tab keeps it in sessionStorage until logout.
- **Where signing runs.** Login, writes and moderation run only on `forum.dashhq.org` or localhost, and never inside a frame.
- **Moderation keys.** Moderators sign with their own CRITICAL key, pasted into `/moderation`. It is wiped on hide, idle, lock and unmount, and is never stored. The owner key is refused off localhost; keep it offline.
- **Content Security Policy.** Each page carries a per-page CSP meta tag with hashed inline scripts and no `unsafe-inline` scripts. `connect-src` stays wide because DAPI nodes are bare IPs, so the hashed `script-src` is the real control. Images may load from any https host, and post images are sent without a referrer.
- **Untrusted content.** Post bodies are Markdown rendered without raw HTML. Links are limited to http(s), mailto and relative paths; external links are `nofollow ugc noopener`.
- **What is public.** Everything on chain is public, including reports and who filed them. Hidden and removed content is excluded from the static index, the sitemap, the feeds and the JSON API.

## License

MIT
