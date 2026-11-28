# Backfilling dash.org/forum (XenForo importer)

`scripts/import/xenforo.mjs` copies a XenForo 2 forum into dForum: its categories, forums and sub-forums, threads, posts, original authors and original dates. Imported documents are ordinary `thread`/`post` documents, so replies, reactions, reports, search and moderation work on them unchanged.

## Trust model

- **Owner writes the structure.** Categories and forums are owner-only types; `structure` signs with the owner's key.
- **Archivist writes the content.** A dedicated **archivist** identity writes threads and posts with `origId`, `origAuthor`, `origAuthorId` and `origCreatedAt`. The forum trusts those fields only because `forumSettings.archiveOwnerId` names that identity. Anyone else who sets them is ignored.
- **Trust window.** `forumSettings.archiveTrustUntil` bounds that trust: archivist documents created on chain after it show as ordinary posts by the archivist identity. Close the window when a backfill is done (`trust --until now`) so a leaked archivist key can't forge history, and reopen it (`trust --until open`) for the next backfill.
- **Separate identities.** The archivist must not be the owner or a moderator: moderators can't remove documents owned by the owner or other moderators, so archive takedowns would become impossible. On testnet the archivist is persona index 5 (`99hojzpv…KxH`).
- **After the window closes,** a leaked archivist key can no longer forge history, but it could still edit or retract imported posts, which then lose their archive trust (vandalism, not forgery). Keep the archivist key offline once a backfill is done. The next contract registration should make imported bodies conditionally immutable (`{property, when}` on `origId`).
- **Display.** Imported posts show the original author with an archive mark and a link to the original post. Imported authors are names, not Dash identities, and are listed separately on the members page.

## Stages

```bash
# 1. Crawl into .cache/import/<name> (resumable; raw pages are cached)
node scripts/import/xenforo.mjs crawl --source api  --base https://www.dash.org/forum/ --api-key-file <key>   # forum operator
node scripts/import/xenforo.mjs crawl --source html --base https://www.dash.org/forum/ [--wayback]            # public pages
#    --forums 152,141 --max-threads 25 --max-pages 6 --delay 1500   (subset and politeness controls)

# 2. Plan: counts, bytes, estimated cost
node scripts/import/xenforo.mjs plan

# 3. Structure: categories, forums and sub-forums (owner key). --archive-forums <ids> marks forums to close in step 5.
node scripts/import/xenforo.mjs structure --archive-forums 157

# 4. Load: threads and posts as the archivist, as one chronological stream, within a budget
node scripts/import/xenforo.mjs load --budget-dash 6 [--limit N] [--dry-run]

# 5. Archive: close the read-only forums (owner key). Do this last: an archived forum refuses
#    every new thread and post at consensus, the archivist's included.
node scripts/import/xenforo.mjs archive

# 6. Close the trust window (owner key). Reopen it with --until open before a later backfill.
node scripts/import/xenforo.mjs trust --until now
```

**Backfilling again later.** The crawl, ledger and structure map are all resumable, so a later backfill (new threads on dash.org/forum, or forums skipped the first time) is the same sequence: `crawl --refresh` (refetches the node index, forum lists and the newest page of each known thread; older pages come from the cache), `trust --until open` (refused if the archivist wrote anything while the window was closed), `structure` (existing categories and forums are found by slug and reused), `load` (the ledger and the `byOrigin` index skip everything already written), then `trust --until now`. Forums already archived refuse new posts at consensus; to add history to one, the owner clears `archived` first and runs `archive` again afterwards.

Two things to know while a backfill runs: a thread a moderator locks before its import finishes refuses the rest of its posts (consensus), so `load` stops there; and XenForo's own lock state isn't carried over (lock imported threads from the console if needed).

The structure map is kept per contract (`structure-map-<contract>.json`), as is the ledger, so registering a new contract starts a clean import.

- **Sources.**
  - **API mode** reads `/api/nodes/flattened`, `/api/forums/{id}/threads` and `/api/threads/{id}/posts` with an `XF-Api-Key` (operator-issued, read scope). This is the right path for a full migration, because it carries raw BBCode, hidden-state flags and complete threads.
  - **HTML mode** parses public pages. It goes through the Wayback Machine when the live site is behind a bot challenge (dash.org/forum is, so the testnet run used `--wayback`).
- **Conversion.** BBCode (`lib/import/bbcode.ts`) and XenForo HTML (`lib/import/to-markdown.ts`) become Markdown without raw HTML: quotes with attribution, code fences, lists, tables, links, images and media links. Posts longer than one document split by bytes into `body` + `body2`. Longer posts continue in "(continued)" posts with origId `postId*100+k`.
- **Pages the archive refuses.** Pages that return 403, 404, 410 or 451 (the Wayback Machine refuses some) are skipped and logged; the crawl continues.
- **Smilies and attachments.** XenForo smilie codes become emoji. Attachment links become `Attachment: <name>` links to the original host. Images the original host refuses to serve here (dash.org blocks cross-origin image loads) render as links to the image.
- **Ordering.** Posts are written oldest first across the whole import, with each thread created just before its first post. Chain order (`$createdAt`) then matches the original order; readers sort by `origCreatedAt` regardless.
- **Idempotency.** A local ledger (`ledger-<contract>.json`) records every write. After an ambiguous failure, the unique `byOrigin` index (`$ownerId`, `origId`) is queried before retrying, and consensus refuses a duplicate anyway. Rerunning `load` resumes where it stopped.
- **Keys.** None are passed as flags. Testnet derives them from the deployer seed. Elsewhere set `DFORUM_OWNER_WIF`/`_ID`/`_KEY_ID` and `DFORUM_ARCHIVIST_WIF`/`_ID`/`_KEY_ID`. The importer signs non-batched transitions, so the archivist key must be an unbound HIGH key; keep the archivist identity's balance small.

## Scale and cost

| scope | documents | cost |
| --- | --- | --- |
| Testnet run (24 forums, 198 threads, 3,970 posts) | about 4,200 | about 6.9 tDASH; about 6 hours at 5 s per serial write |
| Full dash.org/forum (18,226 threads, 180,544 messages) | about 199k | about 300 DASH; about 8 days at the measured 3.5 s per serial write |

Speed-ups for a full mainnet migration:

- Pipeline identity-contract nonces.
- Run several archivist identities. This needs `archiveOwnerId` to become a list in a contract update, since new optional fields are allowed.
- Import forum by forum, newest first, into forums that are still open, and archive each one once it is complete (consensus refuses every write to an archived forum, the archivist's included).

## Not imported

- Private conversations.
- Attachments: they stay linked to the original host.
- Reactions and likes, view counts, polls, profile pictures.
- Soft-deleted or moderated XenForo content.

Member accounts can't be "claimed" by a Dash identity yet; that would need an attestation document type.
