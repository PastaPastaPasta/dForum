# Moderation

## Modes (`node contracts/build.mjs --moderation …`)

| mode | `config.moderation` | use |
| --- | --- | --- |
| `team` (default) | banlist, suspensions, warnings, `appointedModerators` | Centralized ownership, non-elected team. This is what forum.dashhq.org runs. |
| `none` | absent | Nothing can be removed or banned at consensus, ever. Posts become permanent documents. |
| `network` | `elected` with an interim appointed set | Masternode-elected moderators. Testnet only: a seated team cannot be challenged in protocol 14. |

The app reads the mode and roster from the live contract (`getRoster`), never from a document.

## Roster

The owner sets the appointed moderators with a contract update:

```bash
node scripts/set-moderators.mjs --add <identityId> [--remove <identityId>]
```

This signs with the owner's CRITICAL key (`DFORUM_OWNER_WIF` and `DFORUM_OWNER_KEY_ID`; testnet derives it from the deployer seed). The owner always stays on the roster, and the roster holds at most 16 identities. `teamMember` documents only label people (role, order) on the rules and members pages. A badge appears only when the identity is actually on the roster.

## What moderators can do

| action | how | effect |
| --- | --- | --- |
| Hide / unhide a thread, post or profile | changeFields `modState` | Hidden everywhere; the post keeps a placeholder. Reversible. |
| Pin / unpin a thread | changeFields `sticky` | Sorted first in its forum |
| Lock / unlock a thread | changeFields `lockedAt` | The composer closes; later posts are ignored by every reader |
| Move a thread | changeFields `movedToForumId` | Listed in the new forum |
| Delete | `moderatorDeleteDocument` | Removed, leaving a removal record (thread keeps forumId; post keeps threadId and forumId). The console recommends hiding instead. |
| Resolve a report | changeFields `status` (2 actioned, 3 dismissed) + `resolution` | Leaves the open queue |
| Ban / unban, suspend / unsuspend, warn / clear warnings | contract moderation lists | The network refuses writes from banned or suspended identities (consensus 41107) |
| Custom member title | changeFields `customTitle` on the profile | Shown on posts and the profile |

The network refuses moderation of documents owned by the moderator, the owner or other moderators (41102). The archivist identity therefore must not be on the roster.

## Console (`/moderation`) and CLI

- The console runs only on the canonical host or localhost, never inside a frame (JS frame-buster), and is not indexed.
- The moderator pastes their own CRITICAL key. It is checked against the identity's keys and the live roster. The owner key is refused anywhere but localhost; keep it offline for contract updates.
- The key stays in this tab only. It is wiped (signer freed, WIF dropped) on lock, when the tab is hidden, on page hide, after 10 idle minutes, and on unmount. Nothing is persisted.
- Sections:
  - **Reports**: the open queue, with hide-and-resolve or dismiss.
  - **Content**: find by link; hide, pin, lock, move or delete; the latest 25 posts.
  - **Members**: status, ban, suspend and warn. Ban, suspend and warn need a reason, which is stored on chain.
  - **Audit log**: documents by `$moderatedAt`.
- Starting a new lookup clears the previous target before any action buttons render.
- `scripts/moderate.mjs` performs the same document actions from a terminal: `hide|unhide|pin|unpin|lock|unlock|move|unmove|delete <type> <id>`.

## Known limits

- **Banned users' old content stays visible.** A ban stops new writes but does not hide old content; moderators hide what needs hiding. The SDK build in use cannot list the banlist.
- **Reports are public on chain,** including the reporter. The report form says so.
- **Locks are not enforced at consensus** (spike S3). Every reader drops posts created after `lockedAt`.
