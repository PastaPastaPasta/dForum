# Spikes (before testnet registration — do not skip)

Read the contract out of the running testnet after registration and before the app's contract id is wired in. Record outcomes in docs/design/spike-results.md.

- **S1** Moderator signing path: does a CRITICAL unbound key sign moderation transitions via evo-sdk 5.0.x; can the App Connect session key? (Determine what the moderator console signs with.)
- **S2** A `changeFields` property in a `skipIfAbsent` index (thread.byForumSticky, skipIfAbsent [sticky]) registers and indexes.
- **S3** Can a post reference's `where` read a thread's moderator-written `lockedAt` at the network level (else client-side lock rule only)?
- **S4** `refersTo.where` with two keys on one reference (reaction: post $ownerId + threadId); post thread `where` forumId. Registers and enforces.
- **S5** groupBy count with `in` on rangeCountable via evo-sdk 5.0.x (forge says yes). Used for reply counts, forum counts, user post counts.
- **S6** platform-auth (App Connect v2) works with evo-sdk 5.0.x; which key level/bounds the session key has (session key is contract-bound; is it too, for the app?).
- **S7** Confirm testnet node version (protocol 14, e.g. 5.0.3) is live at registration time.
- **S8** Write-fee probe per post with the chosen indexes (target: a post create < 0.005 DASH).

Record results: date, evo-sdk version, DAPI node, outcome.
