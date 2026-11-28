# Testing

## Unit tests (`npm test`, vitest)

- **Forum rules** (`tests/forum-model.test.ts`): trust, effective dates, opening post, hidden, retracted and locked threads, merge order, reaction counts, sub-forum resolution, live-delta merges, body splitting, tags.
- **Importer** (`tests/import-converters.test.ts`): parsers against real XenForo pages (`tests/fixtures/xenforo`), HTML and BBCode to Markdown, byte-safe splitting with balanced fences, document mapping and the cost plan.
- **App Connect** (`tests/app-connect-*.test.ts`): the verifier table, request encoding, key mapping and connection ids.
- **Other units:** write-path helpers, moderator fields, redaction, safe redirects, decoders.

## Testnet end to end (`e2e/testnet-e2e.mjs`)

- **Wallet stand-in.** The yappr test-wallet responder (`mobile/tools` in PastaPastaPasta/yappr, staging) plays the DashPay wallet. It answers the real `dashpay://connect` request from the login dialog: it registers a contract-bound HIGH key on the persona's identity with a MASTER-signed IdentityUpdate, then publishes the encrypted `loginKeyResponse`.
- **Personas** are listed in `contracts/deployments/testnet.json`: bob (92), carol the moderator (93) and mallory (94). Each is logged in with a separate browser context.

The scenario:

1. bob logs in, saves a profile, starts a thread with tags and Markdown, replies, and edits the reply.
2. carol logs in, likes the opening post, and quote-replies.
3. mallory posts a scam reply and a scam thread.
4. bob sees the reaction in Alerts and reports mallory's reply.
5. carol unlocks `/moderation` with her CRITICAL key.
   - She hides the reported post from the queue, which resolves the report.
   - She pins and locks bob's thread.
   - She moves, then hides, mallory's thread.
   - She bans mallory, and the audit log shows the actions.
6. mallory's next post is refused by consensus (41107, banned).
7. bob sees the hidden placeholder and the lock.

Running it:

```bash
node scripts/serve-static.mjs 8899 out                      # GitHub Pages emulation, including the 404 SPA fallback
YAPPR_SAKURA_IDENTITIES=<pool.json> node mobile/tools/test-wallet-responder.mjs --serve 127.0.0.1:8791 --env-file <testnet env>
node e2e/testnet-e2e.mjs                                    # Chrome over CDP (E2E_CDP), screenshots to E2E_SHOTS
```

A snapshot and build afterwards confirm the static side: hidden threads leave the listings, the sitemap and the feeds, and the locked thread renders with its moderation state.
