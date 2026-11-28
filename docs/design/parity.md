# Feature parity vs dash.org/forum

Reference: dash.org/forum (XenForo-style: categories → forums → threads → posts, search, profiles, pins/locks, moderation, login).

Scope is the forum product surface, not the Dash Core protocol. Honest gaps are listed, not papered over.

## Covered

| Surface | dForum |
|---|---|
| Categories → forums | `category` + `forum` types (owner-managed; one level of hierarchy) |
| Threads (start/view) | `thread` type; path route `/t/[id]`, sticky + lockedAt + tags (≤5, contract-validated) |
| Posts (flat chronology) | `post` type; reply chronology (`replyToId` is recorded on the chain but not rendered as a quote — bodies render as-is), body ≤4000 chars / ≤5120 bytes |
| Search | title/tag/forum-title search over the latest 25 live threads plus the last static snapshot (live fill refines it) |
| Profiles | identity-scoped (no global username): threads + posts, custom display name/bio/signature/website |
| Login / register | App Connect v2 "login with Dash" — QR + wallet; the wallet registers the contract-bound key as part of the approval (the "register" equivalent, no server-side accounts) |
| Statuses | sticky/pinned, locked, hidden (moderation), orphan drop, pagination ("Load more") |
| Moderation | team/none/network modes, native protocol 14 moderation, console at `/moderation` |
| SEO/AI indexing | hourly static rebuild (sitemap/robots/llms/manifest), SPA fallback for fresh content |
| Deployment | GitHub Pages at `forum.dashhq.org` (custom domain live) — static-first `out/` with live-fill from the platform |

## Deliberately out of scope (v1)

| Surface | Why |
|---|---|
| Nested sub-forums | dash.org/forum has 2-level nesting; dForum is one level of forums under a category. Adding nesting changes the orphan/index rules and the contract — revisit at registration time, not in v1. |
| Reactions (UI) | The reaction type exists in the contract (indexed, keyed one-per-post) but the v1 UI ships no reaction surface — dash.org/forum has none either. The write path is not exposed. |
| User reports / mod queue | The `report` type exists in the contract (deletable, status/resolution changeable) but the app neither creates nor moderates reports today — there is no public "flag a post" flow and no report triage queue in the console. A proper report queue (public report → moderator triage) is the one deliberate gap — it needs a public report flow plus a triage queue, not just a button (see `docs/design/contract-next-registration.md`). |
| Poll/vote feature | Reference site mentioned polls historically; not in the current XenForo surface. Not shipped. |
| RSS / notifications | Not in the v1 scope. The SPA shell is the AI/SEO surface. |
| Edit history | No history entries; there is no edit control in the UI — "edited" is shown via `$updatedAt` (moderator `changeFields` bump `$revision`). Append-only semantics are documented in the data model. |
| Thread moves | v1: forumId is immutable (no moves). |

## Honest caveats

- Deployment target is `forum.dashhq.org` (custom domain live). The footer honestly labels the build as "Testnet build" — the contract is testnet today; a mainnet cutover is a pasta-side decision.
- The GH Pages deploy IS the canonical host (`forum.dashhq.org`, DNS is live): sign-in, posting and moderation run here; the static-first/live-fill pattern is the indexing surface. The login/post/moderate coverage above is the product surface.
- The contract is a testnet deployment (`contracts/deployments/testnet.json`, `ozZN…ADM16`). A mainnet contract is unregistered by design at this stage — first production deploy needs the deployer CRITICAL key + credits and the testnet→mainnet cutover (network switch + contract registration), a pasta-side decision.
- App Connect v2 keys are contract-bound (singleContract → dForum's contract, ~0.5 DASH budget, 90-day expiry) — the bounds and budgets are enforced by the chain; the mitigations (host gate, sessionStorage, offline CRITICAL key) layer on top (see the README security notes).

## Parity verdict

The forum surface that defines a forum — browse/search/thread/reply/profile/login/moderate/index — is present and tested at build + screenshot level. The three explicit gaps (sub-forum nesting, reports UI, reactions UI) are documented above as scope, with the likely ordering of the first two for a follow-up. This is not a claim of byte-level parity with XenForo; it is a claim that the product works as a forum and nothing hidden ships silently.
