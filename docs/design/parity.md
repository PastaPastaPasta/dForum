# Feature parity vs dash.org/forum

Reference: dash.org/forum (XenForo-style: categories → forums → threads → posts, search, profiles, pins/locks, moderation, login).

Scope is the forum product surface, not the Dash Core protocol. Honest gaps are listed, not papered over.

## Covered

| Surface | dForum |
|---|---|
| Categories → forums | `category` + `forum` types (owner-managed; one level of hierarchy) |
| Threads (start/view) | `thread` type; path route `/t/[id]`, sticky + lockedAt + tags (≤5, contract-validated) |
| Posts (flat chronology) | `post` type; reply chronology, `replyToId` quotes, body ≤4000 chars / ≤5120 bytes |
| Search | title/tag/forum search across the latest 25 listable threads (live + static) |
| Profiles | identity-scoped (no global username): threads + posts, custom display name/bio/signature/website |
| Login / register | App Connect v2 "login with Dash" — QR + wallet; key-registration on first login (the "register" equivalent, no server-side accounts) |
| Statuses | sticky/pinned, locked, hidden (moderation), orphan drop, pagination ("Load more") |
| Moderation | team/none/network modes, native protocol 14 moderation, console at `/moderation` |
| SEO/AI indexing | hourly static rebuild (sitemap/robots/llms/manifest), SPA fallback for fresh content |
| Deployment | GH Pages (read-only index — no sign-in/posting/moderation on the Pages deploy; those live on the canonical host) with custom-domain wiring (`forum.dashhq.org` CNAME pending pasta's Cloudflare step) |

## Deliberately out of scope (v1)

| Surface | Why |
|---|---|
| Nested sub-forums | dash.org/forum has 2-level nesting; dForum is one level of forums under a category. Adding nesting changes the orphan/index rules and the contract — revisit at registration time, not in v1. |
| Reactions (UI) | The reaction type exists in the contract (indexed, keyed one-per-post) but the v1 UI ships no reaction surface — dash.org/forum has none either. The write path is not exposed. |
| User reports / mod queue | The `report` type exists in the contract and the moderation console can delete/resolve it, but there is no public "flag a post" flow in the UI. A proper report queue (public report → moderator triage) is the one deliberate gap — it needs the moderation queue flow, not just a button. |
| Poll/vote feature | Reference site mentioned polls historically; not in the current XenForo surface. Not shipped. |
| RSS / notifications | Not in the v1 scope. The SPA shell is the AI/SEO surface. |
| Edit history | No history entries; the body is author-editable and "edited" is shown via `$updatedAt` (moderator `changeFields` bump `$revision`). Append-only semantics are documented in the data model. |
| Thread moves | v1: forumId is immutable (no moves). |

## Honest caveats

- Deployment to `forum.dashhq.org` is blocked on pasta's Cloudflare CNAME (NXDOMAIN today); the GH Pages subdomain serves the testnet build (footer honestly labels "Testnet build").
- The GH Pages deploy is a read-only SEO/AI indexing surface: sign-in, posting and moderation live on the canonical host (`forum.dashhq.org`, DNS pending); the Pages subdomain serves the read-only index (live-fills from the platform after first paint). The login/post/moderate coverage above is the product surface on the canonical host, not the Pages deploy.
- The contract is a testnet deployment (`contracts/deployments/testnet.json`, `ozZN…ADM16`). A mainnet contract is unregistered by design at this stage — first production deploy needs the deployer CRITICAL key + credits, and the DNS + workflow cutover (BASE_PATH removal, SITE_URL switch) is pasta-side.
- App Connect keys are identity-level, not contract-bound — documented in the README security notes; the mitigations (host gate, sessionStorage, offline CRITICAL key) are the answer until the protocol grows contract-bound keys.

## Parity verdict

The forum surface that defines a forum — browse/search/thread/reply/profile/login/moderate/index — is present and tested at build + screenshot level. The three explicit gaps (sub-forum nesting, reports UI, reactions UI) are documented above as scope, with the likely ordering of the first two for a follow-up. This is not a claim of byte-level parity with XenForo; it is a claim that the product works as a forum and nothing hidden ships silently.
