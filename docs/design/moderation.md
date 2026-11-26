# Moderation

Native Dash Platform contract moderation (protocol 14), per contract. Deployer picks the mode; read it at runtime from the fetched contract, never from a document.

## Modes (contracts/build.mjs `--moderation`)

| mode | `config.moderation` |
|---|---|
| none | no `moderation` block (frozen: nothing removable or bannable at consensus, ever) |
| team (default) | `{banlist: true, suspensions: true, warnings: true, moderators: {$type: "appointedModerators", identities: [...]}}` |
| network | `{banlist: true, suspensions: true, warnings: true, moderators: {$type: "elected", ...}}` (generator-supported, testnet only) |

- `team` mode is the brief's primary mode: centralized ownership + team-based non-elected moderation.
- Roster lives in the on-chain contract config (up to 16 named identities, owner always moderates) — managed by the deployer (contract owner) only, via contract update. Moderators cannot add moderators (consensus makes this the only option anyway).
- `teamMember` documents hold display metadata (role label, order) only, never authority. Badge shown only if identity is owner or in the config's moderator roster.
- `network` mode contradicts "non-elected" and (in protocol 14, guest: no challenges shipped) leaves a seated team permanent while the deployer loses moderation. Generator supports it for testnet; do not use for forum.dashhq.org.

## What moderation can do (team mode)

- ban/unban (banlist) — content from banned identities stops being written to the contract.
- suspend/unsuspend (suspensions) — until a block time.
- warn/clearWarnings (warnings).
- delete a document (thread/post/profile) — removal record kept, optionally restorable; `deleteKeepsFields` [forumId] (thread), [threadId, forumId] (post).
- change fields (changeFields): `sticky`, `lockedAt`, `modState`, `modNote` (thread); `modState`, `modNote` (post); `status`, `resolution` (report); `customTitle`, `modState` (profile).
- Moderator-only fields are never set by the author (create refuses: 41124) and never listed in a unique index, nor referenced by another property.

## Signing (spike S1 — do not skip)

Moderation transitions need a CRITICAL authentication key WITHOUT contract bounds ("not there yet" for contract-bound moderation keys). The App Connect session key probably cannot sign them, so moderators sign through their wallet (dash-st:/dsa pattern) or a moderator console. Until S1 proves what works, the moderation UI must offer "sign with your wallet" as the primary path and show the CRITICAL-key requirement.

## Behavior rules

- Hidden content (modState non-null = 1=hidden): snapshot drops the document entirely (not listed, not prerendered); the client suppresses bodies and listings and badges it "hidden". Console writes 1 for hide; any non-null value is treated as hidden everywhere.
- `banned` is never written on profiles — bans live in the ban list (moderation config), not in profile modState.
- Deleted docs: removal record kept (restore within a week); stores just threadId/forumId.
- Locked threads (lockedAt set): clients ignore posts with $createdAt > lockedAt; the snapshot drops those posts from the static index and the thread is listed too (URL still renders live). The network never enforces the lock (S3).
- Reports are public on-chain, reporter included (UI says so).
- Moderation semantics (settled 2026-11-26): every render path (client, snapshot, sitemap) treats a non-null modState as hidden. Snapshot exclusion happens at both thread and post level; orphan-filtered threads are also excluded from the static index.
