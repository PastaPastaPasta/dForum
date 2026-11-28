# Data model (contract v4)

The schema lives in `contracts/build.mjs`. CI regenerates `contracts/generated/dforum.{none,team,network}.json`, diffs them against the committed files, and validates them with `DataContract.fromJSON(json, true, <protocol>)`. The live testnet registration is recorded in `contracts/deployments/testnet.json`.

## Types

Positions follow declaration order. `?` marks an optional field. *mod* marks a moderator-only field (`moderatorAbilities.changeFields`): an author can never set it, and an author replace must carry it unchanged.

| type | who creates | mutable / deletable | fields |
| --- | --- | --- | --- |
| forumSettings | owner | yes / no | key (`main`), name, tagline?, description?, rules? (≤4000 chars, ≤5120 bytes), announcement?, archiveOwnerId? (identifier), archiveTrustUntil? (ms), archiveSourceName?, archiveSourceUrl? (https) |
| category | owner | yes / no | slug (immutable, unique), title, description?, sort |
| forum | owner | yes / no | categoryId (identifier), parentForumId? (identifier), slug (immutable, unique), title, description?, sort, archived?, origId? |
| teamMember | owner | yes / yes | memberId (unique), role, sort. Display metadata only; authority comes from the contract roster |
| thread | anyone | yes / moderator delete keeps forumId | forumId (refersTo forum where `archived` is not true; immutable), title (3–150), tags? (≤5, `^[a-z0-9-]{1,32}$`), origId?, origAuthor?, origAuthorId?, origCreatedAt?, sticky? *mod*, locked? *mod*, modState? *mod*, modNote? *mod*, movedToForumId? *mod*, modFlags? *mod* |
| post | anyone | yes / moderator delete keeps threadId and forumId | threadId (refersTo thread where forumId matches and `locked` is not true; immutable), forumId (refersTo forum where `archived` is not true; immutable), body (≤5120 bytes), body2? (≤5120 bytes), replyToId? (refersTo post in the same thread; immutable), retracted?, origId?, origAuthor?, origAuthorId?, origCreatedAt?, modState? *mod*, modNote? *mod*, modFlags? *mod* |
| reaction | anyone | yes / no | postId (refersTo post where $ownerId = postOwnerId and threadId matches), postOwnerId (≠ $ownerId), threadId (refersTo thread where `locked` is not true), all immutable; kind (0 = cleared, 1–63) |
| report | anyone | no / moderator delete only | postId (refersTo post where threadId matches), threadId, reason (1–8), note? (≤280), status? *mod* (2 actioned, 3 dismissed), resolution? *mod* |
| profile | anyone (one per identity) | yes / moderator delete only | displayName (no control or bidi characters), bio?, signature?, avatarUrl? (https), website? (http/https), location?, customTitle? *mod*, modState? *mod*, modFlags? *mod* |

`refersTo` kinds are checked by `validateReferences` in the builder. `post` is a `moderatedDocument` in moderated modes and a `permanentDocument` in `none` mode.

## Indexes

| type | index | properties | flags |
| --- | --- | --- | --- |
| forumSettings | byKey | key | unique |
| category | bySlug | slug | unique |
| category | bySort | sort |  |
| forum | bySlug | slug | unique |
| forum | byCategory | categoryId, sort |  |
| teamMember | byMember | memberId | unique |
| thread | byForum | forumId, $createdAt |  |
| thread | byAuthor | $ownerId, $createdAt |  |
| thread | byUpdated | $updatedAt |  |
| thread | byOrigin | $ownerId, origId | unique; skipIfAbsent origId |
| thread | moderated | $moderatedAt | nullSearchable false |
| post | byThread | threadId, $createdAt |  |
| post | byAuthor | $ownerId, $createdAt |  |
| post | byUpdated | $updatedAt |  |
| post | byOrigin | $ownerId, origId | unique; skipIfAbsent origId |
| post | moderated | $moderatedAt | nullSearchable false |
| reaction | byPostOwner | postId, $ownerId | unique |
| reaction | byThread | threadId, $createdAt |  |
| reaction | byRecipient | postOwnerId, $updatedAt |  |
| reaction | byUpdated | $updatedAt |  |
| report | byPostReporter | postId, $ownerId | unique |
| report | recent | $createdAt |  |
| report | moderated | $moderatedAt | nullSearchable false |
| profile | byOwner | $ownerId | unique |
| profile | byUpdated | $updatedAt |  |
| profile | moderated | $moderatedAt | nullSearchable false |

Why each index exists:

- **byUpdated** (thread, post, reaction, profile) and **moderated** (`$moderatedAt`; thread, post, report, profile): drive the incremental snapshot, the browser's live overlay and the moderation audit log. A moderator change bumps `$revision` and `$moderatedAt` but not `$updatedAt`, so both are needed.
- **byForum**, **byThread**, **byAuthor**: listings, alerts and live fallbacks. No index is countable: counts come from the snapshot, which reads every document anyway.
- **byOrigin** (`$ownerId`, origId; unique, skipIfAbsent): the importer's idempotency. Document ids include the create nonce, so a retried create would otherwise duplicate. Live documents have no origId and are skipped.
- **reaction.byThread**: one paged query loads a thread's reactions. **byRecipient** (`postOwnerId`, `$updatedAt`) feeds alerts, including changed reactions.
- **report.recent**: the moderation queue. **byPostReporter** (unique): one report per member per post.

v3 dropped indexes that only the snapshot could answer more cheaply: `recent` on thread and post, `byTag`, `byForumSticky`, `byMovedTo`, `post.byForum`, `post.byOrigAuthor`, and every `countable` flag. Each index entry is paid on every create, so a live post now writes three index entries instead of five.

## Consensus rules (v4)

- **Locked threads** refuse replies on chain: `post.threadId` refers to a thread whose `locked` is not `true`. A `threadOpen` rule (`referenced: ['threadId', 'locked']`) makes every post and reaction create *and edit* read the thread, so a lock also freezes existing posts and reaction toggles; a locked thread's `title` and `tags` are conditionally immutable (`when: $old.locked = 1`). Moderators lock with `changeFields { locked: true }` and unlock by clearing it. A moderator-deleted thread keeps `locked` (`deleteKeepsFields`).
- **Archive provenance is immutable:** `origId`, `origAuthor`, `origAuthorId` and `origCreatedAt` can't change after creation, and `origId` survives a moderator delete.
- **No self-reactions:** `reaction.postOwnerId` must differ from `$ownerId`.
- **Display names** may not contain control, zero-width or bidi-override characters.
- **Archived forums** refuse new threads and posts on chain: `thread.forumId` and `post.forumId` refer to a forum whose `archived` is not `true`. The importer therefore loads before it archives.
- `notEqual: { const: true }` also holds when the field is absent, so documents without the field are open.

## Reader rules (lib/forum/model.ts)

Readers are the snapshot, the build and the browser. They all use the same functions.

- **Trust:** `orig*` fields count only on documents owned by `forumSettings.archiveOwnerId` and, when `archiveTrustUntil` is set, both created and last edited on chain before it. The effective date is `origCreatedAt` (ms) for those documents and `$createdAt` otherwise. Changing `archiveOwnerId` later withdraws trust from every existing archive document, by design. Archived forums refuse new threads and posts at consensus; what was written before a forum was archived stays listed.
- **Opening post:** the owner's earliest post by effective date, then `$createdAt`, then `$id` bytes. A thread is listed when that post exists, is not hidden and is not retracted, and the thread itself is not hidden.
- **Hidden** means `modState` is set. Hidden posts stay in the thread as placeholders, so numbering and permalinks are stable. Hidden threads and profiles drop out of every listing, page and feed.
- **Locked** means `locked` is `true`. Consensus refuses new replies (above); the app also closes the composer, edits and reactions.
- **Moved:** a thread's forum is `movedToForumId` when set, otherwise `forumId`.
- **Edited** means `$updatedAt > $createdAt`. A moderator change does not mark a post edited.
- **Sub-forums:** a parent is honored only if it exists, is in the same category and forms no cycle.

## Costs (testnet, measured)

| write | DASH |
| --- | --- |
| contract v4 registration | 0.848 |
| thread | about 0.0017 |
| post, reply or import | about 0.0015 |
| reaction or profile | about 0.001 |

An import averages 0.0015 DASH per document. A full dash.org/forum backfill (about 18k threads and 180k posts) would cost roughly 300 DASH on mainnet; see importer.md.
