# dForum design

Status: draft v1. 2026-11-26. Advisor: opus 5.5 (high effort) — decisions below are the advisor's, recorded so the contract stays coherent. Re-read the advisor thread when changing directions.

## What this is

A greenfield forum on Dash Platform (Dash Evolution). All content, moderation and identity live on the network; the site is a thin static shell over the platform, rebuilt hourly for SEO/AI indexing. Baseline: dash.org/forum (XenForo-style: categories → forums → threads → posts, likes, pins, locks, search, pagination, profiles, member badges, moderation).

## Settled decisions

- **One contract per deployment** (`contracts/dforum.json`, generated): bans and suspensions apply to a single contract, so splitting the data would mean banning everyone in several places.
- **Moderation is the platform's native moderation** (protocol 14): `config.moderation` with `banlist`/`suspensions`/`warnings` + `moderators`.
  - `none`: no moderation block at all — nothing removable/bannable at consensus, ever (frozen at creation).
  - `team` (default): `appointedModerators` — owner + up to 16 named identities, non-elected. The roster is on-chain config, managed by the deployer (contract owner) only, through a contract update.
  - `network`: `elected` (masternode-elected). Not recommended (contradicts "non-elected"; a seated team is permanent since challenges are not shipped) — supported by the generator, testnet-only.
- **Read the mode at runtime** from the fetched contract, never from a settings document.
- **Owner-only types** (creationRestrictionMode 1): forumSettings, category, forum, teamMember. **Public types**: thread, post, reaction, report, profile.
- **Every message is a `post`** — the opening post of a thread is just a post. The thread holds title/forum/tags/editable-meta; threads are listed only when the thread's earliest post belongs to the thread's author (orphan check, free from page-1 fetch). No atomic multi-document write, so create = 2 writes; no stored counters (nobody can edit another's document) — use count indexes.
- **Flat reply chronology** (XenForo-style). Quotes via optional `replyToId` stored as a plain id (no enforced reference).
- **Body limit**: maxLength 4000 / maxBytes 5000 (platform caps a string at 5120 bytes — do not exceed).
- **No edit history** (documentsKeepHistory is incompatible with moderator delete); show "edited" when `$revision` > 1.
- **Deletes**: authors hard-delete their own posts (post hard-delete). Threads can't be deleted; the author can blank the opening post. Moderators delete documents (removal record; keeping just threadId/forumId) or hide (changeFields modState, reversible).
- **Pins/locks are moderator-only fields** (`sticky`, `lockedAt`), set via the moderation transition. Clients ignore posts after `lockedAt`.
- **Reports are public on-chain**, reporter included (say so in UI). Only moderators set status/resolution.
- **No global uniqueness on usernames** — DPNS names; profile display name is not unique.
- **No thread moves in v1** (forumId immutable).
- **Indexes are frozen at creation** — get them right at registration; do not plan to add.
- **Static layer**: canonical routes `/`, `/f/{slug}/[page/N/]`, `/t/{account}/` (members), `/t/{threadId}/[page/N/]` are themselves static HTML (not a separate /index/ tree). Two stages: `scripts/snapshot.mjs` (proved queries) → snapshot dir; `next build` reads only the snapshot (never the network). Snapshot storage: Actions cache/artifact or R2, NOT a git branch (git keeps taken-down content forever). Completeness gate: fetched counts must equal proved counts or the deploy is skipped (last good site keeps serving).
- **Static outputs**: `/data/v1/manifest.json`, `forums.json`, `f/{forumId}/p{n}.json`, `t/{threadId}/p{n}.json` (with page-boundary cursors), sitemap index → ≤50k-URL sitemaps, RSS 2.0 `/feed.xml` + per-forum, `robots.txt`, `llms.txt`, DiscussionForumPosting JSON-LD, footer "snapshot as of". Live layer hydrates post-first-paint via the SDK; posts newer than the snapshot are fetched live.
- **SDK**: `@dashevo/evo-sdk` 5.0.x (forge uses 5.0.0-rc.8); NOT yappr's 3.1.0-dev.8 (too old, no moderation APIs).
- **Slugs, not ids, for URLs.** The thread id (`$id`) is the canonical key; slugs are derived for humans and kept unique per forum.
- **Security**: strict markdown (no raw HTML), `rel="ugc nofollow noopener"` on links, remote images load only on click.
- **Costs**: writes cost the author credits — onboarding needs a funded identity; probe the fee with the chosen indexes before launch (spike S8).

## Spikes (before testnet registration — see docs/design/spikes.md)

S1 moderator signing path (CRITICAL unbound key vs App Connect session key).
S2 changeFields property in a skip-if-absent index (thread.byForumSticky).
S3 network-enforced thread lock via post `where` on moderator-written field.
S4 reference `where` with two keys (reaction: post owner + thread).
S5 groupBy count with `in` on rangeCountable via evo-sdk 5.0.x.
S6 platform-auth (App Connect v2) works with evo-sdk 5.0.x; session key bounds.
S7 confirm testnet version/protocol 14 live at registration time.
S8 write-fee probe per post with chosen indexes.
