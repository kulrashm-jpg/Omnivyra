# Omnivyra Canonical AI Architecture (AI-ARCH-000)

**Status:** Canonical blueprint — governing reference for AI engineering Waves 1–5.
**Basis:** OMNI-AI-001 certification (AI Platform Requires Engineering) + repository evidence.
**Scope:** Architecture definition only. No code, migration, or refactor is authorized by this document.

This document defines the single authoritative AI architecture. Where the **as-is** (what the code does today, per OMNI-AI-001) differs from the **to-be** (canonical), both are stated; the delta is the mandate for Waves 1–5. Every AI capability has exactly one owner, one execution path, one contract, one responsibility.

---

## 1. Canonical AI Architecture (end-to-end)

The one approved lifecycle. Every product AI request traverses these layers in order; no layer may be skipped or duplicated.

```
User Request
   ↓   (1) Context Assembly        — resolve identity/tenant/operation; load canonical profile ONCE
   ↓   (2) Grounding               — company · campaign · brand · website · history · conversation; freshness-gated
   ↓   (3) Prompt Assembly         — one assembler: system prompt + context blocks + persona + output contract
   ↓   (4) Safety (pre-gen)        — delimit/escape untrusted text · instruction hierarchy · injection scan
   ↓   (5) Generation Runtime      — one runtime; deterministic where possible; retrieval before generation
   ↓   (6) Provider Gateway        — one seam: routing · pools · retry · fallback · timeout · streaming
   ↓   (7) LLM                     — OpenAI · Anthropic (chat); image + embedding are sibling seams
   ↓   (8) Validation              — schema/structure via one safe-parse/extract contract
   ↓   (9) Originality             — lexical + semantic (embedding) dedup; per-company; every generation path
   ↓  (10) Safety (post-gen)       — output moderation before persist/publish
   ↓  (11) Persistence             — canonical content spine + memory indexing (lexical + embedding)
   ↓  (12) Observability           — usage_events + metrics + traces + grounding/originality/hallucination signals
   ↓
Product Response
```

**Layer guarantees (invariant):**
- Exactly one implementation per layer (§ Design Principles).
- Safety brackets generation on **both** sides (pre-gen injection defense; post-gen moderation).
- Grounding precedes prompt assembly; retrieval precedes generation.
- Every layer emits observability; no silent path.

---

## 2. AI Responsibility Matrix

One authoritative owner and contract per subsystem. "Canonical module" names the single approved implementation (to-be); "as-is" notes divergence found by OMNI-AI-001.

| Subsystem | Purpose | Canonical module (to-be) | Inputs → Outputs | Consumers | Failure behavior | Extensibility |
|---|---|---|---|---|---|---|
| **Provider Gateway** | Sole chat-LLM execution seam | `backend/services/aiGatewayCore.ts` (+ `aiGatewayProviders*`) | prompt+config → completion+usage | every AI subsystem | retry→fallback→typed error; fail-**closed** on provider error | new provider = new adapter behind seam |
| **Generation Runtime** | One orchestration of context→gen→validate→originality→persist | `backend/services/content/runtime/generationRuntime.ts` | intent+context → content+provenance | Writer, Creator copy, Campaigns content | fall-back-safe; deterministic replay of pipeline | new content type = new profile, not new runtime |
| **Prompt Assembly** | One system-prompt + context-block + output-contract builder | `content/runtime/promptAssembler.ts` (owns the bytes) | grounding+persona → system+user | Generation Runtime only | never emit ungrounded prompt without floor | new block = registered, versioned |
| **Grounding Engine** | Single canonical context read | `getCanonicalProfile` / `canonicalContentContextResolver.ts` | companyId → grounded context | Prompt Assembly, all products | freshness-gated; **floor** (no silent ungrounding) | new source = new resolver input |
| **Originality Engine** | Uniqueness across lexical+semantic | `content/originalityGate.ts` + `contentMemoryService.ts` | candidate+companyId → decision | every generation path | fail-open logged, but **coverage mandatory** | new axis = new stage |
| **Brand Runtime** | Authoritative brand contract | `backend/services/brand/brandRuntime.ts` | companyId → voice+vocab+compliance | Prompt Assembly (Writer+Creator+Engagement) | inert-safe default; **full adoption required** | new facet = contract field |
| **Campaign Intelligence** | Deterministic plan/schedule/sequence | `campaignAiOrchestrator` + `buildDeterministicWeeks` | brief → plan (temp-0 ideation + rule derivation) | Campaigns, Strategic/Intelligent Mix | hard validators throw; reproducible | new rule = deterministic function |
| **Creator AI** | Visual asset generation | copy→Generation Runtime; image→one image seam | spec → asset | Creator | render worker exactly-once/fail-closed | new asset type = profile |
| **Writer AI** | Long/short written content | Generation Runtime (post/thread/blog/article/story) | intent → content | Writer product | grounded or floored | content-type profile |
| **Engagement AI** | Replies/DMs/triage | one grounded reply generator via gateway | conversation → reply | Engagement | human-review gate; moderated | playbook policy |
| **Market Intelligence** | Signals/trends/authority | tiered: deterministic · retrieval-backed · inference (labeled) | sources → insights+citations | MarketPulse UI | **no fabricated evidence**; degrade to `not_evaluable` | new source = new connector |
| **Analytics Intelligence** | Metric summaries | deterministic aggregation + optional LLM narration | metrics → insight | Analytics | deterministic fallback | — |
| **Knowledge Memory** | Company/brand/content/semantic memory | `content_memory` (lexical+embedding) + `brand_memory` | content → indexed memory | Originality, Grounding | company-scoped; embedding-backed | pgvector |
| **Observability** | Metrics/traces/cost/quality | `usage_events` + `observability/*` + trace ids | events → metrics | ops, billing | fail-safe | new signal = new metric |
| **Billing** | Cost enforcement | `billing/runBilledAiCompletion.ts` | operation → hold/execute/confirm | all billable AI paths | HOLD→EXECUTE→CONFIRM | new op = policy |
| **Safety Layer** | Injection defense + moderation | pre-gen guard + `moderation/*` (output) | prompt/output → allow/block | Prompt Assembly, Persistence | **fail-closed for injection & moderation** | new policy = rule |

---

## 3. Canonical Execution Paths (one per product)

Every feature has exactly one approved path. All converge on **Generation Runtime → Provider Gateway** (content) or the tiered intelligence pipeline (market).

| Product | Canonical path (to-be) | As-is delta (OMNI-AI-001) |
|---|---|---|
| **Writer** | `runPost/ThreadGeneration` → **GenerationRuntime** → promptAssembler → gateway → originality → persist | Runtime OFF by default; inline legacy path is live; 3 competing generators |
| **Creator (copy)** | Creator service → GenerationRuntime (shared) → gateway | Uses gateway but not GenerationRuntime; no originality coverage |
| **Creator (image)** | Creator → **single image seam** (gateway-guarded) → render worker | Two divergent direct-OpenAI image stacks bypass the guard |
| **Campaigns** | orchestrator → temp-0 ideation → `buildDeterministicWeeks` (rule) → schedule | Canonical already; unseeded plan call |
| **Strategic Mix** | `aiCapability` framework → deterministic decision graph → gateway | Canonical (flag-off, additive) |
| **Intelligent Mix** | pure `weeklyAssignmentEngine` (no LLM) | Canonical (deterministic) |
| **MarketPulse** | tiered intelligence: real ingestion → retrieval-backed insight (cited) → labeled inference | Flagship is LLM-fabricated; real pipeline disconnected |
| **Analytics** | deterministic aggregation → optional LLM narration | Canonical (template + optional narration) |
| **Engagement** | ingest → memory → **one grounded reply generator** → moderation → send/suggest | 3 reply paths; live one is brand-voice-only + ignores memory; no output moderation |
| **Company Profile** | crawl → extraction (gateway) → canonical profile | Canonical (unbilled) |
| **Website Intelligence** | crawl → deterministic engines (no LLM) → snapshot | Canonical / mature |

---

## 4. Orchestration Architecture (disposition)

| Orchestration | Class | Disposition |
|---|---|---|
| `content/runtime/generationRuntime.ts` | **Canonical** | **Retain** — promote to sole content path (enable flag) |
| `contentGeneration/blueprintGenerator.ts` + `platformVariantGenerator.ts` | Canonical primitives | **Retain** (owned by the runtime) |
| `unifiedContentGenerationEngine.ts` ("DEPRECATED" banner, still worker-wired) | Legacy | **Replace** (route workers to runtime) → **Remove** |
| `contentGenerationService.ts` (inline prompts) | Legacy | **Replace** → **Remove** |
| `textGenerationOrchestrator.runTextGeneration` (legacy fork) | Legacy | **Merge** into runtime; retire fork |
| `aiCapability` framework | Canonical (orchestration wrapper) | **Retain** (delegates to gateway) |
| `aiExecutionRuntime` (billing/lifecycle) | Canonical | **Retain** |
| `intelligence/adapters/*` (second provider abstraction) | Parallel | **Merge** onto the gateway (probes billed/observed) |
| `PROMPT_REGISTRY` / `promptCompiler` registry indirection | Test-only | **Remove** orphaned `content_generation` entry |
| `prompts/contentGenerationPromptsV3.ts` prompt builders | Deprecated/dead | **Archive/Remove** |
| `UNIFIED_CONTENT_GENERATION_COMPLETE.ts` (root prose-as-code) | Stale doc-as-code | **Archive/Remove** |
| long-form `lib/blog` path vs `longFormGenerationOrchestrator` (unwired) | Duplicated | **Merge** — one long-form engine; wire grounded-claim validation into the live path |

---

## 5. Prompt Architecture (canonical)

**One prompt system.** `promptAssembler` owns the assembled bytes; there is exactly one content-type system-prompt source, one variant system, one version constant, one fingerprint algorithm.

| Facet | Canonical rule |
|---|---|
| System prompts | one source (consolidate the 3 live content-type sources → `contentTypeHelpers` semantics under the assembler) |
| Context blocks | one builder set (`companyContextBlockBuilders` / `canonicalContentContextResolver`) |
| Persona | one identity builder (`buildIdentityLock`) |
| Brand voice | full `brandRuntime` contract (voice + vocabulary + compliance), not just `brand_voice` |
| Reasoning instructions | declared per content-type profile, versioned |
| Output contracts | one structured-output contract + one safe-parse util (no raw `JSON.parse`) |
| Platform variants | one variant generator + `platformAdaptationProfiles` (anti-collision) |
| Prompt versioning | **one** `CONTENT_GENERATION_PROMPT_VERSION` (resolve the `1` vs `'v3_unified'` collision) |
| Prompt fingerprinting | **one** sha256 fingerprint (retire the djb2 variant) |

Invariant: **no duplicated prompt ownership.** Untrusted text is delimited/escaped before entering any system prompt (see §7 Safety).

---

## 6. Grounding Architecture (canonical)

**One canonical read** (`getCanonicalProfile`) feeds all grounding. Sources and guarantees:

| Grounding source | Canonical owner | Guarantee |
|---|---|---|
| Company | canonical profile adapter | single read; deterministic assembly |
| Campaign | campaign context builder | reproducible |
| Brand | `brandRuntime` (full contract) | voice + vocab + compliance injected |
| Website | `getWebsiteSnapshot` (deterministic, real crawl) | tenant-scoped; freshness-aware |
| Historical content | `content_memory` retrieval | company-scoped |
| Conversation memory | `conversationMemoryService` | tenant-scoped; **consumed by the live path** |
| Knowledge retrieval | embedding retrieval (pgvector) | company-scoped |

**Grounding guarantees (new, mandated):**
1. **Floor** — generation MUST NOT silently degrade to ungrounded output when a profile is missing; it fails closed or queues for enrichment.
2. **Freshness gate** — the `stale` label is enforced at generation time (warn/refresh/block), not merely computed.
3. **Retrieval before generation** — relevant memory is retrieved and considered before any generative call.

---

## 7. Originality Architecture (canonical)

One engine (`originalityGate` + `contentMemoryService`), applied to **every** generation path, with both tiers live.

| Facet | Canonical rule |
|---|---|
| Lexical similarity | exact/normalized hash → SimHash → Jaccard/minhash (retain) |
| Semantic similarity | **embedding cosine ACTIVE** (populate `content_memory.embedding`; the dead tier becomes live) |
| Embedding strategy | `text-embedding-3-small` (1536-d) via the embedding seam; pgvector storage |
| Memory indexing | company-scoped; keyed by (company, content_type, platform); every generated unit indexed |
| Cross-company protection | per-company by design; grounding floor prevents ungrounded collision |
| Cross-campaign protection | campaign is a narrowing filter, never a boundary that hides repeats |
| Cross-platform differentiation | `platformAdaptationProfiles` anti-collision (retain — a strength) |
| **Coverage (mandated)** | post · thread · **carousel · story · caption · headline · CTA · hashtag · blog · scheduled/BOLT** — all gated OR indexed (no bypass) |
| Creator originality | visual copy gated via shared engine |
| Blog originality | one long-form engine; grounded-claim validation wired into the live path |
| Scheduled/BOLT | routed through the runtime → originality (no bypass) |

---

## 8. Market Intelligence Architecture (canonical) — *no fabricated evidence*

Strict separation of tiers; every user-facing "signal" carries provenance.

| Tier | Definition | Source | Trust/citations |
|---|---|---|---|
| **Deterministic** | Computed over persisted real data | Website Intelligence, DB aggregation | full provenance, `deterministic:true` |
| **Retrieval-backed** | Grounded in real external fetch | YouTube/NewsAPI/SerpAPI ingestion pipeline (connected as flagship source) | real `source_url` + credibility per source |
| **AI inference** | Model synthesis over retrieved evidence | LLM over cited context | labeled "inference"; citations required |
| **Speculation** | Explicitly hypothetical | LLM parametric knowledge | **labeled speculative; never trust-scored as evidence** |

**Invariants:**
- Trust/evidence scores are computed **only over real, cited sources** (no `source_count:1, sources_json:[]` scoring).
- No persisted signal without a `source_url` or an explicit `deterministic`/`speculative` label.
- Freshness keys on **event time**, not run time.
- The Authority Index is **activated** (populate `canonical_backlink_signals` + configure a provider) **or removed** — no inert surface presenting confidence.

---

## 9. Safety Architecture (canonical) — *safety brackets generation*

A first-class layer, currently near-absent (OMNI-AI-001). Defined as:

| Control | Canonical rule |
|---|---|
| Prompt-injection protection | untrusted text (crawl/competitor/user) **delimited + escaped** before system-prompt injection |
| Instruction hierarchy | system > developer > grounded-data > user; data is never executable instruction |
| Moderation | **output moderation** on generated content AND engagement replies before persist/publish |
| Policy enforcement | tenant policy + playbook gates (retain) |
| Tenant isolation | tenant id in **every** cache/coalescing key; every memory read org-filtered |
| Abuse protection | `aiRequestGuard` (retain; fail-open by design, documented) |
| Compliance | `brandRuntime` compliance facet injected + checked |
| Guardrails | grounded-claim/factual guardrails on all long-form |
| Human review | escalation + auto-reply gated behind human approval (retain) |

**Invariant:** injection defense and output moderation **fail closed** (block on error), distinct from the abuse guard's fail-open availability tradeoff.

---

## 10. Knowledge Architecture (canonical)

| Layer | Canonical store | Scope | Lifecycle |
|---|---|---|---|
| Company memory | `content_memory` / profile | company | durable |
| Brand memory | `brand_memory` rollup | company | refreshed on index; invalidated on publish |
| Campaign memory | `content_memory` (campaign filter) | company+campaign | durable |
| Content memory | `content` spine + `content_memory` | company | durable, indexed lexical **+ embedding** |
| Semantic memory | pgvector embeddings | company | durable |
| Cache hierarchy | in-flight coalescing → exact response cache → near-match → blueprint LRU | **tenant-keyed** | TTL'd |
| Embedding storage | pgvector (`embeddingToPgVector`) | company | durable |
| Artifact lifecycle | canonical `content` rows at generation; memory index; brand rollup | company | retained; reusable |

**Invariant:** every cache key and memory read is tenant-scoped; reuse never crosses tenants.

---

## 11. Observability Architecture (canonical)

| Signal | Canonical source | Mandate |
|---|---|---|
| Metrics | `recordAi` / observability registry | retain |
| Traces | OTLP span per attempt | retain |
| Reasoning identifiers | trace id **persisted with the artifact** (not throwaway) | new |
| Cost tracking | `usage_events` (per outcome) | retain; **cost system/UNKNOWN_ORG spend** |
| Latency | gateway timing | retain |
| Provider metrics | per-provider counters/histograms | retain |
| Quality metrics | validation pass/fail | extend |
| Grounding metrics | grounded vs floored generation rate | new |
| Hallucination metrics | groundedness detection score | new |
| Originality metrics | dedup hit rate + semantic-tier coverage | new |

**Invariant:** every layer emits at least one signal; no silent path; `usage_events` is the source of truth.

---

## 12. AI Governance Model

One authoritative owner per subsystem (advisory today via CODEOWNERS; enforced when branch protection lands). Owners are architectural roles, not individuals.

| Subsystem | Authoritative owner (role) |
|---|---|
| Runtime / Providers / Prompts / Grounding / Memory | **AI Platform** |
| Writer / Content generation | **Content Platform** |
| Creator | **Creator Platform** |
| Campaign / Strategic / Intelligent Mix | **Campaign Platform** |
| Market Intelligence | **Intelligence Platform** |
| Engagement | **Engagement Platform** |
| Analytics | **Data Platform** |
| Safety / Billing / Observability | **Platform Reliability** |
| Testing / Documentation | subsystem owner + Platform Reliability |

No subsystem has two owners; no owner reimplements another's layer.

---

## 13. Design Principles (immutable)

1. **Single Provider Gateway** — one chat seam; image/embedding are sibling seams.
2. **Single Generation Runtime** — one content orchestration.
3. **Single Prompt Assembly System** — one assembler owns the bytes; no duplicated prompt ownership.
4. **Single Grounding Engine** — one canonical read.
5. **Single Originality Engine** — one gate, both tiers, all paths.
6. **Retrieval Before Generation** — ground and retrieve before any generative call.
7. **Deterministic Decisions Where Possible** — rules over LLM for scheduling/sequencing/allocation.
8. **Explainable AI Decisions** — every decision carries provenance (as Campaign Intelligence already does).
9. **Tenant Isolation by Design** — tenant id in every key and read.
10. **Safety Before Generation** — injection defense pre-gen; moderation pre-publish; both fail-closed.
11. **Observability by Default** — every layer emits; no silent path.
12. **Reusable AI Components** — shared capabilities, not per-product copies.
13. **No Duplicate AI Logic** — one implementation per responsibility.
14. **Backward-Compatible Evolution** — flag-gated, fall-back-safe cutovers (the Writer-runtime pattern).

These principles are constitutional: Waves 1–5 conform to them; deviations require a new ADR.
