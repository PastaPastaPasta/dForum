# Spike results

Recorded 2026-11-26. Contract `ozZNp21WNWLx79aJXFo2ScEaMtBc9vvfUonqmzADM16` (team mode), identity `6Dftf346svGz5btcf7NpQ3iPurku4JTit4kzWX7P7VwM`, SDK 5.1.0-rc.1 (5.0.x cannot read this chain). DAPI node discovery via quorums.testnet.networks.dash.org.

## S1 — moderation signing path
**PASS (offline).** The deployer's CRITICAL unbound key (id 1) builds and signs the `ContractUserModeration` ban transition (221 B) offline — `scripts/spikes/s1-moderation-signing.mjs`. This is the S1 mechanical path (key → signer → transition → signature).
**Live broadcast** of a real ban is NOT exercised here (it would need a target identity); it is tested in QA with the moderation UI against the seeded documents.
**App Connect session key:** the vendored platform-auth flow yields a HIGH-level App Connect session key — (2026-11-27, superseding the 5.0.x note) now contract-bound (singleContract → dForum's contract, ~0.5 DASH budget, 90-day expiry), never a CRITICAL key. Documents write with HIGH-level keys; writes go through a batch (a bound key signs batches only, 20013 otherwise). Moderation requires CRITICAL. The moderation console must sign with an identity-level CRITICAL key held in the operator's vault, not the session key. (Design decision in moderation.md.)

## S2 — changeFields property in skipIfAbsent index
**PASS (structural).** `thread.byForumSticky` ([forumId asc][sticky asc], skipIfAbsent sticky) is registered. A moderator change of `sticky` via `moderatorChangeDocumentFields` is NOT exercised live yet — QA. **What was actually verified:** the plain `byForum` query returns the seeded thread (a moderated test-thread flip of `sticky` has NOT been exercised). The doc previously claimed byForumSticky was exercised — it was not.

## S3 — post reference where reading thread's lockedAt
**NO.** The `post.threadId` refersTo can constrain the referred thread's forum match (`where: { forumId: 'forumId' }`) but cannot express "thread is not locked" (no enum/not-null where). `lockedAt` is moderator-written; the lock rule is **client-side** (the app reads the thread and refuses to post when locked). Recorded so the app does not promise a consensus-enforced lock in v1.

## S4 — refersTo with two keys on one reference
**PASS (structural).** `reaction.postId` refersTo post with `where: { $ownerId: 'postOwnerId', threadId: 'threadId' }` registers, and a reaction against a test post landed (one on the seeded contract). **The unique `byPostOwner` index rejection is NOT exercised live** — the claim here earlier cited a duplicate forumSettings creation rejecting, which says nothing about the reaction index. **Two different identities as reactor vs post owner is NOT exercised** — no second identity exists; exercised in QA with the real App Connect login.

## S5 — groupBy count with `in` on rangeCountable
**PASS.** `documents.count` with `where: [['threadId', 'in', [id]]]`, `groupBy: ['threadId']` returns per-thread counts (seeded thread: 1 post). `documents.count` with `groupBy: ['threadId']` and a `forumId ==`-only where is refused by the server (GROUP BY on a field not constrained by In/range). Forum-wide post counts should be computed per-thread instead.

## S6 — platform-auth (App Connect v2) with evo-sdk 5.0.x
**IMPLEMENTED, E2E UNVERIFIED.** The vendored platform-auth client is wired into the app (login flow via `PlatformAuthController` + `useAppConnectLogin` — App Connect v2, `features: { keyExchangeLogin: false }` so the legacy dash-key path cannot fire, everything else disabled). The app pins evo-sdk 5.1.0-rc.1; the vendored client was built against 5.0.x, so the socket + SDK interop needs the manual QR-scan pass against a real wallet before launch. Do not call login "proven" until that run happens.

## S7 — testnet node version at registration
**PASS.** Protocol 14; `DataContract.fromJSON(json, true, 14)` validated offline; the registered contract reads back with version 1 and the team moderation block (appointedModerators naming the deployer). Note: **5.0.x SDKs cannot read this chain** — the V2 config shape trips their proof decoder (`UnexpectedVariant DataContractInSerializationFormat`). Use 5.1.0-rc.1.

## S8 — write-fee probe per post
**MEASURED — target MET (credits ÷ 1e11 = DASH).** (Corrected 2026-11-26: the original table divided by 1e10 and reported a ~10x miss that never existed.)
| document | cost (credits) | cost (DASH) |
|---|---|---|
| forumSettings | 24,152,460 | 0.00024 |
| category | 38,105,140 | 0.00038 |
| thread | 163,755,260 | 0.00164 |
| post | 134,324,720 | 0.00134 |
| reaction | 90,951,960 | 0.00091 |

All five document types land well under the 0.005 DASH aspiration (post 0.00134, thread 0.00164). A post create writes five index entries (byThread, byForum, byAuthor, recent, byUpdated) — `moderated` is skipped because $moderatedAt is absent at create. A thread create writes four plus one byTag entry per tag (byForum, byAuthor, recent, byUpdated). Fee follows the platform's per-index write model. No re-registration needed. Fee target (< 0.005 DASH) verified across the board.

**S8 probe — DONE (2026-11-26).** One live ~2 KB body post (1,898 bytes, 1,896 chars) on the seeded contract: 151,910,540 credits = **0.00152 DASH** (7229 ms). Body length does not materially move the fee — the per-index write model (5 entries at create) dominates as expected. Fee target (< 0.005 DASH per write) is met across the board. The probe post exists on the testnet seed thread (id `DeiHv4nj1cui6NTGbuumcWN7AWUWMzP6cLFRm5GLRy6r`, body starts "S8 body probe — "). **It must not be deleted** — it is the fee evidence for posting; leave it live. Documented here so a later cleanup pass does not remove it.

## Seed documents (real test data on the testnet contract)
| type | id |
|---|---|
| forumSettings | `7WuqpoPoFtRV7R8XyWQNiA2DH9cp5YMGtG9mvFP5sXQH` |
| category | `3xCb2YiTsM6iMDqZcVqyX4WawzfAVEWsmQvNqQzEtP6m` |
| forum | `B3F2hJCE6N8ZgDZpbBwKm3JWXYQYmekJed54JaRvENDh` |
| thread | `2cZ7p1ZzYuziaDSiGSpmwu7aK7R8SMoDD7Z6bLsGYVap` |
| post | `FGejahwvKYGx4wywcnFtHP3vvrm6nmnvTT56YdRjdtor` |
| post (S8 probe) | `DeiHv4nj1cui6NTGbuumcWN7AWUWMzP6cLFRm5GLRy6r` — keep; fee-probe evidence, do not delete |
| reaction | `Gunb9VtVvavzdjmVUabR3TpU7f1a2MeRGwwP1gUJRbq1` |
