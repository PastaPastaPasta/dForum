# Data model (contract v2)

The schema lives in `contracts/build.mjs`. CI regenerates `contracts/generated/dforum.{none,team,network}.json`, diffs them against the committed files, and validates them with `DataContract.fromJSON(json, true, <protocol>)`. The live testnet registration is recorded in `contracts/deployments/testnet.json`.

## Types

Positions follow declaration order. `?` marks an optional field. *mod* marks a moderator-only field (`moderatorAbilities.changeFields`): an author can never set it, and an author replace must carry it unchanged.

| type | who creates | mutable / deletable | fields |
| --- | --- | --- | --- |
| forumSettings | owner | yes / no | key (`main`), name, tagline?, description?, rules? (≤4000 chars, ≤5120 bytes), announcement?, archiveOwnerId? (identifier), archiveSourceName?, archiveSourceUrl? (https) |
| category | owner | yes / no | slug (immutable, unique), title, description?, sort |
| forum | owner | yes / no | categoryId (identifier), parentForumId? (identifier), slug (immutable, unique), title, description?, sort, archived?, origId? |
| teamMember | owner | yes / yes | memberId (unique), role, sort. Display metadata only; authority comes from the contract roster |
| thread | anyone | yes / moderator delete keeps forumId | forumId (refersTo forum, immutable), title (3–150), tags? (≤5, `^[a-z0-9-]{1,32}$`), origId?, origAuthor?, origAuthorId?, origCreatedAt?, sticky? *mod*, lockedAt? *mod*, modState? *mod*, modNote? *mod*, movedToForumId? *mod*, modFlags? *mod* |
| post | anyone | yes / moderator delete keeps threadId and forumId | threadId (refersTo thread where forumId matches, immutable), forumId (refersTo forum, immutable), body (≤5120 bytes), body2? (≤5120 bytes), replyToId?, retracted?, origId?, origAuthor?, origAuthorId?, origCreatedAt?, modState? *mod*, modNote? *mod* |
| reaction | anyone | yes / no | postId (refersTo post where $ownerId = postOwnerId and threadId matches), postOwnerId, threadId (all immutable), kind (0 = cleared, 1–8) |
| report | anyone | no / reporter may withdraw | postId (refersTo post where threadId matches), threadId, reason (1–8), note? (≤280), status? *mod* (2 actioned, 3 dismissed), resolution? *mod* |
| profile | anyone (one per identity) | yes / moderator delete only | displayName, bio?, signature?, avatarUrl? (https), website? (http/https), location?, customTitle? *mod*, modState? *mod* |

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
| thread | byForum | forumId, $createdAt | rangeCountable |
| thread | byAuthor | $ownerId, $createdAt |  |
| thread | recent | $createdAt |  |
| thread | byUpdated | $updatedAt |  |
| thread | byTag | tags, $createdAt |  |
| thread | byOrigin | $ownerId, origId | unique; skipIfAbsent origId |
| thread | byForumSticky | forumId, sticky | skipIfAbsent sticky |
| thread | byMovedTo | movedToForumId, $createdAt | skipIfAbsent movedToForumId |
| thread | moderated | $moderatedAt | nullSearchable false |
| post | byThread | threadId, $createdAt | rangeCountable |
| post | byForum | forumId, $createdAt | rangeCountable |
| post | byAuthor | $ownerId, $createdAt | rangeCountable |
| post | recent | $createdAt |  |
| post | byUpdated | $updatedAt |  |
| post | byOrigin | $ownerId, origId | unique; skipIfAbsent origId |
| post | byOrigAuthor | $ownerId, origAuthorId, $createdAt | skipIfAbsent origAuthorId |
| post | moderated | $moderatedAt | nullSearchable false |
| reaction | byPostOwner | postId, $ownerId | unique |
| reaction | byThread | threadId, $createdAt |  |
| reaction | byRecipient | postOwnerId, $createdAt |  |
| reaction | byUpdated | $updatedAt |  |
| report | byPostReporter | postId, $ownerId | unique |
| report | recent | $createdAt |  |
| profile | byOwner | $ownerId | unique |
| profile | byUpdated | $updatedAt |  |
| profile | moderated | $moderatedAt | nullSearchable false |

Why each index exists:

- **byUpdated** (thread, post, reaction, profile) and **moderated** (`$moderatedAt`; thread, post, profile): drive the incremental snapshot and the browser's live overlay. A moderator change bumps `$revision` and `$moderatedAt` but not `$updatedAt`, so both are needed.
- **byForum**, **byThread**, **byAuthor**: listings and live fallbacks. They are range-countable where a count is read.
- **byOrigin** (`$ownerId`, origId; unique, skipIfAbsent): the importer's idempotency. Document ids include the create nonce, so a retried create would otherwise duplicate. Live documents have no origId and are skipped.
- **byOrigAuthor**: archive member pages. Only archive posts pay for it.
- **byMovedTo**: threads a moderator moved into a forum.
- **reaction.byThread**: one paged query loads a thread's reactions. **byRecipient** feeds alerts.
- **report.recent**: the moderation queue. **byPostReporter** (unique): one report per member per post.

## Reader rules (lib/forum/model.ts)

Readers are the snapshot, the build and the browser. They all use the same functions.

- **Trust:** `orig*` fields count only on documents owned by `forumSettings.archiveOwnerId`. The effective date is `origCreatedAt` (ms) for those documents and `$createdAt` otherwise. Changing `archiveOwnerId` later withdraws trust from every existing archive document, by design.
- **Opening post:** the owner's earliest post by effective date, then `$createdAt`, then `$id` bytes. A thread is listed when that post exists, is not hidden and is not retracted, and the thread itself is not hidden.
- **Hidden** means `modState` is set. Hidden posts stay in the thread as placeholders, so numbering and permalinks are stable. Hidden threads and profiles drop out of every listing, page and feed.
- **Locked** means `lockedAt` is set. Posts created on chain after it are ignored. The chain cannot enforce a lock (spike S3), so the app refuses replies and readers drop late posts.
- **Moved:** a thread's forum is `movedToForumId` when set, otherwise `forumId`.
- **Edited** means `$updatedAt > $createdAt`. A moderator change does not mark a post edited.
- **Sub-forums:** a parent is honored only if it exists, is in the same category and forms no cycle.

## Costs (testnet, measured)

| write | DASH |
| --- | --- |
| contract v2 registration (9.2 KB) | 0.908 |
| thread | about 0.0017 |
| post, reply or import | about 0.0015 |
| reaction or profile | about 0.001 |

An import averages 0.0015 DASH per document. A full dash.org/forum backfill (about 18k threads and 180k posts) would cost roughly 300 DASH on mainnet; see importer.md.
