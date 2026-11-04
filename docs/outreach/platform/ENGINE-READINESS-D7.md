# Engine readiness: the D7 evidence matrix

- Base: `8b9a9e7b8`, branch `outreach/d-engine-readiness`.
- Author: Agent D (Engine Readiness).
- Date: 2026-11-04.
- Scope: read-only for every engine except WS-3 Email, which also has the code changes in section 1.4.

## How to read this document

Each claim cites `file:line` at this base and carries one of two marks:

- **[R]** means the code was read.
- **[I]** means the claim is inferred, from a grep, from an absence, or from a doc.

A formatter, adapter or HTTP call existing is **not** evidence that a real provider action happened.

Verification levels used below, from weakest to strongest:

1. **Implemented:** the code exists.
2. **Integrated:** the code is wired end to end in-process. Tests use doubles.
3. **Sandbox-verified:** a provider sandbox or test account has accepted a real call.
4. **Production-verified:** a real tenant action has been observed in production.

No engine in this repo carries sandbox or production evidence. Every test found stubs the provider.

## Summary

| Engine | Level | Top blockers |
|---|---|---|
| WS-3 Email | Integrated (code). Not sandbox-verified in this repo [I]. | <ul><li>The SES edge function deploy is not evidenced in the repo [I].</li><li>Inbound/reply ingestion does not exist.</li><li>`outreach_outcomes` has no `complained` value.</li><li>The unsubscribe link writes no outcome row (SC-4).</li><li>No credit action.</li></ul> |
| WhatsApp | Implemented, partly integrated. **No path reaches Meta today.** | <ul><li>WA-1: operator 400.</li><li>WA-2: column mismatch.</li><li>WA-3: ids never persisted.</li><li>Journey `hasApproval` is hard-coded to false.</li><li>`increment_wa_usage` and the counter RPCs are undefined.</li><li>L-4.</li></ul> |
| Social Publishing | Integrated. Real adapters exist, every test mocks them. | <ul><li>No post-to-account ownership check.</li><li>No publish credit action.</li><li>The cron authorization is on this base only, not on origin/main.</li></ul> |
| Community | Implemented, partly integrated. | <ul><li>B-7 `proveActingAccount` does not exist.</li><li>The token picker selects by recency.</li><li>The do-not-engage writer has no production caller.</li><li>No credit action.</li></ul> |
| Browser Automation (a transport under Community) | Implemented only. | <ul><li>GAP-03: an RPA reply can falsely report `executed`.</li><li>The extension's `confirmed` flag is client-asserted.</li><li>Extension results record no usage.</li><li>R-3 suspends ingestion.</li></ul> |

---

## 1. WS-3 Email

### 1.1 Matrix

#### Capability

- Internal and external dispatch with a frozen gate order: kill_switch, suppression, region, approval, rate_limit, transport [R] `backend/services/leadOutreachExecution/dispatch.ts:348-397`.
- The SES transport goes through the Supabase edge function `send-transactional-email` [R] `backend/services/leadOutreachExecution/emailTransport.ts:139`, `supabase/functions/send-transactional-email/index.ts:32-37`.
- A provider acceptance becomes `sent_unverified`, never `delivered` [R] `emailTransport.ts:350`.

#### Provider and account dependencies

- The platform has one SES identity [R] `backend/services/providerEvents/providerMessageResolver.ts:151-157`.
- Env var names:
  - `AWS_ACCESS_KEY_ID` and related [R] `supabase/functions/send-transactional-email/index.ts:16`.
  - `SES_SNS_TOPIC_ARNS` [R] `pages/api/webhooks/ses.ts:39,168`.
  - The unsubscribe token keys `OUTREACH_UNSUBSCRIBE_TOKEN_KEYS` [R] `backend/security/outreachUnsubscribeToken.ts:38`.
- Account items still needed:
  - The edge function deployed.
  - The SNS topic subscribed.
  - Per-tenant sender identities (WP4).

  These come from programme memory and are not verifiable from the repo [I].

#### Tenant identity proof

- A provider event resolves to exactly one tenant, task and attempt. It must be unanimous across every evidence row for the message id; otherwise it is refused [R] `providerMessageResolver.ts:205-235`.
- The tenant is DISCOVERED from the message id. This is safe only because the SNS signature and topic allow-list are verified first [R] `providerMessageResolver.ts:151-157`. Per-tenant identities are the authoritative replacement [I].

#### Authorization and consent proof

- Canonical `contact_governance_records` through `mayContact`, at dispatch [I, from the header of `backend/services/emailService.ts:36`].
- The unsubscribe link is HMAC-signed and tenant-bound [R] `backend/services/leadOutreachExecution/unsubscribeService.ts:63-78`.

#### Inbound and outbound path

- **Outbound:** dispatch → transport → edge function [R].
- **Inbound:** SES events only. Delivery, Bounce, Complaint and Reject arrive through the SNS webhook [R] `pages/api/webhooks/ses.ts`.
- **SES inbound mail and reply ingestion do not exist.** `pages/api/webhooks/` holds only `payments`, `razorpay-staging.ts` and `ses.ts`, and no receipt-rule or inbound parser exists [R by listing and grep].
- `replied` can therefore only be recorded through the operator outcome route [I].

#### Outcome evidence

- `outreach_delivery_evidence` and `outreach_outcomes` are append-only through a database trigger [R] `supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql:271-284`.
- Each has two idempotency keys [R] `supabase/migrations/20260915000000_ws3_feedback_ingestion.sql:58-88`.
- The mutable summary is `outreach_tasks.delivery_status`. It is now compare-and-set (section 1.4).

#### Retry and idempotency

- SNS retries on 5xx or 429 and treats any other status as final [R] `backend/services/providerEvents/sesProviderEventIngestion.ts:11-15`.
- Duplicates return 200. Governance is idempotent on the partial unique key [R] `backend/services/prospectIdentity/contactGovernanceWriter.ts:163-229`.
- Dispatch attempts carry an idempotency index [R] `supabase/migrations/20260914000000_ws3_external_dispatch.sql:30`.

#### Billing and usage

- No credit action for an outreach email. The `CreditAction` list holds no email, outreach or channel entry [R] `backend/services/creditDeductionService.ts:26-90`.
- Quota is reserved and reconciled, but only as a rate limit [R] `dispatch.ts:400-402`.

#### Verification level

- **Integrated.**
- Every test stubs the transport (e.g. `backend/tests/unit/wp3SesWebhook.test.ts:155-162`) [R].
- No sandbox evidence exists in the repo [I].

#### Remaining external dependencies

- Deploy and verify the edge function.
- Subscribe the SES configuration set to SNS, with the topic ARN in env.
- Leave the SES sandbox for the account (eu-north-1, per memory) [I].
- Per-tenant sender identities (WP4).
- An inbound mail product decision.

### 1.2 Where the complaint signal goes, traced

1. The normalizer maps Complaint to signal `delivered` and governance `complaint` on channel `*`, anchored to the target and the person [R] `backend/services/providerEvents/sesEventNormalizer.ts:166-180`.
2. `ingestFeedback` appends a `delivered` row to `outreach_delivery_evidence` with `transport_response` holding the SES type, the feedback type and the SNS id [R] `backend/services/leadOutreachExecution/feedbackIngestion.ts:285-321`.
   - It then advances the task's delivery status to `delivered` if the state machine allows.
3. `recordContactGovernance` writes `complaint` on `*` for the ADDRESS, and for the PERSON when the task has one [R] `sesProviderEventIngestion.ts:126-172`.
4. **`outreach_outcomes`: nothing.** The CHECK has no complaint value [R] `20260915000000_ws3_feedback_ingestion.sql:28-36`.
   - The orchestration journey reader already maps `complained` and `complaint` to `delivery.complained` [R] `backend/services/orchestration/journeyEvents.ts:60-63`.
   - That mapping is therefore unreachable today.
5. **Downstream mislabel (not fixed here, owned by Orchestration):**
   - `journeyEvents.ts:142-144` reads only `id, delivery_status, observed_at`, so a complaint-implied row surfaces as a second `delivery.confirmed`.
   - `feedbackSummary.ts:261-283` counts it in `byStatus.delivered` and `lastDeliveryAt` [R].
   - Both can now filter on `transport_response.deliveryInferredFrom = 'Complaint'`.

### 1.3 Unsubscribe

- `recordOutreachUnsubscribe` writes canonical governance `unsubscribe` on `*` [R] `unsubscribeService.ts:59-111`:
  - for the ADDRESS, and for the PERSON when the task has one;
  - with source `outreach_unsubscribe_link`;
  - with evidence `{attemptId, taskId, method, tokenKeyId}`.
- It writes **no** `outreach_outcomes` row.
- The governance rows are insert-only from every email path. Only two code paths can change them, and both only set `revoked_at` and `revoked_reason`, which keeps the row:
  - The operator `releaseSuppression` [R] `backend/services/execution/suppressionService.ts:723-742`.
  - Person erasure [R] `backend/services/prospectIdentity/personErasure.ts:250`.
- Proven by new tests: a later Delivery, Bounce, Complaint, reply, lifecycle move, or a repeat unsubscribe by the other method leaves the unsubscribe records byte-identical, and no UPDATE reaches an evidence store. See `backend/tests/unit/d7EmailEvidencePreservation.test.ts`.

**What the outcome row would need (SC-4).** The link path DOES know the task: `outreach_attempts.task_id` is read at `unsubscribeService.ts:66-78`. So for the email link the NOT NULL `task_id` is satisfiable today. The contract question is ownership and semantics, not the column. A row would be:

```
outreach_outcomes(company_id = token.organizationId, task_id = attempt.task_id,
  outcome_type = 'unsubscribed', derived = false, occurred_at = <request time>,
  source = 'provider_webhook' | 'manual'  -- no 'link' source exists in the CHECK,
  provider = null, provider_event_id = <token attempt + key id, for idempotency>,
  evidence = { method, tokenKeyId })
```

Open points for SC-4:

- `source` has no value for a recipient-initiated link. The CHECK is `provider_webhook|provider_poll|manual|import|derived|internal`.
- An unsubscribe that is NOT tied to a task (a list-level or global unsubscribe) cannot be recorded while `task_id` is NOT NULL.

### 1.4 Overwrites found and fixed (no migration)

| # | Overwrite | Fix | Test (fails without the fix) |
|---|---|---|---|
| E-1 | `advanceTaskState` decided from a stale task read and wrote `delivery_status` unconditionally (`setOutreachTaskState`). Two events for one task processed concurrently (SES publishes Delivery, Bounce and Complaint separately) could both pass the state machine from `confirmed`, and the later one overwrote the terminal fact (`bounced` ↔ `delivered`). | A compare-and-set on the read `delivery_status`: `advanceOutreachTaskDeliveryStatus` at `storage.ts:289`, used at `feedbackIngestion.ts:457`. The loser is refused and its evidence row is kept. | `d7EmailEvidencePreservation.test.ts`: "a BOUNCE that settled first…", "a DELIVERY that settled first…" |
| E-2 | A complaint or permanent-bounce restriction was written only AFTER the delivery evidence append succeeded. An evidence-table outage that outlasted SNS's bounded retries lost the restriction permanently, although the tenant, address and person were known. | Governance is attempted whenever the tenant resolved; on the ADDRESS even if the task read failed. The response still reports the evidence failure (503), so SNS retries. See `sesProviderEventIngestion.ts:78-118`. | `wp3SesWebhook.test.ts`: "an evidence WRITE failure is 503 — and the complaint restriction is STILL in force", "a PERMANENT bounce whose evidence write fails…", "a task READ failure still restricts the ADDRESS…" |
| E-3 | The complaint-implied `delivered` row could not be told apart from a delivery receipt without knowing SES's vocabulary. | `deliveryInferredFrom: 'Complaint'` in the evidence, at `sesEventNormalizer.ts:191`. | `wp3SesWebhook.test.ts`: "a complaint-implied delivery is labelled as an inference…" |

The existing assertion "an evidence WRITE failure is 503 and nothing is restricted" was **inverted** by E-2, deliberately, under the owner requirement that a complaint is a deterministic governance event. The 503 assertion is kept.

### 1.5 Not fixed (needs a schema change or another owner)

- **S-1, a schema change for Orchestration and Outreach to approve.**

  ```sql
  ALTER TABLE outreach_outcomes DROP CONSTRAINT outreach_outcomes_type_valid;
  ALTER TABLE outreach_outcomes ADD CONSTRAINT outreach_outcomes_type_valid CHECK (outcome_type IN (
    'opened','clicked','replied','meeting_booked','rejected','no_response','unsubscribed','converted','complained'));
  ```

  It also needs:
  - `BusinessOutcomeType` and `BUSINESS_OUTCOME_TYPES` (`backend/services/leadOutreachExecution/lifecycle.ts:126-130`) to gain `complained`;
  - `FEEDBACK_SIGNALS` (`feedbackIngestion.ts:76-86`) to stay WITHOUT it, because only the authenticated SES path should assert it;
  - the SES ingestion to append the outcome after the delivery row.

- **Logical-key collapse.** If SES stamps the Complaint at exactly the Delivery's timestamp, `uq_outreach_delivery_logical` collapses the complaint row as a duplicate. The governance row still carries the complaint evidence. Only S-1 removes this [R] `20260915000000_ws3_feedback_ingestion.sql:87-88`.
- **Stale lifecycle `status`.** Its write is guarded only through the delivery compare-and-set, not through its own predicate [R] `feedbackIngestion.ts:449-460`.
- **Resolution failures leave no restriction.** On `not_found` or `cross_tenant_mismatch` the tenant is unknown, so no restriction can be written [R] `sesProviderEventIngestion.ts:70-73`.
- **Operator release revokes complaints.** `releaseSuppression` on channel `*` revokes `complaint` and `unsubscribe` records alike. That is an operator act and the rows are kept [R] `suppressionService.ts:728-742`.

---

## 2. WhatsApp

Agent D made no code change (out of scope: cross-line conflict on `whatsappBroadcastService.ts`).

### 2.1 Matrix

#### Capability

- **Broadcast:** create → expand → enqueue → `processBatch` → POST to Meta Graph v22.0 [R] `backend/services/whatsappBroadcastService.ts:455`, types at `:511-527`. The template language is fixed to `en_US` (`:519`).
- **Journey adapter:** `backend/services/orchestration/whatsappEngineAdapter.ts:180-322`. `hasApproval: async () => false` (`:170`), so every step returns `approval_required` [R].
- **Operator routes:** `pages/api/whatsapp/broadcasts/index.ts:48-126`, `[id].ts:59-96` [R].
- **Third path:** `backend/services/platformAdapters/whatsappAdapter.ts:36-54` sends using env `WHATSAPP_PHONE_NUMBER_ID`, with no visible governance check [R]. Whether it is reachable is not established [I].
- **STOP opt-out:** `backend/services/whatsappOptOut.ts:37-59,97-125`, wired at `backend/queue/jobProcessors/whatsappWebhookProcessor.ts:126,146` [R].
- **UI bug:** `pages/whatsapp/broadcasts.tsx:203` sends `{phone_number}`, but the service reads `phone_e164` (`whatsappBroadcastService.ts:52-55,135`) [I, traced, not run].

#### Provider and account dependencies

- Meta app id and secret (`backend/auth/metaAuthService.ts:82-83`).
- `WHATSAPP_APP_SECRET` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (`pages/api/whatsapp/webhook/index.ts:21,28`).
- `PHONE_HASH_SALT` and `ENCRYPTION_KEY` (`whatsappBroadcastService.ts:37,89`).
- Redis.
- A WABA and phone number on `social_accounts` [R].

#### Tenant identity proof

- **Journey:** selects by `company_id` with a non-null `phone_number_id`, and refuses more than one [R] `whatsappEngineAdapter.ts:145-155`.
- **Operator path:** none. The body's `social_account_id` is never checked against the company [R] `index.ts:65-87`, `whatsappBroadcastService.ts:107-120,367-374`.
- **Fixed on another line, pending reconciliation CR-X-01:** `78d40bf33`.

#### Authorization and consent proof

- `mayContact` runs per recipient and fails closed [R] `whatsappBroadcastService.ts:389-424`.
- It passes `personId: null`, so person-anchored restrictions are not seen [R].
- Kill switch and channel controls apply on the journey path [R] `:281-288,354-365`.
- No opt-in record exists [I].

#### Inbound and outbound path

- Webhook verify uses a constant-time compare [R] `webhook/index.ts:27-34,65-77`.
- HMAC `X-Hub-Signature-256` is required and fails closed [R] `:49-60,84-86`.
- The webhook enqueues with a sha256 job id and returns 503 if not queued [R] `:96-117`.

#### Outcome evidence

- `whatsapp_broadcast_recipients` statuses, with delivery status moving forward only [R] `whatsappBroadcastService.ts:418-495,570-614`.
- The counter RPCs `increment_broadcast_counts` and `increment_broadcast_stat` are **undefined** in migrations and baseline, and their results are unchecked [R by grep] `:501,610`.

#### Retry and idempotency

- **A per-recipient send-once claim EXISTS:** `pending → sending` compare-and-set [R] `whatsappBroadcastService.ts:440-451`.
- Uncertain outcomes become `send_uncertain` and are never retried [R] `:468-495`.
- Retry job ids include `Date.now()`, so they are not deduplicated [R] `:552`.
- **L-4 stands:** `enqueueOrThrow` cannot tell a refusal from a lost acknowledgement [R] `backend/middleware/queueBackpressure.ts:324-326`.
  - The adapter marks the request `failed` / `needs_human` while the job may still be in Redis [R] `whatsappEngineAdapter.ts:311-318`.

#### Billing and usage

- `increment_wa_usage` is called at `backend/services/whatsappRateLimiter.ts:105`, with the error ignored (`:109`). It is **undefined** in every migration [R by grep].
- Plan limits are hard-coded (`:40-44`).
- The journey always uses plan `free` [R] `whatsappEngineAdapter.ts:46`.
- No credit deduction [R].

#### Verification level

- Implemented, partly integrated.
- **No path reaches Meta at this base:**
  - operator: 400 (WA-1);
  - processBatch: throws (WA-2);
  - ids never written (WA-3);
  - journey: refused.

#### Remaining external dependencies

- A Meta app and a verified webhook.
- A WABA and number written to `social_accounts`.
- A system-user token stored through `tokenStore`.
- Approved templates.
- A Meta test number for the sandbox.
- The tenant approval capability (B-6) [I].

### 2.2 Prior findings re-verified at this base

| ID | Verdict | Evidence |
|---|---|---|
| WA-1 operator POST 400 | **CONFIRMED** | `enforceRole` is called without `companyId` at `pages/api/whatsapp/broadcasts/index.ts:72`, `[id].ts:60` and `pages/api/whatsapp/templates/index.ts:62`. `backend/services/rbacService.ts:608-611` then answers 400 `companyId required` [R]. |
| WA-2 auth/schema mismatch | **CONFIRMED, narrowed** | `metaAuthService.ts:70` selects `auth_client_id_ref` and `auth_client_secret_ref`. They exist only in the unapplied `database/whatsapp_system.sql:20-21`, not in any migration or the baseline. The select fails and `:74` throws "Social account not found". The write side (`:226-230`) is fine [R by subagent read, spot-checked]. |
| WA-3 ids not persisted | **CONFIRMED** | The columns exist (`supabase/_schema/baseline.sql:23116-23117`). The readers are `whatsappEngineAdapter.ts:151`, `whatsappBroadcastService.ts:369-374` and `whatsappTemplateService.ts:96-100`. **No writer** exists under backend or pages [R by grep]. |
| "No per-recipient send-once claim" | **NOT CONFIRMED (changed)** | The claim exists at `whatsappBroadcastService.ts:440-451` [R]. |
| L-4 ambiguous enqueue | **CONFIRMED** | See Retry and idempotency above. The re-enqueue reuses `wa-batch-<id>-<n>` (`:259`), and BullMQ deduplicates only while the earlier job exists. The claim still stops a double send to the same recipient [I]. |
| `increment_wa_usage` undefined | **CONFIRMED** | `whatsappRateLimiter.ts:105`, no SQL definition [R by grep]. |

### 2.3 Fixed on another line, pending reconciliation CR-X-01

These commits are on `integration/fixes-r3-on-main-23a0a586` and were not cherry-picked.

| Commit | What it does | Status vs this base |
|---|---|---|
| `78d40bf33` sender ownership | Adds `loadOwnedSenderAccount`, which selects by id AND `company_id`. `create`, `enqueue` and `processBatch` refuse a mismatch. Routes answer 404 or 503. | Needed. It touches `whatsappBroadcastService.ts:103-120,182,367-374`, `index.ts:90-93`, `[id].ts:68-69` and `templates/index.ts`. It does **not** fix WA-1. |
| `a0867dd08` blocked status | It stops writing text into the integer `error_code`. | **Already equivalent here** at `whatsappBroadcastService.ts:415-421`. Reconcile by taking either side. |
| `7097594ee` k1 reader | `decryptPhone` delegates to `decryptCredential`, which reads legacy and k1 and tries the previous key. | Needed. It touches `:24,97-103`. Its message claims per-recipient decrypt-failure handling, but that is **not in the diff**. On this base `:396` is outside any try. |

### 2.4 Ordered WhatsApp fix plan

1. **CR-X-01 reconcile:**
   - Land `78d40bf33` (sender ownership) and `7097594ee` (k1 reader).
   - Drop `a0867dd08` as equivalent.
   - Add the missing per-recipient decrypt-failure handling at `:396`.
   - Prerequisite: the owner rules on the `whatsappBroadcastService.ts` conflict.
2. **L-4, ambiguous enqueue:**
   - `enqueueOrThrow` (or a WhatsApp wrapper) must return `refused | accepted | unknown`.
   - The adapter and route must record `unknown` as `send_uncertain`/`needs_reconciliation` rather than `failed`.
   - A re-enqueue must first check for an existing `wa-batch-<id>-*` job or for recipients past `pending`.
3. **Send-once hardening:**
   - The claim exists. Make retry job ids deterministic (`:552`).
   - Add a regression test that two batches containing one recipient send once.
   - Pass the task's `personId` to `mayContact` so person-anchored restrictions are seen (`:389-424`).
4. **WA-2:** add `auth_client_id_ref` and `auth_client_secret_ref` by migration (coordinator-owned), or drop them from the select at `metaAuthService.ts:70`.
5. **WA-3:** a writer for `phone_number_id`, `waba_id` and `messaging_tier` in the Meta connect/onboarding flow, with a tenant check. This is a prerequisite for any real send.
6. **Usage RPCs:** define `increment_wa_usage`, `increment_broadcast_counts` and `increment_broadcast_stat` by migration, and check their errors. Until then the rate limiter's DB layer and the counters are inert.
7. **WA-1 LAST:** pass `companyId` to `enforceRole` at `index.ts:72`, `[id].ts:60` and `templates/index.ts:62`.
   - This makes the operator path reachable, so it must follow steps 1-6.
   - Fix the UI field `phone_number` → `phone_e164` (`pages/whatsapp/broadcasts.tsx:203`) at the same time.
8. **Journey:** replace `hasApproval: async () => false` with the B-6 approval capability. This is an owner decision.
9. **Billing:** a channel credit action (C-BL-1).
10. **Sandbox:** a Meta test-number run.

---

## 3. Social Publishing

#### Capability

- One entry point, `publishToPlatform` [R] `backend/adapters/platformAdapter.ts:67,237-285`.
- Real HTTP publish calls exist for these platforms [R]:
  - LinkedIn: `linkedinAdapter.ts:232`.
  - X: `xAdapter.ts:93,196`.
  - Facebook: `facebookAdapter.ts:340,495`.
  - Instagram: `instagramAdapter.ts:212,246,282`.
  - YouTube: `youtubeAdapter.ts:249-302`.
  - TikTok: `tiktokAdapter.ts:104`.
  - Pinterest: `pinterestAdapter.ts:66,85`.
- Suno and StarMaker are stubs [R].
- Mock mode is refused in production [R] `platformAdapter.ts:125-137`.

#### Provider and account dependencies

- Per-platform OAuth apps (`backend/auth/*`).
- `ENCRYPTION_KEY` [R] `backend/auth/credentialEncryption.ts:23-28`.
- `CRON_SECRET` [R] `pages/api/cron/process-scheduled-posts.ts:16`.
- Redis/BullMQ.

#### Tenant identity proof

- **Immediate:** post owner or super-admin [R] `pages/api/social/publish.ts:56-58`.
- **Cron and worker:** the tenant comes from `social_accounts.company_id` [R] `process-scheduled-posts.ts:148-209`, `publishProcessor.ts:115-117`.
- **Gap:** nothing checks that the post's `social_account_id` belongs to the post's user or company [I, by grep].

#### Authorization and consent proof

- `authorizePostPublish` is defined at `lib/campaign/publishAuthorization.ts:115`.
- Callers [R]:
  - `pages/api/social/publish.ts:206`;
  - `publishProcessor.ts:496`;
  - `schedulerService.ts:218`;
  - `orchestration/socialPostPublicationStatus.ts:111`;
  - **`pages/api/cron/process-scheduled-posts.ts:117`**.
- The cron line is on this base (commit `d8d79b743`) and **absent on origin/main `23a0a5864`** [R by diff].

#### Inbound and outbound path

- **Outbound:** route, worker, scheduler or cron → `publishNow` (`publishNowService.ts:523,950`) [R].
- **Inbound:** no social webhooks. Comments are pulled through `pages/api/social/comments.ts:4-15` [R].

#### Outcome evidence

- `platform_post_id`, `post_url` and `published_at` on `scheduled_posts` [R] `publishNowService.ts:952-957`, `backend/db/scheduledPostsStore.ts:30-52`.
- Plus an audit log [R] `:982-991`.

#### Retry and idempotency

- A fenced claim, `claimScheduledPostForPublish` [R] `publishNowService.ts:380-436`.
- An early return if `platform_post_id` is already set [R] `:571`.
- The cron idempotency key is per minute bucket [R] `process-scheduled-posts.ts:194`.
- An error after the call is never marked `not_sent` [R] `platformAdapter.ts:236,296`.

#### Billing and usage

- None on any publish path [I, by grep].
- `auto_post` (2 credits) is used for estimates only [R] `creditDeductionService.ts:29,89`, `campaignCostEstimator.ts:68,85`.

#### Verification level

- **Integrated.** Every test mocks the provider or uses the cert fake publisher [R] `certFakePublisher.ts:12-18`.

#### Remaining external dependencies

- App review and write scopes per platform.
- X paid write access [I].
- The TikTok audit.
- A live publish per platform.

---

## 4. Community

#### Capability

- `executeAction` [R] `backend/services/communityAiActionExecutorRuntime.ts:315`.
- Modes: manual, rpa, browser, and api with a single fallback to browser [R] `:702-762`.
- Real API connectors [R] `platformConnectors/linkedinConnector.ts:69`, `twitterConnector.ts:47`.
- DMs are refused in every mode [R] `:605-610`.

#### Provider and account dependencies

- OAuth tokens through `getToken` → `resolveSocialAccountIdForOrg`. This picks the most recently updated active account of any org member, and accepts `company_id IS NULL` [R] `platformTokenService.ts:45-67`.

#### Tenant identity proof

- The claim is tenant-scoped [R] `communityAiActionExecutorRuntime.ts:850-857`.
- **The acting account is not proven.** `proveActingAccount` (B-7) **does not exist in code**. It is found only in docs (`docs/outreach/inventory/engine4-community.md:94,109`, `docs/outreach/platform/FOUNDATION-COMPLETION-REGISTER.md:73`) [R by grep].

#### Authorization and consent proof

- D-01: `approved_at` is required and `auto_insert` is refused [R] `Runtime.ts:384-410,576-588,843-857`.
- The L-3 recipient recheck fails closed [R] `communityRecipientRecheck.ts:186-219`.
- Kill switch [R] `Runtime.ts:548-571`.
- The do-not-engage writer `recordSocialDoNotEngage` (`communitySocialDoNotEngage.ts:70`) has **no production caller** [R by grep].

#### Inbound and outbound path

- **Outbound:** connector, RPA or browser.
- **Inbound:** browser ingestion is suspended by R-3 [R] `backend/services/extensionIngestionSuspension.ts:28`.

#### Outcome evidence

- `persistExecutionResult` writes by compare-and-set [R] `Runtime.ts:159-313`.
- API mode gives `executed` only on `verified`, otherwise `sent_unverified` or `uncertain` [R] `communityAiActionExecutorContracts.ts:557-585`.

#### Retry and idempotency

- Atomic claim [R] `Runtime.ts:825-862`.
- Deterministic idempotency key [R] `:218-268`.
- Terminal rows are never revived [R] `:231-239`.

#### Billing and usage

- `checkUsageBeforeExecution('automation_executions')` and the usage meter [R] `Runtime.ts:92-117,647-659,781`.
- No credit action. `reply_generation` covers AI generation, not the action [R] `creditDeductionService.ts:33`.

#### Verification level

- **Implemented, partly integrated.** No sandbox or production evidence.

#### Remaining external dependencies

- The B-7 decision.
- Platform write scopes.
- A do-not-engage entry point (UI or API).

## 5. Browser Automation (a transport under Community)

#### Capability

- **Server Playwright:** `reply` and `like` on FB, IG, X, Reddit and LinkedIn [R] `backend/services/rpaWorker/rpaPlaywrightRunner.ts:241-246`, `rpaWorkerService.ts:152-169`.
- **Extension:** commands are claimed through the `claim_community_ai_browser_command` RPC (`pages/api/extension/commands.ts:367`) and closed by `pages/api/extension/action-result.ts` [R].

#### Provider and account dependencies

- An encrypted platform session per (org, platform) [R] `rpaSessionStore.ts:8-37`.
- Chromium on the worker.
- Extension 1.4.1, which is a local release candidate only [R] `FOUNDATION-COMPLETION-REGISTER.md:56`.

#### Tenant identity proof

- The RPA session is keyed by org and platform only [R] `rpaSessionStore.ts:9`.
- The extension lease is `hash(userId:orgId:nonce)` with an org check [R] `action-result.ts:142-145,204-206`.
- **Nothing binds the session to the action's account (B-7).**

#### Authorization and consent proof

- The same executor gates apply.
- The extension rechecks DM safety and L-3 before the claim [R] `commands.ts:218,319-356`.
- The claim RPC's SQL was not read [I].
- The URL policy runs before navigation and again after redirects [R] `rpaPlaywrightRunner.ts:204-214,251-258`.
- Event signing (R-1) [R] `pages/api/extension/events.ts:29-41`, `backend/middleware/extensionAuthMiddleware.ts:104-119`.
- The dev bypass applies only outside production [R] `:58-97`.

#### Inbound and outbound path

- **Outbound** as in Capability.
- **Inbound** collection is blocked by R-3 [R] `events.ts:16`, `events/dms.ts:175`, `events/comments.ts:128`, `engagement/platform-sync.ts:214`.

#### Outcome evidence

- **GAP-03 CONFIRMED.**
  - `confirmed = true` by default [R] `rpaPlaywrightRunner.ts:270`.
  - It is cleared only by a failed `selector_visible` [R] `:271-278`.
  - Success maps to `executed` [R] `communityAiActionExecutorContracts.ts:644-650`.
  - The reply post-conditions match content that already existed before the submit, as the code itself admits [R] `rpaPlatformScripts.ts:29-33`.
- **Extension:** `executed` only if the client sends `confirmed === true`, otherwise `sent_unverified` [R] `action-result.ts:251-253`. The server never verifies the client flag [R].

#### Retry and idempotency

- In-process retry only when provably not acted [R] `rpaTaskQueue.ts:24-29`.
- The reaper moves rows to `uncertain` [R] `backend/scheduler/cron.ts:739-746`.
- The extension uses `Idempotency-Key` and a lease compare-and-set [R] `action-result.ts:208-216,361-370`.

#### Billing and usage

- RPA goes through `runExecution` usage logging [R].
- **Extension results record no usage** [R] `action-result.ts:43-49`, `Runtime.ts:764-781`.
- No credit action [R].

#### Verification level

- **Implemented only.**

#### Remaining external dependencies

- Platform terms and legal approval (F-1) [R] `extensionIngestionSuspension.ts:24-26`.
- The 1.4.1 rollout.
- Playwright on the worker.
- Live sessions.
- B-7.

---

## 6. Cross-engine: billing (C-BL-1)

No channel has a credit action for an outbound action. The `CreditAction` list (`backend/services/creditDeductionService.ts:26-90`) has `auto_post`, but it is only used for estimates, and `reply_generation`, which covers AI generation. It has nothing for:

- an email send;
- a WhatsApp message;
- a social publish;
- a community action.

The billing owner needs to define, per channel:

- the action name;
- the unit, which is a provider-accepted action and not a dispatch attempt;
- when it is charged: on `sent_unverified`/`executed`, never on `uncertain`;
- the idempotency key: attempt id, recipient claim id or post id.

## 7. Method and limits

- Email is read first-hand.
- WhatsApp, Social, Community and Browser Automation were researched by read-only sub-agents. Their key claims were spot-checked first-hand:
  - WA-1;
  - `increment_wa_usage`;
  - the WhatsApp claim;
  - the journey `hasApproval`;
  - the absence of `proveActingAccount`;
  - the cron `authorizePostPublish` line;
  - GAP-03 `confirmed = true`.
- Other line numbers from sub-agent reads are cited as reported and were not individually re-opened.
- No provider, sandbox, SES or Meta call was made.
- No migration was written.
