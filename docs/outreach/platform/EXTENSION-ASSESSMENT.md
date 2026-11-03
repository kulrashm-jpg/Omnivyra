# Omnivyra Chrome Extension: assessment and integration plan

Status at 2026-11-03. This assessment comes before any implementation, and **nothing was changed**:
- the recovered extension folder was only read;
- no extension was installed, loaded or run;
- no platform was contacted, except one public Chrome Web Store page;
- no production system was read.

It answers §9 of the revised mandate.

How to read the evidence:
- **Read** means I or an auditor read the cited line. My own spot-checks are marked ✔.
- **Inferred** means the conclusion comes from a trace and has not been executed.
- Three read-only audits ran in parallel (extension core, platform modules, backend). I re-read the claims that change a decision.

Paths:
- `EXT` is `C:\Users\lenovo\Desktop\Omnivyra-Chrome-Extension-v1.4.0-Recovered`.
- `BE` is this repository at `d682ab13`.
- `main` is `5025f51d`.

## 1. Authoritative source, version and commit

| Fact | Evidence |
|---|---|
| The recovered folder **is the Chrome Web Store build**: item `khlballmijciomdbigljpafliajdekbg`, version 1.4.0 | `manifest.json` has the Web Store `update_url`. `_metadata/verified_contents.json` is signed by `publisher` and `webstore`. ✔ I recomputed the tree hash of all 28 signed files and **all 28 match**, with no unsigned extra files |
| The store listing is still 1.4.0, last updated 12 August 2026, offered by "Kuldeep Rawat" | Public listing page, fetched 2026-11-03 ✔. The user count is not shown |
| The backend targets this exact build | `backend/tests/unit/extensionProductionTargeting.test.ts:36` pins `PRODUCTION_EXTENSION_ID = 'khlballmijciomdbigljpafliajdekbg'` ✔ |
| **No source repository and no commit exist** | None of the 838 refs in the repo ever contained the extension files (`git log --all` for `commandProcessor.js`, `capabilityLoader.js`, `requestSigner.js`) ✔. No other copy exists under Desktop, Documents, Downloads, `C:/tmp` or `C:/omnivyra-archive`, and it is not installed in the default Chrome profile ✔. `extensionSourceRoot.ts:4-5` says the source is "deliberately not vendored: its licence/provenance is not recorded here" |
| The source is readable, not minified | 12,371 lines of plain JS, with comments |

**Authoritative implementation:** the signed Web Store package, version 1.4.0. The local copy and the store version are the same bytes. There is no newer or unpublished source to compare against.

If "the cloud" means a source project somewhere else, such as Google Drive, I could not check it: the Google Drive connector in this session is not authorized. Every other route I could check is listed above.

**The backend's expectations match this build.** With `OMNIVYRA_EXTENSION_ROOT` pointed at the recovered folder, the three source-dependent suites pass: 67 passed, 1 skipped by design. That skipped test is the self-check that skipped tests are reported as skipped. These suites test the server side of renewal and source pins. They do **not** test the defects below.

## 2. Local against cloud

Byte-identical (§1). The only local-only fact is the folder timestamps, set to 2026-11-03 when it was recovered. The `manifest.json` timestamp (12 August) matches the store's "last updated" date.

## 3. Architecture and capability inventory

MV3 extension:
- **Service worker** `background/serviceWorker.js` (1,603 lines). It runs four alarms: command poll every minute, health check every 5 minutes, auth revalidation every minute, lease cleanup every 2 minutes.
- **Bridge content script** on omnivyra.com: `content_scripts/commandCenterBridge.js`.
- **Platform content scripts** on linkedin.com, x.com, facebook.com and instagram.com. Each loads the `shared/*` and `core/*` stack plus its own `platforms/<p>/index.js`.
- **Popup.**
- **Permissions:** `storage`, `scripting`, `activeTab`, `alarms`, `tabs`.
- **Hosts:** the four platforms, `omnivyra.com`, and `api.omnivyra.io`. Nothing calls `api.omnivyra.io`.

| Part | State | Evidence |
|---|---|---|
| Pairing: claim code → redeem → 12 h token plus a per-session HMAC secret | OPERATIONAL | `bootstrap.ts:32-35`, `redeem.ts:53-83`, `serviceWorker.js:521-560` |
| Request signing (HMAC over method, path, timestamp, nonce and body hash) | OPERATIONAL | `requestSigner.js:80-97`; verified in `extensionSessionService.ts:114-167` |
| Queued command path: poll → claim → ticket → content script → result | **BROKEN for every leased command.** The content script's lease renewal goes through the service-worker relay, and `/api/extension/dispatch/renew` is not on its allow-list, so the command fails `LEASE_LOST` before acting. `main` also issues leases and has the renew route ✔, so the same applies in production (inferred) | `commandProcessor.js:281-295`, `apiClient.js:170-175,456` ✔, `serviceWorker.js:38-53,230-239` ✔ |
| Direct action bridge (`OMNIVYRA_EXECUTE_PLATFORM_ACTION`) | OPERATIONAL and **ungoverned**: no server command, lease, approval, kill switch, record or DM refusal. The web app no longer sends it (`git log -S` shows it added in `d99d6b93`/`5fa957e2` and later removed), but the published extension still obeys any script on omnivyra.com | `commandCenterBridge.js:227-263` ✔, `serviceWorker.js:900-971` |
| Capability gating | **Fails open, permanently.** `omnivyraApi` is never defined, so the server matrix is never fetched. The fallback marks reply, like, DM and post as `api_verified` on all four platforms, under a comment that says "fail closed". DM steps skip the gate entirely | `capabilityLoader.js:37-44,65` ✔, `commandProcessor.js:112-115` ✔ |
| X commands from the server | DEAD: the server sends `twitter`, but the tab lookup only knows `x` | `serviceWorker.js:1534-1541` ✔, `commands.ts:267,342` |
| Background ingestion (DM inbox, comments, feed, notifications) | OPERATIONAL. **Runs automatically** on page load, scroll and click, with no user action, and reads third-party personal data | `main.js:607-618`, `linkedin/index.js:24-25,2376-2389`, `scraper.js` |
| `messaging.js`, `storageManager.js`, `analyze_*`, Sales Navigator and Recruiter collectors, `/analytics/events` | DEAD | core and platform audits |

## 4. Backend integration and execution lifecycle

- **One executor, two browser transports.** `executeAction` (`communityAiActionExecutorRuntime.ts:311`) selects one of three modes: `api`, `browser` (queued for the extension) or `rpa` (server-side Playwright with one stored session per organization). Automatic mode selection never chooses `rpa`.
- **Fallback.**
  - On this branch: the API-to-browser fallback runs once, only after a definite not-acted API failure, and never for DMs.
  - On `main`: it falls back after **any** failure, timeouts included, which is a duplicate-send risk.
- **Command row:** `community_ai_actions`, with `execution_mode='browser'`.
- **Claim:** RPC `claim_community_ai_browser_command` (`20261231000005:229-289`). It checks the organization, pending status, no existing lease, not cancelled, the global kill switch and approval. It runs as SECURITY DEFINER for service_role only. The lease lasts 90 s.
- **Result:** `success` plus `result.confirmed === true` becomes `executed`. Any other success becomes `sent_unverified`. Anything else becomes `failed` (`action-result.ts:251-253` ✔).
- **Reaper.** On this branch, a lapsed lease becomes `uncertain`, is never retried, and any late result is kept as evidence. On `main`, the reaper marks it `failed`.
- **Migrations.** The branch code needs `20261231000002` and `000005`, which are applied nowhere real.
- **Community engine adapter** (contract 0.2.0):
  - It already routes journeys to `browser` mode once person-identity proof, approval and governance pass.
  - It refuses `rpa`, `manual` and every DM.
  - It maps `sent_unverified` to ACCEPTED, which **overstates** the evidence.
  - It records an extension `failed` as definite even after a submit.

```
TODAY (1.4.0 + BE d682ab13)
Web/Journey ─► executeAction ─► community_ai_actions(pending, browser)
Extension SW ──poll──► GET /commands ──claim RPC (org, approval, kill switch)──► lease 90 s
SW ─ticket─► content script ─► renew ✗ (not allow-listed) ─► report failed LEASE_LOST
omnivyra.com page ─postMessage EXECUTE_PLATFORM_ACTION─► SW ─► LinkedIn DM/reply (no server involvement)
```

## 5. Platform × action matrix

Classifications come from reading the code. **Nothing has been run against a live platform.**

| Platform | Reply / comment | Like | DM | Post | Read (ingestion) | Connect / follow |
|---|---|---|---|---|---|---|
| LinkedIn | PARTIAL: falls back to the first reply button on the page (`:1652`) | PARTIAL: toggles, so un-liking also reports "confirmed" (`:1503-1508`) | PARTIAL, unsafe: matches the recipient by name substring; the patched `openThread` returns `confirmed:true` on a name match (`serviceWorker.js:1351-1372` ✔); with no target it **falls through to `createPost`** (`:587` ✔); "sent" when the composer is empty (`:766` ✔). Refused by the server on the command path (`dmDispatchSafety.ts:55,97`) | PARTIAL: draft by default; can "confirm" from a probe taken before the click (`:405,431`) | OPERATIONAL | UNSUPPORTED |
| X | PARTIAL: falls back to the first button | PARTIAL: matches any `div` | PARTIAL: off the messaging page, a DM becomes a **public reply** (`x/index.js:174`) | PARTIAL | OPERATIONAL | UNSUPPORTED |
| Instagram, Facebook | EXPERIMENTAL: generic submit selectors | EXPERIMENTAL | EXPERIMENTAL: `start_new_dm` clicks the first dialog button | EXPERIMENTAL | OPERATIONAL | UNSUPPORTED. Facebook `open_thread` goes to messenger.com, which is not permitted, so it is DEAD |

**Confirmation is not proof of a new write.** Every "platform id" probe looks for **existing** DOM nodes whose text contains the sent text. An earlier identical message confirms immediately. There is **no uncertain state**: an unverifiable result after a click is reported as permanent `failed`. Nothing detects CAPTCHA, checkpoints, rate limits or restrictions.

## 6. Security and authorization gaps (the 12 required controls)

| # | Control | Extension 1.4.0 | Backend | Overall |
|---|---|---|---|---|
| 1 | Verified tenant, user and acting account | Tenant and user come from the token. **No module reads the logged-in social account** | The token binds organization and user only; the role is re-checked only in `validate` | **ABSENT** (acting account) |
| 2 | Command bound to account and action | Action only | Any signed session of the organization can claim (`commands.ts:158-165` ✔); chain steps are re-offered to the whole organization | **ABSENT** |
| 3 | Recipient identity and consent | Name substring | Recipient proof is B-7; DMs are refused | **ABSENT** |
| 4 | Authorization immediately before execution | Renewal exists but is blocked; the direct bridge has none | The claim checks approval and the kill switch, but not the playbook, usage, platform policy or `mayContact` | **PARTIAL** |
| 5 | Replay protection and idempotency | Nonce plus timestamp. The `Idempotency-Key` changes every second | The nonce and claim-code stores are in-memory per instance; `/api/extension/events` accepts a bearer token with no signature | **PARTIAL** |
| 6 | Duplicate prevention | Local store by command id. A **30 s timeout does not cancel the handler, and TIMEOUT is retried**. The direct path re-runs in the next tab after a failure | A claimed row is never re-offered | **PARTIAL**: double-send possible |
| 7 | Truthful uncertainty | None: possibly-sent is reported as `failed` | The reaper sets `uncertain` (branch); `sent_unverified` is read as ACCEPTED | **PARTIAL** |
| 8 | Secure session and token storage | Token stored as base64 and HMAC secret in plaintext in `storage.local`. **Any script on a LinkedIn, X, Facebook or Instagram page can ask for the session token** (`main.js:820-826` ✔) and receive it via `postMessage(...,'*')`. Combined with the bearer-only events route, that allows forged inbox events for up to 12 h (inferred) | Stateless 12 h token, with no revocation short of rotating the global secret | **ABSENT** |
| 9 | URL and domain restriction | Endpoint allow-list; tab URL matched by substring; `api_base_url` from the server is not sanitised | `threadUrl` and `recipientHandle` are unvalidated, and text has no length limit | **PARTIAL** |
| 10 | Action-level permission and human approval | The capability gate fails open; the direct bridge bypasses approval | Approval is checked at claim | **PARTIAL** |
| 11 | Kill switch and limits | None on the client; platform toggles are cosmetic | Kill switch checked at claim only | **PARTIAL** |
| 12 | Auditable evidence | Traces are built | Only summary fields are persisted | **PARTIAL** |

**Earlier findings, reconciled.** GAP-03 and GAP-09..14 concern the **server-side Playwright RPA**, not the extension.

| Finding | Concerns | Status |
|---|---|---|
| GAP-03, false `executed` on reply | RPA | OPEN. The extension has the same class of defect: §5 probes, plus the server accepting `confirmed` from the client |
| GAP-09, 10, 11, 13, 14 | RPA | Fixed on this branch only, not on `main` |
| Plaintext sessions | RPA | Fixed on the branch: encrypted envelope; invalidation migration `000010` unapplied |
| Plaintext sessions | Extension | OPEN: control 8 |
| Replayable tokens | RPA | Fixed on the branch (single-use) |
| Replayable tokens | Extension | OPEN: 12 h bearer token, per-instance nonce cache |
| Missing URL policy | Both | OPEN. RPA is host-only, with the path unchecked |
| API-to-browser fallback | Extension | Duplicate risk fixed on the branch; unbounded on `main`; the acting account is unbound everywhere |
| Acting-account proof | Both | OPEN |
| Commands offered to any organization session | Extension | OPEN |

**Live exposure in the published 1.4.0** (by reading; not measured):
- the direct action bridge;
- the session token handed to platform pages;
- automatic ingestion of third-party data.

The queued path cannot act (the renew defect), so server-issued commands should currently end `failed`/`LEASE_LOST`, not as duplicate sends. A production count of `LEASE_LOST` results would confirm this. That count is in the read request in §12.

## 7. Recommended architecture

**Keep the extension as the single browser-execution transport.** It remains a standalone extension, using the existing community command pipeline and a tightened contract.

**Why this is the least disruptive and safest choice:**
- **It is already integrated.** The backend half (claim RPC, leases, reaper to `uncertain`, late-result evidence, kill switch and approval at claim, DM refusal) is the better-built half. The defects are in the extension client and in a few backend gaps.
- **It acts as a real, present user** in their own browser. The server never holds the platform session. That avoids the server RPA model, which stores one opaque session per organization and is exactly the "arbitrary logged-in session" the mandate rules out.
- **Server-side Playwright RPA stays refused** for journeys (it already is) and is **frozen, not extended**. Retiring it needs a separate approval.
- **No new framework, registry or store.** The extension is `execution_mode='browser'` of the existing community engine, behind the existing adapter.

**Initial scope for the governed path:** LinkedIn **comment reply** and **like/react**, on the tenant's own content, by the tenant-bound account. Actions are added one at a time, only when each has a passing pre/post evidence test.
- **DMs stay refused** (server policy unchanged) until B-7 recipient proof is decided.
- **X, Instagram and Facebook stay refused** (capability `unsupported`) until each module passes the same bar.
- Connect and follow are out of scope.

**Target controls:**
1. **Account binding at pairing.** The extension reads the logged-in member identity on the platform page and sends it at redeem. The server accepts only an identity that matches a `social_accounts` row the tenant connected through OAuth, i.e. the same platform member. The session is then bound to that account.
   - The server offers a command only to a session bound to the command's acting account, and the account is snapshotted at approval (the `proveActingAccount` design).
   - The extension re-reads the logged-in identity immediately before submit, and refuses on any mismatch.
2. **Signed command envelope.** It contains command id, chain index, organization, acting account, action, target URN or URL, a hash of the text, expiry and lease. It is signed with the session HMAC secret, and the extension verifies it, so a page cannot fabricate a command.
3. **Pre-submit authorization.** `dispatch/renew` becomes the authorize-to-submit call, and is added to the allow-list. It re-runs the kill switch, approval, the member's role, `mayContact` (L-3), platform policy and usage, and on success writes `submit_attempted_at` **before** the click. Any refusal settles as `refused`/`not_begun`.
4. **Truthful results.**
   - The extension takes a target snapshot before submit and after it. `executed` requires a **new** platform id that was absent before the submit.
   - A submit followed by lost confirmation gives `uncertain`, never `failed`.
   - The handler is cancelled through an AbortSignal on timeout.
   - No automatic retry after `submit_attempted`.
   - No fan-out across tabs.
5. **Server truth.**
   - `sent_unverified` and any post-submit `failed` map to `uncertain` under the contract.
   - `executed` requires `platform_id` and `verified_at`.
   - The full evidence is kept in the existing row's evidence JSON. No new store.
6. **Storage.**
   - The token and HMAC secret move to `chrome.storage.session`, restricted to trusted contexts.
   - The token is never returned over `postMessage`.
   - Server-side session records (token hash, bound account, `revoked_at`) go on the existing `extension_sessions` table.
   - Shorter token life.
   - The nonce and claim-code stores move to the existing Redis.
   - `/api/extension/events` requires a signature.
7. **Remove the ungoverned paths.**
   - Remove the direct action bridge, or require a server-issued command id for it.
   - Fetch the capability matrix from the server, with a fail-closed default and no DM exemption.
   - Remove the first-element fallbacks and the DM-to-post fall-through.
   - Validate target URLs on both sides.
   - Remove the unused host permission.
   - Sanitise `api_base_url`.
8. **Ingestion** (owner and counsel decision): limit it to the tenant's own inbox and own posts, triggered by the user, with no background scraping of the feed or timeline.

**Contract states**, with no new state introduced:

| Mandate state | Row state today | Contract 0.2.0 |
|---|---|---|
| queued | `pending` with no lease | EXECUTING, wait |
| started | leased, with `submit_attempted_at` set | EXECUTING, may have acted |
| executed | `executed`, with a new `platform_id` | ACCEPTED |
| refused | refusal before submit | REJECTED |
| failed | definite failure before submit | FAILED |
| uncertain | `uncertain` / post-submit unconfirmed | uncertain |
| not_begun | released without a submit | `not_begun` (`holdOnly`) |

```
TARGET
Orchestration ─authorize─► community adapter ─► executeAction ─► community_ai_actions(pending, browser, acting_account snapshot)
Ext SW (session bound to account A) ─poll─► GET /commands  [offers only rows for account A] ─claim RPC─► lease + signed envelope
SW ─verify envelope─► content script: read logged-in member == A? ─no─► result refused (not_begun)
content script ─► POST /dispatch/renew  [kill switch, approval, role, mayContact, policy, usage] ─ok─► server sets submit_attempted_at
content script ─ snapshot before ─► submit ─► snapshot after ─► new platform id? executed : uncertain
SW ─► POST /action-result {state, platform_id, evidence} ─► row ─► adapter ─► journey (Orchestration) / PI feedback
```

## 8. Exact proposed changes

**The extension source** (a new working copy; the Desktop folder is never edited):
- Copy it to `C:/tmp/omvx-ext`, run `git init`, and make baseline commit = 1.4.0 (record the tree hashes), then branch `ext/governed-transport`.
- Where the source should live afterwards is an owner decision (§12).

| File | Change |
|---|---|
| `background/serviceWorker.js` | Add renew to the allow-list. Map `twitter` to `x`. Remove the direct-action path (`:487-488, 664-971`) and the patched `openThread` (`:1351-1372`). Remove cross-tab fan-out. Sanitise `api_base_url`. Verify the envelope. Re-read the acting identity before submit |
| `content_scripts/commandCenterBridge.js` | Drop `OMNIVYRA_EXECUTE_PLATFORM_ACTION`; schema-validate the remaining messages |
| `content_scripts/main.js` | Stop returning the token over `OMNIVYRA_REQUEST_AUTH_STATE`; return only a connected yes/no. Stop background scraping (pending §12) |
| `core/authBridge.js`, `shared/requestSigner.js`, `shared/persistentStore.js` | Move to `storage.session` with trusted-contexts access. Stable idempotency key = command id plus chain index |
| `core/commandProcessor.js` | AbortSignal cancellation; no retry after submit; the new result states; remove the DM exemption |
| `shared/capabilityLoader.js` | Fetch through the signed client; default to fail-closed `unsupported` |
| `shared/resultContract.js` | Add `uncertain`, `refused` and `not_begun`, plus the evidence shape: pre/post snapshot, `platform_id`, URL, account |
| `platforms/linkedin/index.js` | Reply and like only: exact-target location (no first-button fallback); a like/react that is idempotent (no toggle-off); pre/post id diff. **No changes to X, Instagram or Facebook** beyond the refusals |
| `manifest.json` | Version 1.5.0. Remove `api.omnivyra.io`. Consider dropping `tabs` if it becomes unneeded |

**Backend** (Outreach-owned extension routes):

| File | Change |
|---|---|
| `pages/api/extension/commands.ts` | Filter by the session's bound account; return the signed envelope; re-check the role |
| `pages/api/extension/dispatch/renew.ts` | Becomes the pre-submit authorization step and writes `submit_attempted_at` |
| `pages/api/extension/action-result.ts` | `executed` requires `platform_id`/`verified_at`; post-submit `failed` becomes `uncertain`; persist the evidence; stop overwriting `idempotency_key` |
| `pages/api/extension/redeem.ts`, `validate.ts` | Account binding at pairing; session record |
| `pages/api/extension/events.ts` | Require a signature |
| `backend/services/extensionSessionService.ts`, `extensionClaimCodeService.ts` | Move the nonce and claim-code stores to Redis; revocation |
| `backend/services/extensionCommandSchema.ts` | URL patterns per platform; text length limits |
| `middleware/extensionAuthMiddleware.ts`, `modules/extension/routes/extensionRoutes.ts` | Dead code. Leave it; a later retirement needs approval |
| `communityEngineAdapter.ts` | **Through Orchestration (`virality-c7`)**: `sent_unverified` → uncertain; acting account in the result |
| `communityAiActionExecutorRuntime.ts` | **Changed only after c7's D-01 settles** (same function). Pass the acting-account snapshot to browser rows |

**Database:**
- One coordinator migration on **existing** tables:
  - `extension_sessions`: token hash, `social_account_id`, `revoked_at`;
  - `community_ai_actions`: `submit_attempted_at`, `acting_account_id` snapshot.
- It depends on the unapplied `20261231000002/000005`.
- It is applied nowhere real.

## 9. Worktrees and ownership

| Owner | Worktree / branch | Scope | Starts when |
|---|---|---|---|
| Coordinator (me) | `C:/tmp/outreach-integration` | Migration; shared files; merges; T2 | Plan approved |
| Agent EXT-C, extension client | `C:/tmp/omvx-ext` (own git), `ext/governed-transport` | Extension files in §8 | Plan approved and source location decided |
| Agent EXT-S, extension server | `C:/tmp/omp-ext-be`, `outreach/extension-contract-*` | Extension routes and services in §8 | Plan approved |
| `virality-c7` | its own | Adapter mapping; D-01 in Runtime | Coordination request |
| The earlier Phase 1 agents (social backport, WhatsApp L-4, email truth, content formatters) | unchanged from `INITIALIZATION-REPORT.md` §14 | — | — |

Community L-3 still waits for D-01. EXT-C and EXT-S agree on one envelope and result schema, which the coordinator writes first, so they never edit each other's files.

## 10. Dependencies

| Owner | Needed | Why |
|---|---|---|
| Orchestration | Adapter mapping (`sent_unverified`/post-submit → uncertain); acting account in the result; settle D-01 first | Contract truth; same function |
| PI | The member URN or handle on the person (C-PI-1), and the B-7 recipient-proof decision | Recipient binding; any DM |
| Platform AI | None for the transport | — |
| Content Platform | None for the transport. The reply text comes from the approved revision (SC-3) | — |
| Billing | C-BL-1 before any charged browser action | — |

## 11. Tests

**T1, extension.** The extension has no tests today. Add Jest with jsdom in the extension repository:
- the result contract;
- AbortSignal cancellation;
- no retry after submit;
- envelope verification;
- the identity-mismatch refusal;
- a LinkedIn reply/like pre/post diff on **synthetic DOM fixtures** (no real personal data);
- refusals for DM, X, Instagram and Facebook;
- the allow-list including renew;
- no token over `postMessage`.

**T1, backend:**
- claims filtered by bound account;
- envelope signature;
- renew re-authorizes and refuses on opt-out, kill switch or role removal;
- `executed` refused without `platform_id`;
- post-submit `failed` becomes `uncertain`;
- events route rejects a bearer token without a signature;
- Redis nonce replay refused across two server instances (simulated).

**T2:**
- Real PostgreSQL with `000002`/`000005` plus the new migration: claim, renew, result and reaper.
- An opt-out after approval is refused at renew.
- A session bound to another account claims nothing.
- A lost result becomes `uncertain`, with exactly one submit across retries.
- Contract mapping through the community adapter.
- The existing T2 gates with no new failures.
- `OMNIVYRA_EXTENSION_ROOT` is set in the run, so source-pinned suites run instead of being skipped.

**Cannot be verified without authorization:**
- the real LinkedIn DOM and any real account action;
- that the extension loads in Chrome (an unpacked load of a dev build on a test profile is the next step, if you authorize it);
- Web Store release and update behaviour;
- multi-instance behaviour on Vercel;
- production state.

## 12. Owner decisions and approvals

1. **Containment for the published 1.4.0.** The direct-action bridge, the token handed to platform pages, and background third-party scraping are live in the store build. Options:
   - (a) a minimal 1.4.1 that removes those three paths and fixes nothing else;
   - (b) unlist until 1.5.0;
   - (c) accept the risk until 1.5.0.

   **I recommend (a).** Building it locally is safe; publishing needs your release approval. A server-side partial measure, needing a deploy approval: require a signature on `/api/extension/events`.
2. **Where the extension source lives:** a private repository, or `extension/` in this repository. Record the licence and provenance; `extensionSourceRoot.ts` says it was deliberately not vendored.
3. **Scope of 1.5.0:** LinkedIn comment reply and like on the tenant's own content only, with DMs refused until B-7. Confirm.
4. **Third-party ingestion:** keep it, limit it to own inbox and own posts triggered by the user, or stop it. Privacy and counsel.
5. **Server-side Playwright RPA:** keep it refused and frozen, with retirement decided later. Confirm.
6. **Production reads** (all read-only; none run). The Supabase CLI sets up a login role before the first query, so these need your go-ahead. They extend the list in `INITIALIZATION-REPORT.md` §3:
   - `community_ai_actions` with `execution_mode='browser'` by status and error code over 90 days, including `LEASE_LOST`;
   - `extension_sessions` heartbeats over 30 days, which gives active installs;
   - the store's user count, from the developer console.
7. **Loading a development build unpacked** in a dedicated Chrome test profile, against a local backend, with no platform login. This is for T1/T2 smoke testing only.
8. **Platform terms** for automated authenticated use (GAP-17). This is a legal matter, unchanged.
9. **Any Web Store publication.** None is authorized.
