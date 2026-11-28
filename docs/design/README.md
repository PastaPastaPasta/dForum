# dForum design (v4)

Status as of 2026-11-28. Contract v4 is live on testnet as `xYdwEvUCcKiPfhZMpjvUptReYR34DDgGNP9Ti4AFtHq`; v3 (`9e34…LoWC`), v2 (`85NE…KDEX`) and v1 (`ozZN…ADM16`) are retired. The decisions below were reviewed with the Opus design advisor.

dForum is a forum whose content, identities and moderation all live on Dash Platform. The site is a static index rebuilt from the chain every hour, with a live layer in the browser. Its baseline is dash.org/forum (XenForo 2): categories, forums, sub-forums, threads, posts, likes, pins, locks, moves, search, profiles, member lists, alerts, moderation and RSS.

| Document | What it covers |
| --- | --- |
| [data-model.md](data-model.md) | Document types, fields, indexes, and the visibility rules every reader applies |
| [moderation.md](moderation.md) | Moderation modes, the roster, what moderators can do, and how the console holds keys |
| [static-index.md](static-index.md) | The incremental snapshot, static routes, the live overlay, search, feeds and the static API |
| [importer.md](importer.md) | Backfilling dash.org/forum (XenForo) through an archivist identity |
| [parity.md](parity.md) | Feature comparison with dash.org/forum |
| [testing.md](testing.md) | Unit tests and the testnet end-to-end scenario |
| [spike-results.md](spike-results.md) | v1 protocol spikes (history) |

## Settled decisions

- **One contract per deployment.** Bans and suspensions are per contract.
- **Native platform moderation.** The default is team mode: appointed moderators, managed by the owner through a contract update. The mode is read from the live contract, never from a document.
- **Owner-only types**: forumSettings, category, forum, teamMember. **Public types**: thread, post, reaction, report, profile.
- **Every message is a post.** A thread is listed only when its opening post exists, is visible and has not been retracted. The opening post is the owner's earliest post by effective date, ties broken by `$id` bytes.
- **Posts are never author-deleted.** "Delete" replaces the body with a tombstone (`retracted: true`), so the change moves `$updatedAt` and every incremental reader sees it. Moderators hide posts (reversible) or delete them (kept as a removal record).
- **Two-part bodies.** `body` plus `body2`, each at most 5120 bytes (the platform's per-value cap), about 10 KB in total.
- **Reactions are toggles.** There is one row per post and reactor; un-reacting replaces `kind` with 0, which keeps deltas visible.
- **Archive provenance.** The `orig*` fields are trusted only on documents owned by `forumSettings.archiveOwnerId`. That archivist identity must not be the owner or a moderator, so moderators can still take archive content down.
- **Static first, live second.** The build reads only the snapshot. In the browser, global "changed since the snapshot" queries update every page.
- **SDK:** `@dashevo/evo-sdk` 5.1.0-rc.1, pinned. Writes build documents with `Document.fromObject`, with identifiers as raw bytes; contract-bound keys sign batched transitions only.
