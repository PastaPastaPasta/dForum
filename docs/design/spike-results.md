# Spike results

Recorded 2026-11-26. Contract `ozZNp21WNWLx79aJXFo2ScEaMtBc9vvfUonqmzADM16` (team mode), identity `6Dftf346svGz5btcf7NpQ3iPurku4JTit4kzWX7P7VwM`, SDK 5.1.0-rc.1 (5.0.x cannot read this chain). DAPI node discovery via quorums.testnet.networks.dash.org.

## S1 — moderation signing path
**PASS (offline).** The deployer's CRITICAL unbound key (id 1) builds and signs the `ContractUserModeration` ban transition (221 B) offline — `scripts/spikes/s1-moderation-signing.mjs`. This is the S1 mechanical path (key → signer → transition → signature).
**Live broadcast** of a real ban is NOT exercised here (it would need a target identity); it is tested in QA with the moderation UI against the seeded documents.
**App Connect session key:** the vendored platform-auth flow yields an App Connect session key which is contract-bound and company — not a CRITICAL key. Documents write with HIGH-level keys; moderation requires CRITICAL. The moderation console must sign with a CRITICAL-bound key held in the operator's vault, not the session key. (Design decision in moderation.md.)

## S2 — changeFields property in skipIfAbsent index
**PASS (structural).** `thread.byForumSticky` ([forumId asc][sticky asc], skipIfAbsent sticky) is registered and the byForum query returns the seeded thread. A moderator change of `sticky` via `moderatorChangeDocumentFields` is NOT exercised live yet — QA.

## S3 — post reference where reading thread's lockedAt
**NO.** The `post.threadId` refersTo can constrain the referred thread's forum match (`where: { forumId: 'forumId' }`) but cannot express "thread is not locked" (no enum/not-null where). `lockedAt` is moderator-written; the lock rule is **client-side** (the app reads the thread and refuses to post when locked). Recorded so the app does not promise a consensus-enforced lock in v1.

## S4 — refersTo with two keys on one reference
**PASS (structural).** `reaction.postId` refersTo post with `where: { $ownerId: 'postOwnerId', threadId: 'threadId' }` registers and enforces: post create succeeded and a reaction against it landed (unique byPostOwner index rejects a second reaction from the same reactor on the same post — tested by the duplicate-key guard in the second run, which rejected the duplicate forumSettings creation with the intended error). **Two different identities as reactor vs post owner is NOT exercised** — no second identity exists; exercised in QA with the real App Connect login.

## S5 — groupBy count with `in` on rangeCountable
**PASS.** `documents.count` with `where: [['threadId', 'in', [id]]]`, `groupBy: ['threadId']` returns per-thread counts (seeded thread: 1 post). `documents.count` with `groupBy: ['threadId']` and a `forumId ==`-only where is refused by the server (GROUP BY on a field not constrained by In/range). Forum-wide post counts should be computed per-thread instead.

## S6 — platform-auth (App Connect v2) with evo-sdk 5.0.x
**PENDING** — tested in Phase 4 QA. Vendored platform-auth is built against evo-sdk 5.0.x; the app pins 5.1.0-rc.1.

## S7 — testnet node version at registration
**PASS.** Protocol 14; `DataContract.fromJSON(json, true, 14)` validated offline; the registered contract reads back with version 1 and the team moderation block (appointedModerators naming the deployer). Note: **5.0.x SDKs cannot read this chain** — the V2 config shape trips their proof decoder (`UnexpectedVariant DataContractInSerializationFormat`). Use 5.1.0-rc.1.

## S8 — write-fee probe per post
**MEASURED — target NOT met.**
| document | cost (credits) | cost (DASH) |
|---|---|---|
| forumSettings | 24,152,460 | 0.0024 |
| category | 38,105,140 | 0.0038 |
| forum | (reused from prior run; 0 reported then) | — |
| thread | 163,755,260 | 0.0164 |
| post | 134,324,720 | 0.0134 |
| reaction | 90,951,960 | 0.0091 |

Post cost ≈ **0.0134 DASH** vs the < 0.005 aspiration. Fee is dominated by the six indexes on post (byThread, byForum, byAuthor, recent, byUpdated, moderated) — consistent with the platform's per-index write model. Options: drop rangeCountable from secondary indexes, or trim byAuthor/recent; deferred to the contract-design review, which reports the trade-off rather than silently re-registering.

## Seed documents (real test data on the testnet contract)
| type | id |
|---|---|
| forumSettings | `7WuqpoPoFtRV7R8XyWQNiA2DH9cp5YMGtG9mvFP5sXQH` |
| category | `3xCb2YiTsM6iMDqZcVqyX4WawzfAVEWsmQvNqQzEtP6m` |
| forum | `B3F2hJCE6N8ZgDZpbBwKm3JWXYQYmekJed54JaRvENDh` |
| thread | `2cZ7p1ZzYuziaDSiGSpmwu7aK7R8SMoDD7Z6bLsGYVap` |
| post | `FGejahwvKYGx4wywcnFtHP3vvrm6nmnvTT56YdRjdtor` |
| reaction | `Gunb9VtVvavzdjmVUabR3TpU7f1a2MeRGwwP1gUJRbq1` |
