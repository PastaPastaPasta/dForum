# Parity with dash.org/forum

Reference: dash.org/forum runs XenForo 2, with 18,226 threads, 180,544 messages and 9,845 members at its last public snapshot.

| dash.org/forum | dForum (contract v4) | notes |
| --- | --- | --- |
| Categories, forums, sub-forums, link nodes | ✅ categories, forums, sub-forums (`parentForumId`), archived (read-only) forums | Link nodes are not imported |
| Forum index with counts and last post | ✅ rolled up across sub-forums, updated live | |
| Thread list: pinned first, latest activity, replies, pages, prefixes | ✅ plus reactions count and tags | Prefixes are covered by tags |
| Thread view: author cards, permalinks, `#n`, pagination | ✅ 20 per page, permalinks redirect to the right page | |
| Post with BBCode editor, preview, quote | ✅ Markdown toolbar, preview, quote with attribution, drafts kept locally | |
| Edit / delete own post, edit title | ✅ "edited" marker; delete leaves a tombstone | |
| Likes / reactions | ✅ six reactions, one per member per post, toggleable | |
| Report post, moderator queue | ✅ public on-chain reports; queue with hide-and-resolve or dismiss | |
| Pin, lock, move, hide, delete | ✅ native contract moderation | |
| Ban, suspend, warn | ✅ enforced by consensus | |
| Member profiles (about, location, website, signature, avatar, title) | ✅ | Custom title is moderator-set |
| Members list, staff list | ✅ most active, team, archive authors | |
| What's new / new posts | ✅ | |
| Alerts (replies, reactions) | ✅ replies in your threads, reactions to your posts | Mentions and quote alerts would need a `mention` type (planned as a contract update) |
| Search with forum filter | ✅ full text (Pagefind) over every thread including the archive, plus live title matches | |
| Tags | ✅ tag pages | |
| RSS | ✅ site and per forum | |
| Login / register | ✅ Login with Dash (App Connect v2): no passwords; the account is the Dash identity | |
| Light and dark themes | ✅ follows the system, with a toggle | |
| History | ✅ dash.org/forum archive imported with original authors and dates | importer.md |
| Watched threads with unread counts | ✅ kept in the browser (an on-chain list would be public) | |
| Unread threads and forums, jump to newest | ✅ bold titles, "New" links to the latest post, unread forums marked on the index; kept in the browser | |
| Pin, lock in thread lists | ✅ labelled "Pinned" and "Locked" in lists and on the thread | |
| Private conversations | ❌ not yet | Needs an end-to-end encrypted design (App Connect encryption keys); never plaintext on chain |
| Polls | ❌ not yet | `poll` + `pollVote` types can be added in a contract update |
| View counts, online users | ❌ | Can't be measured without a server; replaced by replies and reactions |

## Better than the baseline

- Static pages load before any script runs. Every page has a canonical URL, and the sitemap, llms.txt, RSS and a public JSON API are all generated.
- Moderation is transparent and enforced by the network. Bans can't be bypassed client-side, and the audit log is public.
- No accounts or passwords to leak: members sign in with their wallet, using a key limited to this forum, a fee budget and an expiry.
- Readable on phones, with light and dark themes and a serif reading measure for long posts. Every control is at least 40 px on touch screens, focus is always visible, and contrast meets WCAG AA in both themes.
- Search results jump straight to the matching post, not just the thread.
- Locks and archived forums are enforced by the network, not just hidden in the UI.
- Archive-only categories start collapsed, so live discussion leads the index.
- Pages keep working offline from the static index, with a banner saying new posts wait for a connection.
- Moderators open the console from any post, already looking at it.
