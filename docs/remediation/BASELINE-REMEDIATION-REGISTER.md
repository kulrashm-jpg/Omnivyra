# Baseline remediation register

**Branch:** `remediation/baseline-20261110`
- Parent: `001f79a3f70f1b2c06ce28027a9b2ec4a47842c1`, the verified candidate, preserved at `refs/preserve/verified-candidate-001f79a3f`.
- The tree was clean at creation.

**Source of every row:** the combined T2 on `001f79a3f`, logs in the Outreach session scratchpad `t2g/logs-t2rulc`, plus three read-only diagnosis passes and the fixes below.

**Release:** NO-GO. Nothing is pushed, merged or deployed, and production is untouched.

## 0. Counting

| Source | Reported | Distinct |
|---|---|---|
| Real-database (`jest.realschema.config.js`) | 10 | 10. One suite; the whole-repo run does not execute it |
| Integration (`backend/tests/integration`) | 6 | 0 new. All 6 are among the 72 whole-repo failures |
| Whole repository | 72 | 72 |
| **Test failures** | 88 | **82** |
| Test-code typecheck (`tsconfig.backend-tests.json`, net-new against its baseline) | 52 | 52 |
| Migration quality (`check-migration-quality.js`) | 23 | 23. Two whole-repo tests (`govHMigrationControls`, `sec91FMigrationQuality`) are this gate seen through a test, so they are counted once, here and in §1 |

**Owner column.** "UNASSIGNED" means no accountable owner is named among the active sessions; the programme owner must name one. A workstream is given where the history identifies it. Outreach = virality-6f (this register's maintainer).

## 1. Test failures (82)

| ID | Tests (file:line) | Error | Root cause | Class | Capability | Workstream / owner | Correction | Regression tests | Status / evidence |
|---|---|---|---|---|---|---|---|---|---|
| **RC-Q** | `realschema/pi_email_send_path_041a` ×10 (L834, 871, 887, 910, 1100, 1122, 1158, 1172, 1199, 1335) | Exceeded timeout 60000 ms | `quota.ts` reuses the shared BullMQ Redis client (`maxRetriesPerRequest: null`, offline queue, endless reconnect). With Redis down, `redis.incrby` is queued and never rejected, so `reserveQuota` and every outreach dispatch hang; the documented database fallback never runs (`dispatch.ts:314` → `quota.ts:197` → `bullmqClient.ts:388`) | **Application** (latent in prod: Redis present) | Outreach dispatch, quota | **Outreach** (WS-3) | The fast path issues a command only while the client's status is `ready`; no timer (WS-3 rule) | `ws3QuotaRedisUnavailable` (9 cases). Mutant without the check: 8/9 fail | **RESOLVED** in `b4a592074`. 041a: 45 passed / 3 skipped with no Redis and no test mock. 69/69 outreach unit suites pass. **PI-040 re-pin `4ba2b0435` PENDING PI ACCEPTANCE** |
| **RC-P** | `integration/recommendation_engine` ×22; `integration/company_context_contract`:170; `unit/recommendationFallbackSignal` ×2; `integration/campaign_health`:189; `unit/campaignChatBlueprint`:177; `unit/aiRuntimeFinalValidation` ×9; `unit/generateWorkspaceContentCharacterization` ×4; `integration/community_ai_core_apis` ×3 (also integration) | 401 from OpenAI with the placeholder key, then circuit breaker OPEN; 500s (`Failed to fetch company profile: fetch failed`); timeouts; brand_voice 'professional' | 2026-07-14 canonical-grounding refactor (`2b23e7a0b`, `dac9abbfa`, `fd0d31e4b`, `107c21d1f`): consumers read the profile via `canonicalProfileAdapter.getCanonicalProfile`, which imports `companyProfileServiceRest1Rest2Pulse` directly. The tests still mock the `companyProfileService` barrel, so the real read runs. Before `49717e80a` (2026-09-13) the tests loaded `.env.local` (production) and passed by **reaching live services**. Recommendation suites also auto-refine through a real OpenAI call | **Test-code** (stale mock target) plus a hermeticity defect | Recommendations, campaign AI, AI runtime billing (S1–S12), workspace content, community AI | Context / canonical-grounding track (CONTENT-INTELLIGENCE-003/007/009); test owner WORKSTREAM-2L. **UNASSIGNED** | Mock `context/canonicalProfileAdapter` (`getCanonicalProfile`) in the 8 files; remove the 2L supabase bridge; no assertion change | Assert the mocked seam is called; a jest-wide guard that throws on any non-loopback request | OPEN: diagnosed, not implemented |
| **RC-G** | `integration/content_pipeline` ×3 (L103, 122, 149) | Two 30 s timeouts; `[pricingService] … fetch failed` | The AI gateway path does unmocked database reads and writes: pricing pre-flight (`aiGatewayProvidersOps.ts:358`, `b8e11af07`), `company_llm_configs` (`0465edcc9`, `17d869b48`), `cost_anomalies`/`alerts`. About 7 s each against a dead local Supabase | **Test-infrastructure** | Content generation via the AI gateway | AI gateway / billing track. **UNASSIGNED** | Mock the pricing, credential-policy and usage-ledger modules, ideally through one shared hermetic gateway mock helper | The egress guard; a check that the gateway makes zero `supabase.from` calls in this suite | OPEN |
| **RC-R** | `integration/unified_content_generation` ×10 | `Connection is closed.` ×8; timeouts at L296/L310 | A real BullMQ `Queue` and `contentFeedbackLoop` need a live Redis. The suite sits in the default jest project and was never in CI | **Environment + test-infrastructure** (not gated like `realschema/`) | Content-generation queue | Content generation / queue track. **UNASSIGNED** | Move it to its own jest project with a Redis service (like `jest.realschema.config.js` with `real-schema-ci.yml`), and ignore it in the default project. The tests are relocated, not skipped | The suite running green in that project | OPEN. Needs a CI design decision |
| **RC-T** | `unit/trustGracefulDegradation`:105 | Expected 'measured', got 'unavailable' | `bf0dae45` (2026-09-30, REMEDIATION-002) deliberately stopped publishing platform-activity brand trust as `measured`. `report1ProvenanceBoundaryOrigin.test.ts:132-145` asserts `unavailable` for the same input. The two tests contradict each other | **Test-code** (superseded contract) | Report 1 trust dimension | Report 1 track. **UNASSIGNED** | Owner decision: restate case 1 as "unavailable, with reason", or retire it with evidence and a replacement. Never loosen it | The restated case | OPEN. **Needs programme approval** (obsolete-test rule) |
| **RC-K** | `integration/community_ai_scheduling`:134; `integration/community_ai_webhooks`:135 (both also integration) | 'pending' instead of 'executed'; webhook not called | Fixtures push the old tokenStore `{access_token}`. Tokens moved to `social_accounts` (`47b0b1b76`, 05-01), so with no token the browser mode leaves the result 'pending', and PLATFORM_NOT_CONNECTED is non-terminal | **Test-code** | Community AI scheduling, webhooks | Community AI (Orchestration engine-adapter line?). **UNASSIGNED** | `seedConnectedAccount`; the connector mock may need a verified outcome | — | OPEN |
| **RC-E1** | `integration/external_api_service`:224 | Expected 403, got 405 | `handleExternalApisPost` returns undefined after its guard has sent 403, so the route shell writes 405 over it: **a double response in production** (`indexMutations.ts:52,59`; `indexShared.ts:73-76`; `pages/api/external-apis/index.ts:24-27`; since `b80513454`, 07-09) | **Application** | External API sources (admin) | **UNASSIGNED** | Handlers return true once a guard has responded, or the shell checks `headersSent` | Exactly one 403 for a non-admin; a 401 case | OPEN |
| **RC-E2** | `integration/external_api_service`:277 | Expected 200, got 403 | Super-admin is an active `user_company_roles` row (`a98b2ba37`, 09-15). The in-module `isSuperAdmin` mock cannot take effect | **Test-code** | External API health | **UNASSIGNED** | Seed an active SUPER_ADMIN row; keep a non-admin 403 case | — | OPEN |
| **RC-E3** | `integration/external_api_service`:319 | Called 2 times, expected 1 | The supabase mock lacks `maybeSingle`; `getHealthForSource` catches the error and returns null, so reliability defaults to 1 | **Test-infrastructure** (and see A-1) | Trend fetching | **UNASSIGNED** | Add `maybeSingle` to the mock | — | OPEN |
| **RC-H** | `integration/community_ai_webhooks`:176 (also integration); `integration/campaign_ai_history`:70 | TypeError reading 'idempotency-key' / 'authorization' | The mock request has no `headers`. `execute.ts:124` (`b8e11af07`) reads them, and `requireCampaignAccess` was added in `9629f5fee` (05-12), after the test | **Test-code** | Community AI execute; campaign AI history | **UNASSIGNED** | `headers: {}`; mock access to allow | A deny → 403 test | OPEN |
| **RC-S** | `unit/dg001ConsumerContract` L250, L262; `unit/unionSerpRouting`:93 | +4 / +3 call sites | **Real rule violations:** direct SerpAPI calls in `publicResearch/aiAnswers.ts:192,205` (`42b659754`, PR #335) and `publicResearch/searchResults.ts:83`, with their own parser at L51 (`7b66a314b`, PR #346). `providerChecks.ts:74` (`account.json`) is legitimate but unsanctioned. `dossierV2/diagnostics.ts` is a scanner false positive (prose) | **Application** (DG-001 rule) plus a scanner defect | Public research / SERP | Public-research (Report 1 snapshot/evidence) track. **UNASSIGNED** | Route through `fetchCanonicalSerp` (extend it for google_ai_mode/bing_copilot, or have the owner sanction them); sanction `providerChecks`; tighten the scanner to `\b(fetch\|axios)\s*\(` | The existing pins, updated by the owner | OPEN. **Needs owner sanction decision** |
| **RC-I** | `unit/groupAIdempotencyAdoption`:103 | +6 outside the sanctioned set | 2 real adopters needing approval: `prospect-sources/discovery.ts` (`dcfd873ae`, PR #322) and `prospect-campaigns/[id]/execution-instances.ts` (`02cc5dfb4`, Orchestration). 2 false positives: comments in `erasure-requests/index.ts:28` and `prospects/[id]/problems.ts:54` | Stale inventory + **test-code** (substring match) | Idempotency middleware governance | PI (discovery) / Orchestration (execution-instances). **UNASSIGNED** | Approve the 2 adopters; match the import/call, not a substring | — | OPEN. **Needs approval** |
| **RC-M** | `unit/metaGraphApiVersionConsistency`:118 | 0 found | The adapter uses `GRAPH_VERSION = 'v22.0'` plus a template literal (`e2d7e09f8`, PR #308). The version is still v22.0, so there is no real drift | **Test-code** (scanner) | Meta Graph publishing | Social publishing. **UNASSIGNED** | The scanner reads the constant, or one shared exported constant | — | OPEN |
| **RC-RP** | `unit/routePolicyInventoryScript`:94 | Expected 10, got 11 | New public route `pages/api/indexnow-key.ts` (`5c1bd9790`, 10-26, SEO IndexNow) | Stale inventory | Route policy | SEO / route-policy. **UNASSIGNED** | Update the inventory to 11 and assert names rather than a count | — | OPEN. **Needs approval** |
| **RC-MQ** | `unit/govHMigrationControls`:288; `unit/sec91FMigrationQuality`:253 | 40-line violation list; gate exit 1 | The 23 GD-4 violations, §3 | Migration quality | Migration integrity | See §3 | GD-4 | The two tests themselves | OPEN, blocked (§3) |

**Totals:** 10 (RC-Q) + 43 (RC-P) + 3 + 10 + 1 + 2 + 1 + 1 + 1 + 2 + 3 + 1 + 1 + 1 + 2 = **82**.
- **Resolved: 10.** Open: 72.
- The integration subset is RC-P ×3, RC-K ×2 and RC-H ×1.

## 2. Test-code typecheck diagnostics (52)

| ID | Diagnostics | Files | Cause | Workstream / owner | Correction | Status |
|---|---|---|---|---|---|---|
| TC-1 | 6 (TS2554 ×4, TS2493, TS2322) | `unit/d02JourneyApprovalRoute`, `unit/orchJourneyHoldD03` | Zero-argument `jest.fn` mocks; `status: string` helper | **Outreach** | Typed mock parameters; `OutreachTaskStatus` | **RESOLVED** `d28bf1731`. Scoped tsc shows 0 errors in both files; 78/78 tests pass |
| TC-2 | 12 (TS2451) | `unit/typecheckBaselineGate`, `unit/backendTestsTypecheckBaselineGate` | Both files are scripts (CommonJS `require`, no import/export), so their top-level `const`s share global scope. Collision since `0d194ef4b` (2026-11-02); **also on main** | CI / release tooling. **UNASSIGNED** | `export {};` in each file, making them modules. No behaviour change | OPEN (one-line fix, waiting for an owner) |
| TC-3 | 3 (TS2339 `reason`) | `helpers/communityApprovalEvidenceFixture`, `realschema/helpers/c3ClaimFixtures`, `unit/communityApprovalBinding` | `if (!r.ok) … r.reason` does not narrow the `{ok:true}\|{ok:false;reason}` union under `strict: false` | Community / Orchestration Prompt 3 (`47a8c5388`) | `if (r.ok === false)` | OPEN |
| TC-4 | 6 (TS2339, TS2345) | `integration/community_ai_action_connectors` | The action fixture type lacks `id` and the full action shape | Community / Orchestration Prompt 3 | Type the fixture as the action type | OPEN |
| TC-5 | 16 + 1 + 1 | `unit/communityExecutionSafety.executor` (TS2345 ×16), `.rpa` (TS2322), `unit/engagementRequestIdempotencyDurable` (TS2339) | Partial action fixtures passed as `CommunityAiAction`; `Promise<never>` mock typing | Community / Orchestration engine-adapter line | Typed fixture builder | OPEN |
| TC-6 | 2 + 3 | `unit/orchestrationCommunityAdapter` (TS2554, TS2698), `unit/orchestrationCommunityAdapterGates` (TS2554 ×3) | The adapter gained a 4th parameter | Orchestration | Pass the 4th argument | OPEN |
| TC-7 | 2 | `realschema/orch_journey_lifecycle`:417, `realschema/orch_response_matrix`:137 | `prospect_lifecycle_closed` read from `unknown` | Orchestration | Type the read row | OPEN |

**Totals:** 6 + 12 + 3 + 6 + 18 + 5 + 2 = **52**. Resolved: 6. Open: 46.

Production typecheck (`typecheck-ci`) and worker typecheck **pass** on `001f79a3f`. They must be re-run on the final remediation head.

## 3. Migration-quality violations (23): GD-4

The plan is `docs/outreach/platform/GD4-MIGRATION-RENUMBERING-PLAN.md` §9 on `outreach/foundation-base-20261104` (heads `4adc89839`, `e670d2073`, `d3f9b146f`).

| Item | Files | Owner (by introducing commit) | Production | Proposed action | Status |
|---|---|---|---|---|---|
| MQ-1 | `20261127000000_pi_prospect_lists` | PI (`6a6c3d9b8`) | **Applied out-of-band** (objects, columns and the migration's own COMMENT present; no ledger row). Completeness and **privileges unmeasured** | Keep in place; record as production-applied in the registry **and the attestation** | **BLOCKED:** PI owner not named; programme decision on how history records it; authorization for a read-only privilege check |
| MQ-2 | 17 files #2–#18 | Orchestration by commit (12 feat(orchestration) + 5 on its integration line) | Not applied | Atomic rename to `20270111100000`… (band stays below `20270112000000`) | **BLOCKED:** the programme owner's ruling on `pi_*` ownership (virality-55 deferred to it) |
| MQ-3 | `20261231000010_rpa_legacy_session_invalidation` | Orchestration integration line (`1b96251f6`) | Unverifiable (marker-row count would settle it) | Not filename-only: it embeds its version as data. RPA-owner decision (slug literal) | BLOCKED: owner |
| MQ-4 | `20270120000000`, `…0001`, `…0002` | Orchestration (`9daf1cc5e`, `a25abddce`, `f7ff85d04`) | Not applied | Registry `occupied_elsewhere` → `reserved` (same blob carried forward) | BLOCKED: Orchestration sign-off (GD4-2 approved in principle) |
| MQ-5 | `20270113000000` | PI/privacy A6-10 (`1cea7cf2f`); two different blobs | Not applied | GD4-3 held | HELD by the programme owner |

## 4. Application issues found during diagnosis (no failing test)

| ID | Issue | Evidence | Owner | Status |
|---|---|---|---|---|
| A-1 | A failed external-API health read counts as **fully reliable** (fail-open) | `getHealthForSource` (`dbHelpers.ts:107-132`) catches and returns null; `trendFetching.ts:252` defaults to 1 | UNASSIGNED | OPEN |
| A-2 | Duplicate `getHealthForSource` | `externalApi/internalHelpers.ts:219` | UNASSIGNED | OPEN |
| A-3 | RC-Q residual: a quota command already in flight when the connection drops is re-queued and waits for reconnect | ioredis with `maxRetriesPerRequest: null` | Outreach | OPEN. The full fix (a dedicated client with `commandTimeout`, or a timer exception to the WS-3 rule) needs a decision |
| A-4 | `whatsappRateLimiter` uses the same shared-client pattern as quota; probably the same hang | `whatsappRateLimiter.ts:53` | Outreach | OPEN: to verify |
| A-5 | `prospect_lists` / `prospect_list_members` in production: anon/authenticated privileges unmeasured; no table REVOKE; policies without TO | MIG-2R finding 2 | PI | **Needs authorization** for a read-only `has_table_privilege` check |
| A-6 | Test suites historically passed against **production** through `.env.local` (before `49717e80a`) | RC-P | Test infrastructure. UNASSIGNED | Recommend a jest-wide non-loopback egress guard |

## 5. Implementation commits on this branch

| Commit | Change | Owner | Evidence |
|---|---|---|---|
| `d28bf1731` | TC-1: typing of 2 Outreach tests | Outreach | Scoped tsc 0 errors; 78/78 |
| `b4a592074` | RC-Q: quota skips a disconnected Redis; `ws3QuotaRedisUnavailable` test | Outreach | 041a 45/0/3; unit 9/9; mutant 8/9 fail; 69/69 outreach unit suites |
| `4ba2b0435` | PI-040 re-pin of `quota.ts` only | **PENDING PI ACCEPTANCE**; drop it if refused | 69/69 |

**T2 on the combined remediation head: NOT YET RUN.** It runs once related workstreams land.
