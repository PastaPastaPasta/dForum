# Data model

One contract per deployment (bans/suspensions apply to a single contract; one deployment, one ban surface). Owner-only types: `forumSettings`, `category`, `forum`, `teamMember`. Public types: `thread`, `post`, `reaction`, `report`, `profile`.

## Types and fields (advisor-settled)

### forumSettings — creationRestrictionMode 1, one doc per deployment
| field | type | notes |
|---|---|---|
| key | string, pattern `^[a-z0-9-]{1,16}$` | unique index byKey (app uses "main") |
| name | string ≤80 | |
| tagline | string ≤160 | optional |
| description | string ≤1000 | optional |
| rules | string ≤1000 (maxBytes 8192) | optional, markdown |
| announcement | string ≤500 | optional |
| hideBannedContent | boolean | optional, default false |

### category — creationRestrictionMode 1, canBeDeleted false
| field | type | notes |
|---|---|---|
| slug | string, ^[a-z0-9-]{1,48}$ | unique index bySlug |
| title | string ≤80 | |
| description | string ≤300 | optional |
| sort | integer 0..65535 | index bySort |

### forum — creationRestrictionMode 1, canBeDeleted false
| field | type | notes |
|---|---|---|
| categoryId | identifier, refersTo category permanentDocument, immutable | |
| slug | string, ^[a-z0-9-]{1,48}$ | unique index bySlug |
| title | string ≤80 | |
| description | string ≤500 | optional |
| sort | integer 0..65535 | index byCategory (categoryId, sort) |
| archived | boolean | optional |

### teamMember — creationRestrictionMode 1 (display metadata only, never authority)
| field | type | notes |
|---|---|---|
| memberId | identifier (plain, no refersTo — display metadata) | unique index byMember |
| role | string ≤40 | e.g. "moderator", "owner" |
| sort | integer 0..65535 | |

### thread — public, documentsMutable true, canBeDeleted false, moderator delete (keeps record, keeps forumId) + changeFields
| field | type | notes |
|---|---|---|
| forumId | identifier, refersTo forum permanentDocument, immutable | kept for removal record |
| title | string 3..150 | author-editable |
| tags | typed array, ≤5, ^[a-z0-9-]{1,32}$ | uniqueItems |
| sticky | boolean | changeFields, optional, moderator-only |
| lockedAt | integer (ms) | changeFields, optional, moderator-only |
| modState | integer 1..3 | changeFields, optional, moderator-only (1=hidden) |
| modNote | string ≤200 | changeFields, optional |

### post — public, documentsMutable true, canBeDeleted true, moderator delete (keeps record, keeps threadId+forumId) + changeFields
| field | type | notes |
|---|---|---|
| threadId | identifier, refersTo thread moderatedDocument (where forumId==forumId), immutable | kept for removal record |
| forumId | identifier, refersTo forum permanentDocument, immutable | kept for removal record |
| body | string ≤4000 (maxBytes 5120) | author-editable |
| replyToId | identifier (plain, no refersTo) | optional, not enforced |
| modState | integer 1..3 | changeFields, optional, moderator-only (1=hidden) |
| modNote | string ≤200 | changeFields, optional |

Every message is a `post` including the opening post. The opening post of a thread is the earliest post whose `$ownerId` equals the thread's `$ownerId`, ordered by (`$createdAt`, `$id`) — regardless of its moderation state. A thread is listed only when that opening post exists AND is itself visible (not moderated, and not past the lock). Posts by anyone created before the opening post are dropped for listing (they may exist as pre-opening noise).

"Edited" is `$updatedAt > $createdAt` (not `$revision > 1`): moderator changeFields bumps `$revision` without moving `$updatedAt`.

### reaction — public, documentsMutable false, canBeDeleted true
| field | type | notes |
|---|---|---|
| postId | identifier, refersTo post deletableDocument (where $ownerId==postOwnerId, threadId==threadId) | |
| postOwnerId | identifier | cached; unique index byPostOwner (postId, $ownerId) |
| threadId | identifier | cached |
| kind | integer 1..8 | index byPostKind (postId, kind) countable |

### report — public, documentsMutable false, canBeDeleted true, changeFields [status, resolution]
| field | type | notes |
|---|---|---|
| postId | identifier, refersTo post deletableDocument | |
| threadId | identifier | cached |
| reason | integer 1..8 | |
| note | string ≤280 | optional |
| status | integer 1..3 | changeFields, optional |
| resolution | string ≤200 | changeFields, optional |

### profile — public, documentsMutable true, canBeDeleted true, moderator delete + changeFields [customTitle, modState]
| field | type | notes |
|---|---|---|
| displayName | string ≤40 | index byOwner ($ownerId, unique) |
| bio | string ≤1000 | optional |
| signature | string ≤300 | optional |
| avatarUrl | string ≤300, https pattern | optional |
| website | string ≤200 | optional — no pattern in the registered contract (`string(0,200)`); app-side http(s) check on write/display; `^(https?://\S+)?$` pattern to add at next registration only (indexes are frozen) |
| customTitle | string ≤40 | changeFields, optional |
| modState | integer 1..3 | changeFields, optional (1=hidden) |

## Indices (frozen at creation — do not add later)

| type | index | properties | flags |
|---|---|---|---|
| forumSettings | byKey | key | unique |
| category | bySlug | slug | unique |
| category | bySort | sort | |
| forum | bySlug | slug | unique |
| forum | byCategory | categoryId, sort | |
| teamMember | byMember | memberId | unique |
| thread | byForum | forumId, $createdAt | rangeCountable |
| thread | byForumSticky | forumId, sticky | skipIfAbsent [sticky] |
| thread | byAuthor | $ownerId, $createdAt | rangeCountable |
| thread | recent | $createdAt | |
| thread | byUpdated | $updatedAt | |
| thread | moderated | $moderatedAt | nullSearchable: false |
| thread | byTag | tags, $createdAt | |
| post | byThread | threadId, $createdAt | rangeCountable |
| post | byForum | forumId, $createdAt | rangeCountable |
| post | byAuthor | $ownerId, $createdAt | rangeCountable |
| post | recent | $createdAt | |
| post | byUpdated | $updatedAt | |
| post | moderated | $moderatedAt | nullSearchable: false |
| reaction | byPostOwner | postId, $ownerId | unique |
| reaction | byPostKind | postId, kind | countable |
| reaction | byRecipient | postOwnerId | countable |
| reaction | byThreadOwner | threadId, $ownerId | |
| report | byPostReporter | postId, $ownerId | unique |
| report | recent | $createdAt | |
| profile | byOwner | $ownerId | unique |

documentsCountable: thread, post, reaction, profile.

- Reactions are NOT moderated — they carry no moderation fields, no indexes beyond byPostKind/byRecipient/byThreadOwner, and no deletion of related content. A reaction to a hidden post still counts publicly.
- `byRecipient` / `byThreadOwner` / `byUpdated` / `moderated` (thread+post) are registered but unused by this app (documented in the pending-at-next-registration list). Do not query over them in bulk.
- `byForumSticky` is moderated-only by design: no sticky index exists in the `none` contract (there is no sticky property).

## Moderation semantics (settled 2026-11-26)
- `modState` non-null = hidden (console writes 1; every renderer — client, snapshot, sitemap — treats any non-null modState as hidden: body suppressed, listing suppressed, snapshot-excluded). `banned` never appears on profiles; bans live in the ban list.
- Moderator changeFields on a thread/post bumps `$revision` but NOT `$updatedAt` — display edited badges from `$updatedAt > $createdAt`.
- Locked threads: client ignores posts with `$createdAt > lockedAt`; the snapshot drops posts created after lockedAt (S3: never consensus-enforced).
- Orphan rule: the opening post is the earliest post whose `$ownerId` equals the thread owner, ordered by (`$createdAt`, `$id`) — regardless of that post's moderation state. A thread is listed only when that opening post exists AND is itself visible (not moderated, not past the lock). A hidden opening post means the thread is hidden — shown nowhere (snapshot, sitemap, llms.txt, live listings, thread page). Snapshot and client both apply it.

## Pending at next registration (indexes are frozen in this deployment)
- `thread`/`post`: the `moderated` index (`$moderatedAt`) is registered and available for an audit view, but the moderation console currently scans `recent`/`byForum`/`byAuthor` and filters by `modState` client-side — a server-side moderated-audit listing is a next-registration improvement (query `moderated` only for types where `$moderatedAt` is set — only changeFields writes it). Do not query `moderated` for docs where the field is absent; an empty-set read is fine but an over-broad scan is not.
- `thread`/`post`: `byUpdated` is registered but unused by the app — listing order uses `$createdAt` desc; the profile page reads `byAuthor`. No change this deployment.
- `profile.canBeDeleted`: currently `true` — a moderator-hidden profile would be deletable/reappearable by its owner at the consensus layer. The app pairs profile hide with ban/suspend (soft-hide) today; at next registration set `profile.canBeDeleted: false` + `deleteKeepsFields` so a hidden profile cannot be erased and re-created into a fresh identity.
- `reaction.byPostKind`: in a fresh registration, use `rangeCountable: true` so per-post counts can be served without `kind in [...]` group-by. The current contract uses `countable` — per-post totals need `postId == X, kind in [1..8]` with groupBy [kind] (one request per post); spike before building the reaction UI.
- `profile`: no `moderated` index (`$moderatedAt`) — hidden profiles must be found by full scan; `profile.byOwner` is the only index.
- `report`: no status index (`byStatus`) — the moderation queue scans `recent` and filters client-side; also add `where: { threadId: 'threadId' }` on `report.postId` so the cached threadId is validated.
- `teamMember.canBeDeleted`: `false` today — a former moderator's display row can be edited but never deleted; set `true` at next registration (nothing refers to `teamMember`).
- `website` field: add `^(https?://\S+)?$` pattern (app-side check in the meantime).
- `forumSettings.rules`: `maxBytes: 8192` is a no-op (maxLength 1000 caps the value below the 5120-byte platform cap). In a fresh registration use maxLength 4000 + maxBytes 5120.
- `reaction.byPostKind` and others: nothing here changes this deployment; schema edits require a new contract.

- `$moderatedAt` is set only by `changeFields` (and moderator-applied changes); owner deletes and owner replace do NOT set it. Owner deletions are tracked via `documentRemovals`.

## Invariants

- No running counters on threads (nobody can edit another's document) — count indexes instead.
- No global uniqueness on usernames — DPNS identity; display name is not unique.
- Every post is a post; thread is title/meta only. No edit history (documentsKeepHistory incompatible with moderator delete) — "edited" when `$updatedAt > $createdAt`.
- No thread moves in v1 (forumId immutable, verified against thread by reference).
- No sequence numbers (moderator deletion breaks dense numbering); pagination is a client-side bounded window (threads/forums show the latest N with a truncation note), not server-side page routes yet.
- Opening post = the earliest post whose owner equals the thread owner, ordered by (`$createdAt`, `$id`), regardless of moderation state; the thread is listed iff that opening post exists AND is visible (orphan rule; see Moderation semantics).
- Reports are public on-chain, reporter included (UI says so). Only moderators set status/resolution.
- Body limit: maxLength 4000, maxBytes 5120 (platform hard cap 5120/value).
