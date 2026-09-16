# SEC91-D — AI / billing / provider-spend security (STEP 3AH-91)

**Base:** `main @ f44b1387` (PR #245 merged) · **Branch:** `sec/3ah91-d-ai-billing` · **Goal:** a tenant request must not cause uncontrolled platform spend or cross-tenant provider activity.

Production facts taken as given (not re-verified): `BILLING_REQUIRE_AI_HANDLE` is unset in Vercel production (billing guard shadow-only); `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are platform keys; companies may hold BYOK rows in `company_llm_configs`.

## 1. Inventory

Line numbers are on base `f44b1387`.

| ID | Sev | Finding | Current status (evidence) | Classification | Files | Fix | Tests | Conflict risk |
|---|---|---|---|---|---|---|---|---|
| D1a | P1 | LLM/paid-provider routes without authentication | #245 added auth. Re-verified: the route gate passes; 33 routes import an AI sink directly, plus 3 that `fetch` provider hosts directly (claude-chat, gpt-chat, voice/transcribe). All 36 authenticate before the provider call. No non-authenticating allowlist kind (public, auth-flow, health, retired, redirect-shim, webhook, machine-token) reaches an AI sink within import depth ≤6. The ones that do are `machine-secret` crons (`cron/*`, `internal/render-*`), which authenticate with a machine secret and belong to SEC-C. | ALREADY FIXED (#245) | — | — | route gate; `routeAuth001AiContent*` | none |
| D1b | P1 | AI guard per-IP key taken from the client-written first `x-forwarded-for` hop | `claude-chat.ts:54,192`, `gpt-chat.ts:31`, `voice/transcribe.ts:45` | FIX | `backend/services/ai/trustedClientIp.ts` (new), the 3 routes, `aiRequestGuard.ts` (doc) | `resolveTrustedClientIp`: reads Vercel edge-set `x-real-ip` / `x-vercel-forwarded-for` only when `VERCEL=1`, else the TCP peer. An operator can name one header with `TRUSTED_CLIENT_IP_HEADER`, but never `x-forwarded-for`. | `sec91DAiRouteSpend` | low |
| D1c | P1 | Authenticated routes not keyed by user; guard errors fail open | gpt-chat and transcribe passed no `userId`, so the guard inferred "background" (`aiRequestGuard.ts:260`) and skipped the user/company/burst layers. claude-chat's route limiter was keyed `user:ip`. Routes did `catch → continue` (`claude-chat.ts:67`). | FIX | 3 routes | `userId` (and the bound `companyId`) are passed. claude-chat's limiter is keyed by user only. A non-`AiGuardError` escaping the guard now returns 503 `AI_GUARD_UNAVAILABLE` and the provider is never called. The guard still absorbs Redis/limiter outages internally, as designed. | `sec91DAiRouteSpend` | low |
| D1d | P2 | Gateway calls from HTTP routes are classified "background" | The gateway guard (`aiGatewayProvidersOps.ts:85`) takes `userId` from the ALS request context. That context is set only by `requireTenantAccess` / `requireAuthenticatedInternalUser`, not by `getSupabaseUserFromRequest` or `enforceCompanyAccess`. So most interactive gateway calls skip the per-user, per-company and burst layers. | Cross-workstream proposal (§6.2) | — | — | — | — |
| D2 | P2 | Gateway credit guard is shadow-only. Enforcement would break billed calls. | `runBilledAiCompletion.ts:138` checks the guard with a handle, then calls `runCompletionWithOperation`, which checks again without one (`aiGatewayProvidersOps.ts:625`). Every billed call is logged as `untracked_ai_call_blocked`, and `BILLING_REQUIRE_AI_HANDLE=true` would block the billed paying-customer path itself. | FIX (safe part) + MANUAL OPERATION REQUIRED (enforcement) | `billing/aiGatewayBillingGuard.ts`, `billing/runBilledAiCompletion.ts` | The credit handle is carried in an `AsyncLocalStorage` scope (`runWithCreditHandle`), bound to its org. Behaviour in shadow mode is unchanged except fewer false anomalies. | `sec91DGatewaySpend` (D2) | low |
| D3 | P2 | claude-chat platform mode: any signed-in user spends the platform Anthropic key with no attribution or ledger. gpt-chat runs platform-key moderation before checking BYOK. | `claude-chat.ts:72`; `gpt-chat.ts:46` before `:55` | FIX | `pages/api/ai/claude-chat.ts`, `pages/api/ai/gpt-chat.ts` | Platform mode → 403 `PLATFORM_MODE_DISABLED` before any limiter, guard or provider work. The only in-repo UI caller (`components/MultiAIChat.tsx`) is not mounted anywhere. BYOK is unchanged. gpt-chat returns 400 without a key before moderation or the guard. | `sec91DAiRouteSpend` (D3) | low |
| D4 | P2 | BYOK bypass: a keyless (or undecryptable) company config gets the platform key plus its chosen model, skipping plan and cost gates | `aiGatewayProvidersOps.ts:127`; `llmProviderService.ts:273`. Any COMPANY_ADMIN can save a model with no key (`pages/api/company/llm-config.ts:160`). | FIX | `aiGatewayCredentialPolicy.ts` (new), `aiGatewayProvidersOps.ts`, `aiGatewayCore.ts`, `llmProviderService.ts` | `selectCredentialBoundModel`: the company model is honoured unconditionally only on the company's own key. On the platform key it must pass `resolveEffectiveModel` and `evaluateJobCost` unchanged; otherwise the platform default provider serves the already-gated request model. An unusable stored key is flagged `byokUnavailable`, logged without key material, and recorded in the audit row. | `sec91DGatewaySpend` (D4), `sec91DByokKeyResolution` | low |
| D4-R | P3 | BYOK rate-limit fallback uses the platform key | `aiGatewayProvidersRetry.ts:103`: on 429/overload of a BYOK key, the fallback provider runs on the platform key (documented "BYOK not applied to fallback") | MANUAL OPERATION REQUIRED (product decision, §7.4) | — | — | — | — |
| D5 | P3 | Direct provider paths bypass the gateway; no timeouts; abandoned image calls keep retrying | `openAIRenderProvider.ts:113,124,146`: raw fetches with no timeout. `signalEmbeddingService.ts:26`: SDK default 10-minute timeout. `creatorAssetRendererMedia.ts:219,300,371`: a race against the budget with no cancellation, and the SDK (default `maxRetries=2`) retries timeouts, so an abandoned image could be generated and billed up to 3 more times. | FIX (cheap parts) + documented | `openAIRenderProvider.ts`, `signalEmbeddingService.ts`, `creatorAssetRendererMedia.ts` | AbortSignal timeouts (render 120 s, reference 20 s). Embeddings client `timeout: 30 s`. The image SDK calls get an AbortSignal that is aborted when the race settles. Already in place: intelligence adapters go through `fetchProduction` (per-provider `withTimeout` + the `authorizeProviderCall` cost governor + `recordProviderUsage`); image cost is captured by `captureImageProviderCost`; embeddings write usage events. | `sec91DProviderHardening`, `sec91DImageProviderCancel` | low |
| D6 | P3 | AI cache exact key and in-flight coalescing key omit whose credential produced the answer | `aiResponseCache.ts:302`; `aiGatewayProvidersOps.ts:222` | FIX | `aiResponseCache.ts`, `aiGatewayProvidersOps.ts`, `aiGatewayCredentialPolicy.ts` | BYOK calls are scoped `byok:<companyId>` in the exact key, the coalescing key and the near-match v3 entry (`s`). Platform-key keys are byte-identical to before, so there is no cold-cache event and the v3 index is untouched. | `sec91DGatewaySpend` (D6) | low |
| D7 | P3 | Prompt-injection hardening is opt-in; chat moderation fails open | No LLM tool execution exists: no `tools:`, `tool_choice`, `function_call` or `tool_use` in backend, lib or pages/api. `promptSafety` is adopted in 44 files. Moderation fails open at `aiGatewayProvidersOps.ts:908`. | FIX (isolated: fail-open is now counted) + INTENTIONALLY ACCEPTED | `aiGatewayProvidersOps.ts` | `ai.moderation.fail_open` counter. Moderation stays fail-open: it is a content-quality filter, not an authz boundary. | `sec91DGatewaySpend` (D7) | low |
| D8 | P3 | Gemini API key sent as a URL query parameter | `aiGatewayTransports.ts:277`; `geminiAdapter.ts:108` | FIX | both files | Key moves to the `x-goog-api-key` header. | `sec91DProviderHardening` (D8) | low |
| D9 | P3 | Missing timeouts; SDK retries nested under gateway retries | claude-chat, gpt-chat and transcribe fetches had no timeout. `aiGatewayCore.ts:526,531,841,903`: SDK default `maxRetries=2` under `callProviderWithRetry` (`aiGatewayProvidersRetry.ts:396`). | FIX | routes, `aiGatewayCore.ts` | AbortSignal timeouts (chat 90 s, Whisper 120 s, AssemblyAI 60/15 s). `resolveOpenAiSdkMaxRetries`: SDK `maxRetries: 0` whenever `AI_GATEWAY_RETRY_TRANSIENT` is on, i.e. whenever the gateway owns transient retries. With the flag off (production default) the SDK's retries are the only transient retries and are left unchanged. | `sec91DAiRouteSpend` (D9), `sec91DGatewaySpend` (D9) | low |

## 2. Fixes: before / after

- **D1b/c (routes).** Before: the guard's IP was `x-forwarded-for[0]` (client-chosen off Vercel). gpt-chat and transcribe had no user key, and a guard exception meant the provider call went ahead. After: IP from `resolveTrustedClientIp`; `userId` (and the bound company) always passed; claude-chat limiter key `user:<id>`; an unexpected guard error returns 503 with no provider call. Tests: `sec91DAiRouteSpend › SEC91-D1 *` (18 tests).
- **D3.** Before: `credentialMode:'platform'` → platform `ANTHROPIC_API_KEY` for any signed-in user; gpt-chat moderated on the platform key before rejecting a missing key. After: platform mode → 403, with no limiter, guard or provider call and the platform key never sent; BYOK works as before; gpt-chat returns 400 before moderation. Tests: `sec91DAiRouteSpend › SEC91-D3 *` (7).
- **D4.** Before: a keyless company config choosing `claude-opus-*` on a free plan → Anthropic platform key + opus. After: the gates downgrade it and the platform default (`openai` + gated model + platform OpenAI key) serves the call. An enterprise plan that allows the model keeps it. BYOK keeps its model on its own key. A decrypt failure is flagged and logged and never buys the premium model. Tests: `sec91DGatewaySpend › SEC91-D4 *` (6), `sec91DByokKeyResolution` (4).
- **D6.** Before: a BYOK tenant's answer (generated on its key) could be served from cache or coalesced to another tenant, and vice versa. After: they are isolated; platform-key keys equal the legacy sha256; two platform tenants still share the exact cache. Tests: `sec91DGatewaySpend › SEC91-D6 *` (4).
- **D2.** Before, with `BILLING_REQUIRE_AI_HANDLE=true`: `runBilledAiCompletion` threw `BILLING_REQUIRED`. After: billed calls execute; an unbilled call is still blocked before the provider; a handle for org A does not vouch for a call attributed to org B. Tests: `sec91DGatewaySpend › SEC91-D2 *` (3).
- **D7.** Moderation provider failure → still allowed, and `ai.moderation.fail_open` is counted. Test: 1.
- **D8.** The key no longer appears in the URL (gateway transport and adapter); it is sent in the header. Tests: 2.
- **D5/D9.** Every direct provider request carries an AbortSignal. Abandoned image SDK calls are aborted (`signal.aborted === true` after the budget). The embeddings client has `timeout: 30000`. `callOpenAi` sends `maxRetries: 0` when the gateway owns transient retries and omits it otherwise. Tests: `sec91DAiRouteSpend › SEC91-D9 *` (4), `sec91DProviderHardening` (3), `sec91DImageProviderCancel` (2), `sec91DGatewaySpend › SEC91-D9 *` (2).

**Reproduced on base** (fix source files swapped back to their base versions, new tests kept):
- route suite: 18 failed / 8 passed;
- gateway + BYOK suites: 12 failed / 8 passed;
- provider + image suites: 6 failed / 1 passed.

Every test that passed on base pins preserved legitimate behaviour: BYOK flows, plan-allowed enterprise use, platform defaults, successful image generation.

**Mutation checks** (revert one fix, run its suite, restore). Each was caught:

| Mutation | Result |
|---|---|
| D4: honour the company model without the gate | 3 fail |
| D4: drop the decrypt flag | 2 fail |
| D6: no credential scope | 2 fail |
| D2: ignore the ambient handle | 1 fail |
| D7: no counter | 1 fail |
| D9: SDK retries never zeroed | 2 fail |
| D1: XFF first hop as the IP | 6 fail |
| D1: gpt-chat without userId | 1 fail |
| D1: claude-chat fail-open | 1 fail |
| D3: platform mode allowed | 2 fail |

## 3. Commands run and results

- New suites: `backend/tests/unit/sec91D*.test.ts` — 5 suites, 53 tests, all pass.
- Affected existing suites, final run: 20 suites / 354 tests pass. This covers `routeAuth001AiContent`, `routeAuth001AiContentObjects`, `aiRequestGuard`, `aiGatewayBillingGuard`, `activityWorkspaceCreditAuthzSec001`, `aiCacheContainmentP0`, `aiCacheTenantScopingContract`, `platformWave2/3/4`, `gatewayTransportSeams`, `geminiAdapterGatewayAdoption`, `creatorConditionReferenceGate`, `platformEmbeddingB78C2`, `certificationRemediation`, and the new suites.
- A broader sweep (every suite that references a changed module: 27 gateway/cache suites + 30 image/embedding/Gemini suites) is also green, except the pre-existing failures below.
- **Pre-existing failures, identical on base `f44b1387`:**
  - `providerIdentityAdapterAdoption` (6)
  - `perplexityAdapterCapabilityAdoption` (18)
  - `perplexityAdapterGatewayAdoption` (6)
  - `copilotAdapterGatewayAdoption` (1)
  - `integration/company_context_contract` (1)
- **Gates, all PASS:**
  - `node scripts/check-route-auth.js`
  - `node scripts/check-tenant-authz.js`
  - `npm run -s check:ssrf`
  - `node scripts/check-migration-quality.js`
  - `node scripts/check-withrbac-binding.js`
  - `node scripts/check-orgaccess-binding.js`
- **TypeScript:**
  - Full `tsc -p tsconfig.backend-tests.json --noEmit --incremental false`: 8 errors were in the new test files (`ProcessEnv` casts) and are fixed. None were in changed source files. The remaining 260 errors are in files outside this change set.
  - Scoped `tsc` (a scratch config extending `tsconfig.backend-tests.json` over all changed and new files plus their transitive imports): **0 errors**.

## 4. Commits (branch `sec/3ah91-d-ai-billing`)

- `b15f27d` fix(ai): trusted client IP, user-keyed limits and platform-key refusal on direct AI routes
- `26cba5c` test(ai): type-safe ProcessEnv fixtures in SEC91-D route spend suite
- `17d869b` fix(ai-gateway): credential-bound model selection, BYOK cache isolation, billed-handle propagation
- `139871e` fix(ai-providers): Gemini key in header, bounded direct-provider calls, cancel abandoned image calls
- (this document is committed separately)

## 5. Files changed

**New:**
- `backend/services/ai/trustedClientIp.ts`
- `backend/services/aiGatewayCredentialPolicy.ts`
- `backend/tests/unit/sec91DAiRouteSpend.test.ts`
- `backend/tests/unit/sec91DGatewaySpend.test.ts`
- `backend/tests/unit/sec91DByokKeyResolution.test.ts`
- `backend/tests/unit/sec91DImageProviderCancel.test.ts`
- `backend/tests/unit/sec91DProviderHardening.test.ts`
- `docs/security/SEC91_D.md`

**Modified (all SEC-D-owned):**
- `pages/api/ai/claude-chat.ts`
- `pages/api/ai/gpt-chat.ts`
- `pages/api/voice/transcribe.ts`
- `backend/services/ai/aiRequestGuard.ts` (doc only)
- `backend/services/aiGatewayCore.ts`
- `backend/services/aiGatewayProvidersOps.ts`
- `backend/services/aiGatewayTransports.ts`
- `backend/services/aiResponseCache.ts`
- `backend/services/llmProviderService.ts`
- `backend/services/billing/aiGatewayBillingGuard.ts`
- `backend/services/billing/runBilledAiCompletion.ts`
- `backend/services/intelligence/adapters/geminiAdapter.ts`
- `backend/services/creator/rendering/providers/openAIRenderProvider.ts`
- `backend/services/creatorAssetRendererMedia.ts`
- `backend/services/signalEmbeddingService.ts`

**Existing tests updated:** `backend/tests/unit/aiCacheContainmentP0.test.ts` and `backend/tests/unit/aiCacheTenantScopingContract.test.ts`. They are source-regex contracts that pinned the exact cache-call argument lists. The D6 fix appends a credential-scope argument, so the regexes now require it; the tenant argument is still required unchanged.

**Files outside my ownership:** none. `scripts/route-auth-allowlist.json` is not modified.

## 6. Cross-workstream proposals (not applied)

### 6.1 Trusted IP everywhere (SEC-E, with SEC-A/SEC-B for their routes)
Promote `resolveTrustedClientIp` to `lib/security/` and replace the remaining `x-forwarded-for`-first-hop derivations (about 50 server files still read the header). Examples:
- `backend/security/TenantGuard.ts:515`
- `backend/security/requireCapability.ts:249`
- `backend/services/superAdminSession.ts:86`
- `pages/api/auth/{login,signup,reset,check-user,check-domain,accept-invite,resend-*,totp/*,passkeys/*,step-up/verify,...}`
- `pages/api/team/invite.ts:24`
- `pages/api/website-events/track.ts:59`
- `pages/api/website/lead-capture.ts:35`
- `backend/services/{signupEventService,requestAccessService}.ts`

On Vercel today the edge overwrites XFF, so the exposure is off-Vercel runtimes. The code should not depend on that.

### 6.2 Principal in the request context (SEC-A; `supabaseAuthService` / `userContextService`)
After a successful `getSupabaseUserFromRequest` / `enforceCompanyAccess`, call `setPrincipal({ userId, orgId })` (`lib/platform/requestContext`). The gateway's `guardAiRequest` would then apply the per-user, per-company and burst layers to interactive gateway calls instead of inferring "background" (`aiRequestGuard.ts:260`).

This must be staged. Multi-call pipelines in a single HTTP request (campaign planning, BOLT) would start hitting the burst limit (20/10 s) and 60/min per user. Ship behind a flag in observe mode (count what would be throttled) before enforcing.

### 6.3 `executeWithCredits` (unowned `creditExecutionService*`)
Wrap its gateway calls in `runWithCreditHandle(...)` (new export of `billing/aiGatewayBillingGuard.ts`) so those billed calls also stop registering as untracked. This is a prerequisite for §7.1.

### 6.4 API keys in URLs (SEC-E / unowned)
Where the provider supports a header, move these keys out of the query string:
- `backend/services/companyIntelligence/providers/adapters/index.ts:188` (hunter.io `api_key=`)
- `backend/services/imageService.ts:416` (`?key=`)
- `backend/services/reviews/reviewConnectors.ts:91` (Google Places `key=`)

### 6.5 SSRF gate alias gap (SEC-F / SEC-E)
`scripts/check-outbound-ssrf.js` matches only `fetch(`, `axios.*(` and `http(s).request(`. The injected alias `doFetch(referenceUrl)` in `openAIRenderProvider.ts:118` is invisible to it. Proposal: flag any `\b\w*[fF]etch\s*\(\s*<identifier>` call, or route that reference fetch through `safeFetch` when no `fetchImpl` is injected. Today the URL is server-constructed (`creatorWorkspacePersistence.ts:342`) but travels via persisted `production.reference_image_url`.

## 7. MANUAL OPERATION REQUIRED

### 7.1 D2 — enforce `BILLING_REQUIRE_AI_HANDLE` (product decision + env flag)

**Blast radius.** `runCompletionWithOperation` has 102 calling files. Every call without a credit handle whose operation is not in `credit_untracked_actions` will throw `BILLING_REQUIRED` once enforced. That includes Railway worker jobs, which run the same code with no HTTP credit scope (for example `backend/queue/jobProcessors/campaignPlanningProcessor.ts` → `backend/services/batchAiProcessor.ts` → `runCompletionWithOperation`). Before this branch, the billed `runBilledAiCompletion` path itself would also have thrown.

**No safe code-only enforcement exists:**
- "Enforce only for unattributed calls" would break system operations that are unattributed by design.
- "Cap unattributed platform-key use" has no production telemetry to size a cap against. The guard's per-operation (240/min) and per-provider (1500/min) caps already bound it.

**Steps:**
1. Deploy this branch (billed calls stop producing false anomalies) and §6.3.
2. For at least 7 days, collect `billing_anomaly` log events with `kind=untracked_ai_call_blocked` (Vercel and Railway logs) and group them by `operation`.
3. For each operation, either migrate it to `runBilledAiCompletion` / `executeWithCredits`, or insert a `credit_untracked_actions` row with a justification and approver (super-admin tooling; the table is immutable per migration `20260663`).
4. When a full business cycle shows zero unexplained anomalies, set `BILLING_REQUIRE_AI_HANDLE=true` in **both** Vercel production and the Railway worker service, then redeploy both. Env changes take effect only on new deployments.
5. **Verify:** smoke-test each billed route (`campaign-content/assist`, `creator-templates/chat-brief`, `creator-templates/field-assist`, activity-workspace content); no `enforced: true` anomalies for legitimate operations; worker queues drain.
6. **Rollback:** remove the variable and redeploy.

### 7.2 D9 — single retry loop (optional, ops)
Setting `AI_GATEWAY_RETRY_TRANSIENT=1` moves transient 5xx/timeout retries into the gateway loop (1 retry, with backoff and metrics). With this branch it also zeroes the SDK's own retries automatically. Net effect for OpenAI transient failures: at most 2 attempts instead of today's 3 SDK attempts.
- Where: Vercel and Railway, then redeploy.
- Verify: `ai.gateway.retry{class=timeout|server}` counters appear; the OpenAI error rate does not rise.

### 7.3 D1 — non-Vercel deployments only
Any deployment not on Vercel that sits behind a proxy must set `TRUSTED_CLIENT_IP_HEADER` to the one header its proxy overwrites. Otherwise the per-IP layer keys on the proxy's address. Production (Vercel) needs no action.

### 7.4 D4-R — BYOK rate-limit fallback onto the platform key (product decision)
Today a BYOK company whose own key returns 429/overload is served by the fallback provider on the **platform** key (`aiGatewayProvidersRetry.ts:103`), using the first registered model for that provider. The usage is attributed to the company but paid by the platform.

Proposed patch (not applied, because it changes BYOK behaviour from "degrade to platform" to "surface the provider error"): pass the credential mode into `callProviderWithRetry` and skip `getFallbackConfig` when the primary call used a company key. Decide, then apply in `aiGatewayProvidersRetry.ts` (SEC-D).

### 7.5 D3 — platform-key Claude chat
If product wants it, build it as a gateway operation billed through `runBilledAiCompletion` (tenant-attributed, credit-held), not by re-enabling the route's platform mode.

## 8. Remaining limitations

- **D1d is open** until §6.2 lands. Gateway calls from routes that authenticate without `requireTenantAccess` get only the per-operation and per-provider global caps from the AI guard. Credits and plan/cost gates still apply.
- **D2 enforcement is off** (§7.1). Calls through `runCompletion` (not `WithOperation`) never consult the billing guard at all.
- **D7:** prompt-injection containment is still opt-in per call site (44 adopters). Moderation remains fail-open, with a counter. Impact is limited to generated content because no tool execution exists.
- **D5:** intelligence adapters, the creator renderer and embeddings still call providers outside the gateway. They are bounded (timeouts, the `fetchProduction` cost governor, cost capture) but not credit-held by the gateway. The render provider's reference fetch is not SSRF-guarded (§6.5).
- **D9:** with the production default (transient retry off), OpenAI 429s are still retried by the SDK (2 retries) and then once by the gateway. That multiplies latency, not spend, because 429s are not billed.
- **D6:** platform-key cache entries stay shared across tenants (unchanged, by design). Prompt normalisation strips UUIDs and timestamps, so two tenants' prompts that differ only in those tokens share an entry.
- **Testing scope:** all tests are hermetic (mocked providers and DB). No live provider call and no production check was made.
