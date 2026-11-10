# Chrome extension: 1.4.1 containment, then 1.5.0 governed execution

Written for the owner and for the extension, Orchestration, Community, PI and Billing owners.

This document answers the owner decisions of 2026-11-03 (sections A–L) and follows on from `EXTENSION-ASSESSMENT.md` (e8fbec7b). Nothing in it has been released, deployed, pushed or merged.

## 1. 1.4.1 containment: plan and file ownership (DONE locally)

| Exposure | Files changed (extension repo, owner: EXT-C) |
|---|---|
| Direct action bridge | `content_scripts/commandCenterBridge.js`, `background/serviceWorker.js` (about 350 lines of the direct executor deleted), `content_scripts/main.js` |
| Token to platform pages | `core/authBridge.js` (`getAuth` loses the token), `background/serviceWorker.js` (`publicAuthView`), `content_scripts/main.js` (auth and status responders removed) |
| Background collection | `platforms/linkedin/index.js`, `content_scripts/main.js`, `core/commandProcessor.js`, `background/serviceWorker.js`, new `shared/ingestionPolicy.js`, `manifest.json`; `core/syncEngine.js`, `core/syncTrigger.js` and `platforms/linkedin/scraper.js` deleted |

Working copy:
- `C:/tmp/omvx-ext`, branch `release/1.4.1-containment`, tag `v1.4.1-rc1` (ff3e357);
- baseline tag `baseline-1.4.0` (3ea5031, tree `20714ce9…`, 28 of 28 signed files match the store treehash).

The Desktop folder was never touched.

Separate server-side containment (app repo, owner: Outreach coordinator):
- worktree `C:/tmp/omp-ext-events`, branch `sec/extension-events-signed`, based on `main` 5025f51d;
- `pages/api/extension/events.ts` now requires `requireExtensionAuth`, meaning session token plus request signature, a 5-minute timestamp window and a single-use nonce. It stops accepting a bearer token alone or a Supabase user JWT.
- After this change, **every** token-accepting `/api/extension/*` route requires a signature in production, so a token leaked by 1.4.0 cannot write anything by itself.
- Compatible with 1.4.0: the worker has always signed `/api/extension/*` requests, and a test reproduces its signer.
- No migration. Deployable on its own. **Not deployed.**

## 2. Build and regression evidence

The full detail is in `C:/tmp/omvx-ext/docs/RELEASE-1.4.1.md`.

- **Package:** `omnivyra-extension-1.4.1.zip`, SHA-256 `de4239a2…5600`, deterministic (rebuilt across commits with identical bytes). Permissions are unchanged from 1.4.0.
- **Extension suite (27 tests):**
  - 1.4.1: 27 of 27 pass.
  - 1.4.0: 22 fail, each for the defect it names (21 security tests plus the auth-reply shape). That shows the tests can fail.
- **App extension-source suites:** 66 pass. The only failure is the `1.4.0` version pin, a one-line bump made with the release.
- **Real Chromium**, using the release zip, fixtures only, and no reachable network:
  - 1.4.1 is clean: pairing works, the direct action is refused, there are no leaks and no ingest.
  - 1.4.0 attempted the injected DM, leaked the token and identity, and auto-posted scraped comments.
- **Events route:** 8 new tests, using the real middleware and real session service with requests signed like the extension. The suite together with five neighbouring extension suites gives 143 of 143 passing. Typecheck result: see §6.

## 3. Provenance, licence, repository

Detail: `C:/tmp/omvx-ext/docs/PROVENANCE.md`.

- **Provenance.** The recovered folder is the signed Web Store 1.4.0 build.
  - It is first-party code: no licence markers and no third-party or vendored code.
  - The store id enters the app repository on the 1.4.0 publication day, in a commit by the owner's git identity.
- **Recommendation.** A dedicated private repository carrying this history.
  - Push only after P-1 (below) is confirmed and the destination is approved.
  - Web Store credentials never go to CI.
  - Contract compatibility comes from the schema version: the backend accepts N and N-1 for one release cycle.

## 4. 1.5.0 implementation sequence

Scope:
- **Allowed:** LinkedIn comment replies and likes, on the tenant's own content only.
- **Refused:**
  - DMs, until PI's B-7 recipient proof exists;
  - X, Instagram and Facebook;
  - connect and follow;
  - anything else not listed as allowed.
- **Capability default:** `unsupported`.

```
 P0  prerequisites ───────────────────────────────────────────────────────────────
     [1.4.1 decision]  [events-signed deploy decision]  [repo P-1]  [D-01 settled]
     [c7: result mapping + evidence fields agreed]  [PI C-PI-1: social_accounts identity]
     [Billing: channel credit decision — before any CHARGED browser action]
     [c7/GD-4: claim_community_ai_browser_command requires approved_at IS NOT NULL
      (today 20261231000005:281-286 waives approval for low-risk/no-policy rows)]
     [D-01: auto-rule path executes only status='approved' rows, claimed before the connector]
            │
 P1  contract + migration (coordinator) ─────────────────────────────────────────────
     extensionCommandSchema v2 (signed envelope)  +  ONE migration on existing tables
            │
     ┌──────┴───────────────────────────────┐
 P2  server (EXT-S)                          P3  extension 1.5.0 (EXT-C)
     redeem binds acting account               capability default unsupported
     commands: offer only to bound session     envelope verify; account recheck
     authorize-submit (replaces renew):        authorize-submit → then act, once
       kill switch, approval, role,            AbortSignal; never retry after submit
       recipient eligibility/opt-out,          pre/post evidence; uncertain on doubt
       platform/action permission, usage      storage.session (trusted contexts)
       → writes submit_attempted_at            remove fallbacks + fail-open gate
     action-result: truthful states
     Redis nonce + claim-code stores
     └──────┬───────────────────────────────┘
 P4  adapter (c7): uncertain / sent_unverified / post-submit failure ≠ ACCEPTED
            │
 P5  runtime executor (after D-01; L-3 after D-01)
            │
 P6  T1 + T2 (real PostgreSQL)  →  T3 and store release need separate approval
```

### P1. The signed command envelope (coordinator owns it)

The server signs the following with a per-session key derived like the HMAC secret, and the extension verifies it before acting:

- `command_id`
- `chain_index`
- `idempotency_key = sha256(command_id:chain_index)`
- `org_id`, `user_id`
- `social_account_id`, `acting_member_urn`
- `action`: `li.comment.reply` or `li.reaction.like`
- `target`: the post URN, plus the parent comment URN for a reply
- `text_sha256`, for a reply
- `approval_id`
- `expires_at`

### The truthful-state contract

| Situation | Server state | Retry? |
|---|---|---|
| Refused before `submit_attempted_at` (any recheck failed, account mismatch, kill switch, expired envelope) | `refused` / `not_begun` | A new command may be issued later; this one is terminal |
| `submit_attempted_at` written, then a timeout, lost reply, lost lease or tab closed | `uncertain` | **Never**; a human reconciles |
| A new comment URN appears, authored by the acting member, under the target, with matching text hash (pre/post diff) | `executed` + evidence | — |
| A like goes from not-reacted to reacted-by-the-acting-member, read back afresh | `executed` + evidence | — |
| The extension reports success without that evidence | `uncertain`, never `executed` or ACCEPTED | Never |

A like has no new object id. Its evidence is the before and after state of the reaction control, re-read after submit, plus the acting member's URN. This is weaker than the evidence for a reply, and it is recorded as such in the evidence.

### "Tenant's own content"

The server accepts a target only when the post URN belongs to content published by the bound `social_accounts` record. The extension rechecks that the post author on the page is the acting member. A post by anyone else is refused.

## 5. Contract and migration ownership

| Artefact | Single owner | Consumers |
|---|---|---|
| `extensionCommandSchema` v2 and the truthful-state mapping | Outreach coordinator | EXT-S, EXT-C, c7 |
| The single migration: `extension_sessions` (+`token_hash`, `social_account_id`, `acting_member_urn`, `revoked_at`) and `community_ai_actions` (+`submit_attempted_at`, `acting_account_id`, `pre_submit_evidence`, `post_submit_evidence`) | Outreach coordinator | EXT-S |
| `pages/api/extension/*`, `extensionSessionService`, `extensionAuthMiddleware` | EXT-S, inside Outreach | — |
| Extension repository | EXT-C, to be named; Outreach coordinator until then | — |
| `communityEngineAdapter` result mapping | c7 (Orchestration) | Outreach reviews |
| `communityAiActionExecutorRuntime` | D-01 owner first, then L-3 (Outreach) | — |
| `social_accounts` identity (C-PI-1) and B-7 recipient proof | PI | EXT-S reads only |
| Channel credit for browser actions | Billing | EXT-S |

No new tables, registries, queues or second browser framework are planned. Server-side Playwright RPA stays frozen and refused, and is never used as a fallback.

## 6. Test and verification evidence

- §2 above.
- `sec/extension-events-signed` is committed as `068d08f2d`.
  - Typecheck: `tsconfig.json` OK and `tsconfig.backend.json` OK, both with 0 errors.
  - `tsconfig.backend-tests.json` reports 153 errors that predate this branch, none of them in the changed or new files.
- **T1 for 1.5.0, planned:**
  - envelope tamper, expiry and replay;
  - account mismatch at pairing and before submit;
  - no retry after `submit_attempted_at`;
  - AbortSignal on timeout produces `uncertain`;
  - synthetic LinkedIn DOM pre/post evidence, including a pre-existing identical comment, which must not confirm;
  - refusal of DMs, X, Instagram, Facebook, connect and unknown actions;
  - route authorisation and replay.
- **T2 for 1.5.0, planned:**
  - real PostgreSQL;
  - account-bound claims;
  - opt-out and kill-switch rechecks between claim and submit;
  - lost confirmation produces `uncertain`;
  - exactly one submit across retries and two tabs;
  - adapter contract;
  - the existing T2 gates with no new failures.

## 7. Outstanding risks

1. **Installed 1.4.0 copies keep all three exposures until Chrome updates them.** Unlisting does not revoke them.
   - The token exposure is contained server-side once `sec/extension-events-signed` is deployed.
   - Direct actions and collection cannot be stopped server-side, except by returning 410 from the ingest routes (a product-impacting option).
2. **1.4.1 keeps the session token in `chrome.storage.local`.** It is readable by the extension's own content scripts, but not by page scripts. This moves to `storage.session` in 1.5.0.
3. **The capability gate still fails open, and the queued path still cannot act (renew is not allow-listed).** Both are left as they are on purpose: fixing renew would add an execution capability. 1.5.0 replaces both.
4. **Platform pages can still toggle the extension's per-platform preference (`OMNIVYRA_SET_PLATFORM_STATE`).** They can also detect the extension through `PING` and `DEBUG`. Neither carries a secret or identity. To be removed in 1.5.0.
5. **The Command Center sync control now reports "suspended".** The engagement inbox gets no browser-collected items until ingestion is reviewed.
6. **Leaked 1.4.0 tokens stay valid for up to 12 hours.**
   - Rotating the session signing secret would end every session, and it falls back to `AUTH_SECRET`, which other services share. Not recommended unless there is an incident.
   - The events-signing deployment makes rotation unnecessary.
7. **The Chromium test used Playwright Chromium, not the published Chrome channel.** Branded Chrome 156 ignores `--load-extension`, so no branded-Chrome test was possible.

## 8. Release recommendation for 1.4.1

**Recommend publishing 1.4.1, after first deploying `sec/extension-events-signed`.**

- **Order:**
  1. Deploy the server change. It stands alone, needs no migration, and is compatible with 1.4.0. Deploy through the normal clean-main and predeploy process.
  2. Upload `omnivyra-extension-1.4.1.zip` (SHA `de4239a2…5600`), after its store-listing data disclosures have been checked.
  3. Bump the app's version pin.
- **Each step needs separate approval.**
- **Do not** combine this with any 1.5.0 work.
- **Do not** describe unlisting 1.4.0 as revocation.

## H. Production checks: plan only, ON HOLD, nothing executed

- **Mechanism.** The owner runs the queries in the Supabase dashboard SQL editor under their own existing login. This is the only access already authorised. It needs no setup, no Supabase CLI (which would initialise a login role) and no new role.
  - The read-only role designed earlier does not exist in production.
  - The Supabase MCP server did not connect in this session.
- **Rules:**
  - Each query is a single `SELECT`, with no `;` and no comments, as the console requires.
  - No column holding a token, secret or message text is selected. Only counts, statuses and timestamps.
- **Permissions:** read on `information_schema`, `community_ai_actions` and `extension_sessions`, which the owner's dashboard role already has. No write, no grant, no role change.

Run H0 first, and adjust any later column name it shows to be different:

- **H0 (schema only):**
  `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('community_ai_actions', 'extension_sessions') ORDER BY table_name, ordinal_position`
- **H1 (browser actions by status, 90 days):**
  `SELECT status, count(*) AS n FROM community_ai_actions WHERE execution_mode = 'browser' AND created_at > now() - interval '90 days' GROUP BY status ORDER BY n DESC`
- **H2 (LEASE_LOST vs executed, 90 days):**
  `SELECT count(*) FILTER (WHERE execution_result::text LIKE '%LEASE_LOST%') AS lease_lost, count(*) FILTER (WHERE status = 'executed') AS executed, count(*) AS total FROM community_ai_actions WHERE execution_mode = 'browser' AND created_at > now() - interval '90 days'`
- **H3 (extension activity, 30 days):**
  `SELECT count(DISTINCT org_id) AS orgs, count(DISTINCT user_id) AS users, count(*) AS sessions, max(last_seen) AS latest FROM extension_sessions WHERE last_seen > now() - interval '30 days'`
- **H4:** the Web Store user count, read from the developer dashboard. No query.

## 9. Decisions and approvals still required

| # | Decision |
|---|---|
| P-1 | Confirm the publisher account and the company's ownership of the code, the licence to record, and the private repository destination. Pushing waits on this. |
| R-1 | Deploy `sec/extension-events-signed`. |
| R-2 | Publish 1.4.1 to the Web Store. |
| R-3 | Optional interim measure: return 410 from the ingest routes so that 1.4.0 collection stops before installs update. This impacts the product. |
| R-4 | Run H0–H4. |
| F-1 | Whether, and when, a separately reviewed user-triggered ingestion (own inbox and own posts) is considered. Until then the inbox gets no browser items. |
| C-1 | Name the extension owner (EXT-C). |
| C-2 | Start 1.5.0 P1–P3 once the §4 prerequisites are met. D-01, c7's result mapping, C-PI-1 and the Billing decision come from other owners. |
