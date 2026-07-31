# OmniVYRA — AI Model Orchestration Readiness Audit (Phase 1)

**Type:** Implementation-readiness assessment. **No code was modified.** Analysis only.
**Question answered:** *Can OmniVYRA support centralized AI model management through an Admin Console without significant architectural refactoring?*
**Date:** 2026-07-31. **Basis:** direct code read of the gateway + capability stack, four parallel evidence sweeps (bypass hunt, consumer inventory, config/DB surface, Chrome extension), and the canonical AI-architecture docs (`docs/ai-architecture/*`).

---

## 1. Executive Summary

**Verdict: YES — with medium effort, not a rewrite.** OmniVYRA already has ~80% of the target orchestration architecture built and in production. The desired layering (`Feature → Gateway → Capability → Provider → Model → Execution Params → Response`) is not aspirational here — most of it exists as shipped, tested code:

- **One mature chat gateway** (`aiGatewayCore` + `aiGatewayProviders*`) that ~130 consumer files already route through. It owns model resolution, per-company config, cost estimation, plan-tier routing, caching, in-flight coalescing, concurrency pools, provider token buckets, retry, cross-provider fallback, usage ledger, and audit logging — all centralized.
- **A per-tenant DB config layer already exists** (`llm_providers`, `llm_models`, `company_llm_configs` with encrypted BYOK keys) plus super-admin and company REST endpoints. The gateway reads it live (`resolveLlmConfig`). *The only missing admin piece is the React UI.*
- **A capability abstraction already exists** (`aiCapability/` — AIC-001): a frozen `CAPABILITY_REGISTRY` maps ~15 capabilities to `{ defaultModel, temperature, maxOutputTokens, maxRetries, timeoutMs, fallbackModel }` plus knowledge/validation/output contracts, executed through a runtime that delegates to the gateway. This is the desired capability→config→provider chain — just hardcoded in TypeScript instead of DB-backed.
- **The multi-provider dispatcher and transports are built** (`aiGatewayDispatcher`, `aiGatewayTransports`): OpenAI, Anthropic, Gemini, and Perplexity transports are implemented (Copilot is a stub); provider capability + identity registries (PB-004/PB-006) are complete.

**The gaps are integration and externalization, not foundation:**
1. The **live generation path is provider-locked to OpenAI + Anthropic** (`callProviderWithRetry` is typed `'openai' | 'anthropic'`); the multi-provider dispatcher is built but **dormant** on the generation path.
2. **Execution parameters (temperature, max_tokens) are not externalized at all** — ~40+ scattered literals at call sites, no DB column.
3. **Prompts are inline per feature** — no central template registry (the gateway only carries optional prompt-hash *metadata*).
4. **Capability config is hardcoded** (frozen TS), and the `aiCapability` framework is only partially adopted (PMF-migrated features).
5. **Sibling/bypass seams** exist for non-text AI (image gen ×2, embeddings, Whisper) and two legacy chat routes — architecturally acknowledged, but outside the config plane.
6. **Two provider vocabularies** (`openai/anthropic/...` vs `chatgpt/claude/...`) must be reconciled (mapping already written: PB-006).

**Readiness score: 7.5 / 10. Refactoring effort: Medium.** The Admin Console is achievable primarily by (a) adding a config table for execution params + capability routing, (b) resolving that config inside the existing gateway funnel, (c) wiring the dormant dispatcher into the live path, and (d) building the admin UI over endpoints that largely already exist.

---

## 2. AI Call Inventory

### 2.1 The gateway funnel (chat/text — centralized)

**Core executor:** `executeGatewayCompletion` — `backend/services/aiGatewayProvidersOps.ts:54`, exported as `runCompletion` (`:500`). Every chat call converges here. Pipeline order:

`beta-mock → guardAiRequest → resolveEffectiveModel (tiering) → evaluateJobCost (block/downgrade) → resolveLlmConfig (per-company DB + BYOK) → in-flight coalescing → checkUsageBeforeExecution → cache lookup → assertModelPricingExists → callProviderWithRetry → cost/usage ledger + meter + audit-log → cache store`

**Public entrypoints features call:**
| Entrypoint | File | Use |
|---|---|---|
| `runCompletionWithOperation(req & {operation})` | `aiGatewayProvidersOps.ts:542` | Generic — most services; adds billing-guard check |
| Typed wrappers (`generateRecommendation`, `previewStrategy`, `generateCampaignPlan`, `generateDailyPlan`, `generateDailyDistributionPlan`, `optimizeWeek`, `generatePrePlanningExplanation`, `suggestDuration*`, `moderateChatMessage`) | `aiGatewayProvidersOps.ts:502-831` | Per-operation typed calls |
| `runBilledAiCompletion` | `billing/runBilledAiCompletion.ts:49` | Credit reserve→execute→confirm wrapper over the gateway |
| `runAiExecution` | `ai/aiExecutionRuntime.ts:131` | Interactive-AI lifecycle (REQUESTED→…→COMPLETED) with resume/retry |
| `capabilityModelRunner.defaultModelRunner` | `aiCapability/capabilityModelRunner.ts:37` | Capability framework → delegates to `runCompletionWithOperation` |

**Provider transports (live):** `callOpenAi` (`aiGatewayCore.ts:799`), `callAnthropic` (`:1121`) — both stream + non-stream. Live selection: `aiGatewayProvidersRetry.ts:177` `p === 'anthropic' ? callAnthropic : callOpenAi`.

**Multi-provider transport (built, generation-dormant):** `dispatchTransport` (`aiGatewayDispatcher.ts:155`) → `aiGatewayTransports.ts` (gemini/perplexity/copilot). Consumed only by the **intelligence visibility adapters** behind per-provider flags.

### 2.2 Consumer count

**~133 non-test source files import an `aiGateway*` module** (backend/services 65, pages/api 29, lib/newsletter 17, lib/blog 15, lib/content 4, misc 3). Corroborates the canonical figure of "103 consumers, zero chat bypass" (ADR-001). Order of magnitude confirmed.

### 2.3 Operations by product area (~80 distinct `operation` names)

- **Company Profile / Intelligence:** `refineProblemTransformation`, `inferProblemTransformation`, `profileEnrichment`, `profileExtraction`, `defineTargetCustomer`, `defineCampaignPurpose`, `defineMarketingIntelligence`, `defineContextIntelligence`, `suggestCompetitors(Understanding)`
- **Recommendations:** `generateRecommendation`, `generateCampaignRecommendations`, `generateLongFormRecommendations`
- **Campaign Planning:** `generateCampaignPlan`, `parsePlanToWeeks`, `optimizeWeek`, `previewStrategy`, `prePlanningExplanation`, `suggestDuration`, `refineCampaignIdea`; **Daily:** `generateDailyPlan`, `generateDailyDistributionPlan`, `parseRefinedDay`
- **Activity Workspace / Content:** `generateMasterContent`, `generateContentBlueprint`, `generatePlatformVariants`, `generateContentForDay`, `regenerateContent`, `generateContentVariant`, `refineVariant`, `generateContentAngles`, `parsePlatformCustomization`, `contentSuggestions`, `campaignContentAssist`
- **AI Chat / Planner:** `chatModeration`, `extractPlannerCommands`, `plannerSuggestUpdate`, `chat.gpt`, `chat.claude`, `blogCardChat`
- **Engagement:** `conversationTriage`, `conversationMemorySummary`, `responseGeneration`, `replyGeneration`, `engagement_reply_suggestions`, `sentimentClassification`
- **Blog:** `blogGeneration`, `blogOptimization`, `blogRepurpose`, `blogAnalyticsInsight`, `blockEnrich`; **Newsletter:** `newsletterGeneration`, `newsletterOptimization` (+ per-format runners)
- **Creator:** `creator.infographic.copy`, `creatorChatBrief`, `creatorFieldAssist`, `creator_intake_ai_content`, `creator_marketing_packaging`, `creator_template_intent`
- **Reports / MarketPulse (dispatchTransport path):** `visibility.probe.{chatgpt,claude,gemini,perplexity,copilot}`, `serp_query`, `search`, `review_aggregator`, `expertise_extractor`, `contentAnalysis`
- **Insights:** `generateContentIdeas`

### 2.4 Non-text capabilities

| Capability | Present | Location | Path |
|---|---|---|---|
| Structured JSON output | Yes (**OpenAI-only**) | `response_format:{type:'json_object'}` `aiGatewayCore.ts:159,897` | Gateway |
| Streaming | Yes (OpenAI + Anthropic SSE) | `aiGatewayCore.ts:822,951`; salvage via `GatewayPartialStreamError` | Gateway |
| Web-search grounding (citations) | Yes | Perplexity `citations[]` (`PERPLEXITY_CITATIONS_V1`); SERP via serpapi | dispatchTransport + direct |
| Image generation | Yes | `gpt-image-1`/`dall-e-3` — `creatorAssetRendererMedia.ts:235`, `creator/rendering/providers/openAIRenderProvider.ts` | **Direct SDK (bypass)** |
| Embeddings | Yes | `text-embedding-3-small` — `signalEmbeddingService.ts:79,171` | **Direct SDK (bypass)** |
| Audio / transcription | Yes | Whisper + AssemblyAI — `pages/api/voice/transcribe.ts:131` | **Direct (guarded)** |
| Vision (image input) | **No** | guard has `imageCount` hooks but nothing sends images | — |
| Tool / function calling | **No** | undeclared for all providers (`aiGatewayCapabilities.ts`) | — |

### 2.5 Direct-SDK / gateway-bypass call sites (coupling findings)

| # | Site | Provider / model | Note |
|---|---|---|---|
| B1 | `signalEmbeddingService.ts:79,171` | OpenAI `text-embedding-3-small` (1536-d) | Embedding sibling seam; own cost tracking |
| B2a | `creatorAssetRendererMedia.ts:160,235` | OpenAI `gpt-image-1`/`dall-e-3` | Primary live image path |
| B2b | `creator/rendering/providers/openAIRenderProvider.ts:120,142` | OpenAI images REST | Second image stack (durable queue) |
| B3 | `pages/api/voice/transcribe.ts:131` | Whisper `whisper-1` (+ AssemblyAI) | Guarded by `guardAiRequest` but not gateway |
| B4a | `pages/api/ai/gpt-chat.ts:62` | OpenAI **hardcoded `gpt-4`**, temp 0.7, 1000 tok, client-supplied key | Legacy chat route, own path |
| B4b | `pages/api/ai/claude-chat.ts:229` | Anthropic `claude-sonnet-4-6` (env), 1000 tok, own retry | Legacy chat route |
| B5 | `intelligence/adapters/{openai,anthropic,gemini,perplexity,copilot}Adapter.ts` | probe models (`gpt-4o-mini`, `claude-haiku-4-5`, `gemini-1.5-flash`, `sonar`, azure `gpt-4o-mini`) | **Gateway only when `*_ADAPTER_GATEWAY_TRANSPORT` flag ON; default OFF ⇒ direct HTTP** |
| B6 | `backend/evaluation/canonicalGrounding/liveRunner.ts:38`, `scripts/generate-ai-previews.ts:38`, `tmp_run_intelligence_evaluation.mjs` | OpenAI chat/images | Eval/build scripts (non-prod); `tmp_*` should be deleted |

### 2.6 Chrome extension — clean thin client (no finding)

`omnivyra chrome ext/extension` embeds **no AI keys and makes no direct LLM calls**. All AI is brokered by the backend: generated reply/DM text arrives via `/api/extension/commands`; data flows out via `/api/extension/events` + `/api/extension/action-result`. Outbound traffic is hard-gated by a fixed `ENDPOINT_ALLOW_LIST` (`background/serviceWorker.js:38`), HMAC-signed (`shared/requestSigner.js`), and `host_permissions` contains **no AI-provider hosts**. This is exactly the desired architecture.

---

## 3. Current AI Architecture

The canonical blueprint (`docs/ai-architecture/CANONICAL-AI-ARCHITECTURE.md`, 14 ADRs) already mandates a single gateway seam with image/embedding as sibling seams. Implemented state:

- **Provider gateway** — sole chat seam; barrel `aiGateway.ts` → `aiGatewayCore` (config/limits/transports OpenAI+Anthropic) + `aiGatewayProviders` (retry/fallback + operation entrypoints). Mature: streaming, abort/partial-salvage, per-pool concurrency (`drafting/alignment/refinement/repair/default`), distributed semaphore (Redis Lua) + provider token buckets, deterministic retry policy (`ai/safety/providerRetryPolicy.ts`), cross-provider fallback (`getFallbackConfig`).
- **Config plane** — `llmProviderService.ts` over `llm_providers` / `llm_models` / `company_llm_configs`; `resolveLlmConfig` wires per-company provider/model/BYOK into the funnel; `aiModelRouter.ts` applies plan-tier + usage downgrade.
- **Capability plane** — `aiCapability/` (AIC-001): `CAPABILITY_REGISTRY` + `aiCapabilityRuntime` (knowledge→planning→prompt→tools→grounding→validation→confidence→output) → `capabilityModelRunner` → gateway. Partial adoption.
- **Multi-provider plane** — `aiGatewayDispatcher` + `aiGatewayTransports` (gemini/perplexity live, copilot stub) + `aiGatewayCapabilities` (PB-004 capability registry) + `aiGatewayProviderIdentity` (PB-006 product↔platform id map). **Built, generation-dormant.**
- **Billing/observability** — `runBilledAiCompletion` (HOLD→EXECUTE→CONFIRM), `usage_events` ledger with per-outcome cost, `recordAi` metrics, OTLP spans per attempt, audit-log per call.
- **Safety** — `aiRequestGuard` (validation + layered rate limits + burst, fail-open); `ai/safety/*` (error classification, safe-parse, prompt-safety, moderation).

---

## 4. Configuration Inventory (hardcoded vs externalized)

**Externalized to DB** (`llmProviderService` + migrations `20260508_llm_provider_config.sql`, `20260508_company_llm_configs.sql`):
- `llm_providers(name, display_name, is_active)`
- `llm_models(provider_id, model_key, display_name, is_active, metadata jsonb)` — metadata already holds context_window + cost
- `company_llm_configs(company_id UNIQUE, provider_id, model_id, api_key_encrypted, is_active, updated_by)` — **per-tenant BYOK (AES-256-GCM)**
- Related: `llm_model_pricing` (`20260515_pricing_engine.sql`); broader `platform_rules_config`/`decision_engine_config`/… (`20260320_admin_config_tables.sql`)

**Externalized to env** (`config/env.schema.ts`): `OPENAI_API_KEY`, `OPENAI_MODEL`/`OPENAI_RESPONSES_MODEL` (default `gpt-4o-mini`), `OPENAI_TIMEOUT` (60s), `MAX_LLM_CONCURRENCY` (5), `ANTHROPIC_API_KEY`, `OMNIVYRA_AI_MODE`, `COST_REQUEST_THRESHOLD_USD`, `ENCRYPTION_KEY`. Pool sizes via raw `process.env.MAX_{DRAFTING,ALIGNMENT,REFINEMENT,REPAIR}_CONCURRENCY`.

**Still hardcoded:**
- **Temperature & max_tokens — everywhere, no DB column** (~40+ literals): gateway internals (`aiGatewayProvidersOps.ts:620,664,735,783`) plus scattered call sites (`activityWorkspace/contentRouteHandler.ts`, `blockEnrichEngine.ts:112`, companyProfile/*, engagement/*, creator/*, contentGeneration/*, etc.).
- **Default/fallback model constants**: `aiModelRouter.ts:23` `MINI_MODEL='gpt-4o-mini'`; `aiGatewayProvidersRetry.ts:100` `'claude-3-5-sonnet'`/`'gpt-4o-mini'`.
- **Capability config (frozen TS)**: `aiCapability/capabilityRegistry.ts` — per-capability `defaultModel/temperature/maxOutputTokens/maxRetries/timeoutMs/fallbackModel` (this is the *shape* to migrate to DB).
- **Intelligence probe models**: `intelligence/adapters/*` (`*_PROBE_MODEL` env with hardcoded defaults).
- **Legacy routes**: `gpt-chat.ts` `model:'gpt-4'`; `claude-chat.ts` env-defaulted.
- **Gateway timeouts/thresholds**: `LLM_PROVIDER_TIMEOUT_MS=30_000`, long-form 240s/120s cutoffs, token thresholds 8192/4096, Anthropic default `max_tokens 4096`, `anthropic-version '2023-06-01'`.
- **Cost/rate maps**: `blackHoleCostCapture.ts`, `liveRunner.ts`, reconciliation adapters.

---

## 5. Capability Inventory

**Formal capabilities already defined** (`aiCapability/capabilityRegistry.ts`): `CONTENT_WRITER`, `CONTENT_CREATOR`, `CAMPAIGN_PLANNER`, `STRATEGIC_MIX`, `SEO_INTELLIGENCE`, `GROWTH_INTELLIGENCE`, `RECOMMENDATION_ENGINE`, `COMPETITOR_INTELLIGENCE`, `WEBSITE_INTELLIGENCE`, plus migrated: `CONTENT_WRITER_WORKSPACE`, `LONG_FORM_CONTENT`, `CREATOR_ASSET`, `CAMPAIGN_PLAN`, `STRATEGIC_MIX_DECISION`, `RECOMMENDATION_DECISION`.

**Provider capabilities registry** (`aiGatewayCapabilities.ts`, PB-004): per-provider evidenced declarations for `textCompletion, streaming, structuredOutput, systemPrompt, seed, citations, search, imageGeneration` (+ undeclared: grounding/reasoning/provenance/safetyMetadata/toolCalling).

**Reusable capability abstractions latent across modules (reuse opportunities):**
| Reusable capability | Currently implemented separately in |
|---|---|
| JSON / entity extraction | profileExtraction, parsePlanToWeeks, extractPlannerCommands, chatKnowledgeExtraction |
| Content writing (short/long) | Writer, Creator copy, Blog, Newsletter, Activity Workspace, BOLT |
| Classification / moderation | chatModeration, sentimentClassification, conversationTriage |
| Business/strategy analysis | strategy profile, competitor intel, growth intel, recommendations |
| Summarization | conversationMemorySummary, blogAnalyticsInsight, prePlanningExplanation |
| Grounded research (web) | Perplexity visibility probes, SERP competitor intel |
| Embeddings / semantic | signalEmbeddingService, originality (dormant tier) |
| Image generation | creatorAssetRendererMedia, openAIRenderProvider |

These map cleanly onto the "Deep Reasoning / Content Writing / Classification / JSON Extraction / Research / Embeddings / Image Generation" capability taxonomy — consolidation under the `aiCapability` framework is the reuse win.

---

## 6. Coupling Analysis (per-feature migration effort)

| Integration | Effort | Why |
|---|---|---|
| All ~130 chat consumers of `runCompletionWithOperation` / typed wrappers | ✅ No change | Already funnel through the gateway; gain config transparently when the gateway resolves it |
| `aiCapability`-routed features (PMF-migrated) | ✅ No change | Already capability→config→gateway; only the config *source* moves to DB |
| Externalizing temperature/max_tokens per operation | 🟢 Low | Add resolution inside the gateway keyed by `operation`; call-site literals become defaults/overrides |
| Wiring dispatcher into live generation path | 🟡 Medium | Change `callProviderWithRetry` from `'openai'|'anthropic'` to `GatewayProviderId` via `resolveTransport`; parity-verify per provider (flag-gated, ADR-014) |
| Intelligence adapters (B5) | 🟢 Low | Transport already flag-switchable to `dispatchTransport`; finish PA-003…008 and default the flags ON |
| Legacy chat routes `gpt-chat.ts` / `claude-chat.ts` (B4) | 🟡 Medium | Re-point to `runCompletionWithOperation`; remove hardcoded models + private retry |
| Image seams (B2) | 🟡 Medium | Unify two stacks into one guarded image sibling-seam (ADR-013) with its own config row |
| Embeddings (B1) / Whisper (B3) | 🟢 Low | Register as configurable sibling seams; add model/dimension to config |
| Prompt template externalization | 🟠 High | No registry today; prompts inline in ~130 files — large, independent workstream |
| Reconciling two provider vocabularies | 🟢 Low | Mapping already written (PB-006 `aiGatewayProviderIdentity`); adopt at boundaries |

---

## 7. Orchestration Readiness

**Can the target chain be introduced without feature-level code changes? Largely yes.** The chain `Feature → Gateway → Capability → Provider → Model → Version → Deployment → Execution Params → Response` maps onto existing seams:

| Target layer | Exists? | Where / gap |
|---|---|---|
| Feature → Gateway | ✅ | ~130 consumers already route through it |
| Capability router | ⚠️ Partial | `aiCapability` runtime exists; not all features use it; config hardcoded |
| Configured provider | ⚠️ | `company_llm_configs` (DB) drives provider, but live path is OpenAI/Anthropic-only |
| Configured model family/model | ✅ | `llm_providers`/`llm_models` DB-driven; `aiModelRouter` tiering |
| Pinned model **version** | ❌ | No version column/field; `model_version` written as `null` in ledger |
| Deployment ID | ❌ (except azure probe) | No deployment field in `company_llm_configs`; only `copilotAdapter` uses Azure deployment |
| Execution params | ❌ | temperature/max_tokens not in config at all |
| Response + observability | ✅ | usage_events + metrics + audit + trace ids |

**Blockers to full orchestration:**
1. Live generation locked to 2 providers (dispatcher dormant on this path).
2. No execution-params config surface (schema + resolution).
3. No model-version / deployment-id columns.
4. Capability config hardcoded + partial adoption.
5. Non-text seams + legacy routes outside the config plane.
6. Prompts inline (blocks prompt-template externalization only; not core routing).

---

## 8. Admin Readiness

| Admin config target | Externalizable today? | Detail |
|---|---|---|
| Capability → default provider/family/model | ✅ (data), needs UI | `CAPABILITY_REGISTRY` → DB table; endpoints partly exist |
| Pinned model version | ❌ | New column + gateway pass-through required |
| Provider priority / enable-disable | ✅ | `llm_providers.is_active`; priority column to add |
| Fallback providers | ⚠️ | Logic exists (`getFallbackConfig`) but derives fallback implicitly — make explicit/configurable |
| Deployment IDs | ❌ | New column (Azure/self-host) |
| Temperature / Top-P / Max tokens / Reasoning / Streaming / Tool-calling / Vision / Structured / Timeout / Retry | ❌ (mostly) | Only timeout/concurrency are env; the rest are call-site literals — new config surface |
| Cost / token / latency limits, rate limits | ⚠️ Partial | Cost estimator + plan-tier + `aiRequestGuard` rate limits exist (env-configured); expose in DB |
| Caching | ⚠️ | `aiResponseCache` live; TTL/enable not admin-exposed |
| Feature flags | ✅ | `lib/platform/rollout` + `defineRolloutFlag` throughout |
| A/B testing | ⚠️ | `variantMetadata` + `experiment_config` table exist; no capability-level A/B router |
| Safety policies | ✅ | `ai/safety/*` + moderation, flag-gated |
| Prompt templates | ❌ | No registry — inline prompts |

**Admin API surface already present** (no React UI): `pages/api/super-admin/llm/providers.ts`, `.../llm/models.ts`, `pages/api/company/llm-config.ts`, `.../llm-providers.ts`. Grep confirms **no `.tsx` consumes these** — the console front-end is the missing piece.

---

## 9. Database Recommendations (recommend-only, no migrations authored)

Extend the existing schema rather than replace it:

- **`llm_models`** — add `model_version text NULL`, `deployment_id text NULL`, and fold execution defaults into `metadata` or dedicated columns (`default_temperature`, `default_max_tokens`, `supports_streaming`, `supports_structured_output`, `supports_vision`, `supports_tools`).
- **New `capability_configs`** — `(capability_id, org_id NULL, provider_id, model_id, model_version NULL, temperature, top_p, max_tokens, reasoning_level, streaming, timeout_ms, retry_policy jsonb, is_active, priority)`. Org-nullable row = platform default; org-scoped row = override. This DB-backs `CAPABILITY_REGISTRY`.
- **New `provider_routing`** — `(capability_id, primary_provider, secondary_provider, fallback_providers text[], env_overrides jsonb)` to make fallback explicit.
- **`company_llm_configs`** — add `deployment_id`, and generalize the key `envMap` beyond openai/anthropic.
- **Versioning/audit/rollback:** add `config_version` + reuse the existing `config_change_logs` (`20260320_admin_config_tables.sql`) for history; keep prior rows `is_active=false` for one-click rollback. Backward-compat: all resolution **falls back to the current hardcoded default when no row exists** (byte-identical behavior when unconfigured).
- **Indexes:** `(capability_id, org_id, is_active)`, `(provider_id, is_active)`.

Migration complexity: **Low–Medium** — additive tables + nullable columns; no destructive change; the gateway's `resolveLlmConfig`/`resolveEffectiveModel` are the single resolution chokepoints to extend.

---

## 10. Security Review

**Strengths:** BYOK keys encrypted at rest (AES-256-GCM, `credentialEncryption`); RLS-owner-scoped DB access (`ownedDbTable`); super-admin/company auth gating on config endpoints (`isPlatformSuperAdmin`, `MANAGE_EXTERNAL_APIS`); tenant id in cache/coalescing keys; `aiRequestGuard` (validation + rate/burst); audit-log per gateway call; Chrome extension carries no keys and is allow-list + HMAC gated; transport SSRF guard (`assertTrustedTransportOrigin`) restricts outbound origins to the frozen registry.

**Findings / to address before Admin Console:**
- **S1 — `gpt-chat.ts` accepts a client-supplied `apiKey`** (`pages/api/ai/gpt-chat.ts:12,46`) and calls OpenAI directly. Retire this route or route via the gateway; never accept provider keys from clients.
- **S2 — Provider key coverage is openai/anthropic-only** in `resolveCompanyApiKey`'s `envMap`; adding providers to the console requires secure key storage per provider (extend `company_llm_configs` / platform env with the same encryption).
- **S3 — Admin config is a new privileged write surface**: enforce RBAC (super-admin for provider/model registry; company-admin for org overrides), full audit trail (`config_change_logs`), and change approval for platform-wide defaults.
- **S4 — Prompt injection**: ADR-007 mandates delimiting untrusted text pre-gen; still partially adopted — relevant when capability configs allow enabling tool-calling/vision later.
- **S5 — Version pinning / rollback**: model-version pinning (currently absent) is itself a security/stability control — a silent provider model swap can change safety behavior.

---

## 11. Performance Review

**Strengths (already built):** connection reuse (singleton OpenAI client; ephemeral per-BYOK); streaming with partial salvage; per-pool concurrency isolation + distributed Redis-Lua semaphore + provider token buckets (rate-limit protection ≈ soft circuit-breaking); deterministic bounded backoff retry; cross-provider fallback on 429/529/network; multi-tier caching (in-flight coalescing → exact response cache → near-match → blueprint LRU, all tenant-keyed); token accounting via ledger; background execution via BullMQ workers; operation-keyed timeout budgeting (30s/120s/240s).

**Gaps / recommendations:**
- **P1 — No true circuit breaker** (open/half-open per provider) — today it's token-bucket + retry + fallback. A capability-level breaker would harden multi-provider routing.
- **P2 — Structured output & prompt-cache asymmetry**: `response_format` is OpenAI-only; Anthropic prompt-cache is flag-gated. Config plane should expose per-provider capability so routing avoids sending unsupported params.
- **P3 — Gemini/Perplexity transports are non-streaming** — latency-sensitive capabilities should not route to them for streaming ops; encode in the capability→provider config.
- **P4 — Request batching** exists for embeddings only; not generalized.
- **P5 — Cross-instance pool sizing** is per-process for local pools; the distributed semaphore covers cluster coordination but pool math must be tuned against real provider QPS.

---

## 12. Recommended Migration Strategy (safest, least-disruptive)

All phases are **additive, flag-gated, parity-verified** (ADR-014). Each falls back byte-identically when unconfigured.

1. **Phase A — Config resolution seam (Low).** Add execution-param + capability resolution *inside* the existing gateway funnel (`resolveLlmConfig`/`resolveEffectiveModel` chokepoints), reading a new `capability_configs` table; when no row, use today's hardcoded default. Zero call-site changes.
2. **Phase B — Admin Console (Low–Medium).** Build the React UI over the **already-existing** provider/model/company-config endpoints; add endpoints for the new capability/param tables. Read-only first, then write with RBAC + `config_change_logs`.
3. **Phase C — Externalize execution params (Low).** Migrate `CAPABILITY_REGISTRY` + call-site temperature/max_tokens into DB defaults; keep literals as fallback. Expand `aiCapability` adoption to more features.
4. **Phase D — Activate multi-provider on the live path (Medium).** Widen `callProviderWithRetry` to `GatewayProviderId` via `resolveTransport`; enable Gemini/Perplexity per capability behind probe-parity flags; generalize `envMap`/BYOK for new providers; add model-version + deployment-id columns.
5. **Phase E — Consolidate bypasses (Medium).** Route intelligence adapters through the dispatcher (default flags ON); unify the two image stacks into one guarded seam; register embeddings/Whisper as configurable sibling seams; retire `gpt-chat.ts`/`claude-chat.ts`.
6. **Phase F — Prompt template registry (High, independent).** Optional/last: externalize prompts using the existing `prompt_template_name/version/hash` metadata as the bridge.

Sequence A→B→C delivers a usable Admin Console for provider/model/params without touching the provider count; D→E unlock true provider-agnostic routing; F is a separable long-tail.

---

## 13. Overall Readiness Score

**7.5 / 10.** The gateway, per-tenant config schema, capability framework, multi-provider transports, billing, and observability are already production-grade. The remaining work is externalizing execution params, DB-backing the capability config, wiring the dormant dispatcher, building the UI, and consolidating a handful of sibling/bypass seams — integration, not architecture.

---

## 14. Estimated Refactoring Effort

**Medium.** No rewrite. The single-chokepoint funnel (`executeGatewayCompletion`) and the existing `resolveLlmConfig`/`resolveEffectiveModel`/`aiCapability` seams mean orchestration is added *behind* interfaces ~130 consumers already use. (Prompt-template externalization is the only High-effort item, and it is separable/optional.)

---

## 15. Top Architectural Risks

1. **Live path is provider-locked to OpenAI/Anthropic** — the marquee "switch providers with no code change" promise is not yet true on the generation path (dispatcher dormant). Highest-priority unlock.
2. **Execution params have no config surface at all** — ~40+ scattered literals; must be centralized before they can be admin-managed.
3. **Two provider vocabularies** — silent-failure hazard (PB-006 documents it); adopt the mapping at every boundary.
4. **Sibling/bypass seams outside the config plane** — image (×2), embeddings, Whisper, legacy chat routes, and default-direct intelligence adapters will silently ignore Admin Console settings until consolidated.
5. **No model-version pinning / rollback** — a provider-side model change can alter cost/safety/output silently.
6. **`gpt-chat.ts` accepts client-supplied keys** — security debt to retire.

---

## 16. Quick Wins

- **QW1** — Build the admin UI over the **existing** `super-admin/llm/*` + `company/llm-config` endpoints (provider/model/BYOK management ships immediately).
- **QW2** — Add operation→execution-param resolution in the gateway funnel (one seam) with hardcoded fallback; removes the largest hardcoding class incrementally.
- **QW3** — Flip the `*_ADAPTER_GATEWAY_TRANSPORT` flags to route intelligence probes through the dispatcher (transport already switchable).
- **QW4** — Adopt PB-006 identity mapping at provider boundaries (mapping already written).
- **QW5** — Delete `tmp_run_intelligence_evaluation.mjs`; retire/redirect `gpt-chat.ts`.
- **QW6** — DB-back `CAPABILITY_REGISTRY` (schema mirrors the frozen TS 1:1).

---

## 17. Recommended Phase 2

Implement in this order: **(1)** `capability_configs` + execution-param columns migration (additive, fallback-safe) → **(2)** gateway resolution seam reading it → **(3)** Admin Console UI (read-only → RBAC writes + audit) → **(4)** multi-provider live-path activation (widen `callProviderWithRetry`, per-capability provider routing, version/deployment columns, generalized BYOK) → **(5)** bypass consolidation (image seam unification, intelligence adapters default-on, embeddings/Whisper registration, legacy route retirement) → **(6, optional)** prompt-template registry. Every step flag-gated and parity-verified per ADR-014; unconfigured behavior stays byte-identical to today.

---

*Audit complete. No code, migrations, or services were modified.*
