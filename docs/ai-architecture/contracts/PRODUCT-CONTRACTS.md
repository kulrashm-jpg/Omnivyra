# Product & Domain Contracts (AI-CONTRACT-000)

Contracts for the domain subsystems. All build on [COMMON-SUBSTRATE.md](COMMON-SUBSTRATE.md) and consume the [core pipeline](CORE-CONTRACTS.md). Each is the single authoritative interface for its subsystem.

---

## P0. Brand Runtime Contract (shared dependency)

- **Purpose:** the one authoritative brand contract, consumed uniformly by Writer, Creator, and Engagement.
- **Owner:** Content Platform. **Canonical module:** `brand/brandRuntime`.
- **Entry point:** `resolveBrand(companyId, envelope): Result<BrandContract>`.
```
BrandContract {
  voice: { tone; descriptors[]; ctaStyle }
  vocabulary: { prohibitedPhrases[]; requiredTerms[] }
  compliance: { disclaimers[]; prohibitedClaims[]; regulated: boolean }
  version: ContractVersion
}
```
- **Invariant:** the **full** contract (not just `voice`) is injected wherever brand applies; inert/partial adoption is a conformance violation (AI-ARCH ADR-012).

---

## P1. Knowledge Contract

- **Purpose:** company-scoped memory (company/brand/campaign/content/semantic) + embedding storage, retrieval, retention, eviction.
- **Owner:** AI Platform. **Canonical modules:** `contentMemoryService` (+ `brand_memory`), embedding seam (`signalEmbeddingService` pattern), pgvector.
- **Entry points:** `index(unit): Result<void>` · `retrieve(query): Result<RetrievedKnowledge>` · `refreshBrandMemory(companyId): Result<void>`.
```
MemoryQuery { envelope; companyId; contentType?; campaignId?; platform?; limit; mode: 'lexical'|'semantic'|'hybrid' }
RetrievedKnowledge { items: MemoryItem[]; embeddingsUsed: boolean; scope: TenantScope }
MemoryItem { ref: ContentRef; text; embedding?; provenance }
```
- **Stores:** company memory (profile/`content_memory`), brand memory (rollup, invalidated on publish), campaign memory (campaign filter), content memory (canonical `content` + `content_memory`, lexical **+ embedding**), semantic memory (pgvector).
- **Retention / eviction:** durable content/memory rows; cache tiers TTL'd; brand rollup capped + refreshed on index.
- **Ownership / consistency:** every read/write is `orgId`-scoped at query level (Substrate §S2); embedding writes are non-null (Originality §C5).
- **Reuse:** blueprint LRU + response cache (tenant-keyed) avoid duplicate inference; never crosses tenants.

---

## P2. Campaign Intelligence Contract

- **Purpose:** deterministic, explainable planning/scheduling/sequencing; the LLM is confined to ideation.
- **Owner:** Campaign Platform. **Canonical modules:** `campaignAiOrchestrator` + `buildDeterministicWeeks`; Strategic Mix decision graph; Intelligent Mix distributor.
- **Entry point:** `plan(req: CampaignPlanRequest): Result<CampaignPlan>`.
```
CampaignPlanRequest { envelope; companyId; objective; duration; contentMix?; platformSchedule?; grounding }
CampaignPlan {
  weeks: Week[]                          // each slot: type, platform, format, campaign_stage, strategic_role, ...
  provenance: SlotProvenance[]           // per-slot recommendation_alignment: source_type/value/reason
  reproducible: true                     // schedule/sequence/allocation are pure functions of inputs
  ideation: { model; temperature: 0; seed }   // topic/theme only; seeded
}
```
- **Planning inputs:** brief + canonical grounding + strategic focus + platform performance + prior-campaign context + user content-mix (hard rules).
- **Strategy generation:** LLM produces **topics/themes only** at temperature 0 (seeded); every strategic field, schedule slot, sequence, and platform/format allocation is derived by **deterministic rule**.
- **Recommendation model / approval state / execution handoff:** recommendations carry provenance; plans move through approval → execution with the same `correlationId`.
- **Traceability / explainability:** every slot self-explains via `recommendation_alignment`; hard validators reject any missing derived field.
- **Invariant:** no non-reproducible AI decision reaches the schedule (AI-ARCH ADR-009).

---

## P3. Creator AI Contract

- **Purpose:** visual asset generation — copy (shared runtime) + image (one guarded seam) + render.
- **Owner:** Creator Platform. **Canonical modules:** copy → Generation Runtime; image → one guarded image seam; render worker.
- **Entry points:** `generateCopy(req): Result<GeneratedContent>` (via C2) · `generateImage(req: ImageRequest): Result<ImageAsset>` · `render(job: RenderJob): Result<RenderedAsset>`.
```
ImageRequest { envelope; companyId; visualPrompt; aspectRatio; brand: BrandContract; billing: BillingIntent }
ImageAsset  { url; model: 'gpt-image-1'; reuseKey: Sha256; provenance }
```
- **Copy generation:** through the Generation Runtime (grounding + originality shared with Writer).
- **Image generation:** through **one** image seam that passes the platform guard + billing + observability (AI-ARCH ADR-013); one prompt builder; one moderation path. (Image is a sibling seam to the chat gateway, not a bypass.)
- **Render requests / asset generation:** exactly-once lease, fail-closed spec re-validation, SHA-256 dedupe/reuse.
- **Validation / moderation / brand enforcement:** visual copy passes Originality + Safety; brand via full BrandContract.
- **Handoff:** rendered asset + `text_fit`/safety status handed to scheduler; publish gate is contracted (with a kill-switch).

---

## P4. Engagement AI Contract

- **Purpose:** one grounded reply generator + classification + moderation + escalation, using tenant-scoped conversation memory.
- **Owner:** Engagement Platform. **Canonical modules:** one reply generator (merge of the three paths), `conversationMemoryService`, `moderationGateService`, escalation.
- **Entry points:** `classify(msg): Result<Classification>` · `generateReply(req): Result<Reply>` · `escalate(req): Result<Escalation>`.
```
ReplyRequest { envelope; orgId; threadId; message; grounding; conversation: ConversationMemory }
Reply { text; provenance; moderation: ModerationVerdict; requiresHumanReview: boolean }
```
- **Reply generation:** the one live generator is **fully grounded** (company context + brand + the conversation-memory summary) — not brand-voice-only.
- **Conversation memory:** tenant-scoped read (org-filtered at query level) and write; consumed by the live path.
- **Classification:** sentiment/intent with `Confidence.basis` explicit (no hardcoded confidence presented as measured).
- **Moderation:** **outbound** reply text scanned before send (Safety §C6); inbound signals also moderated.
- **Escalation / recommendation / audit logging:** escalations tenant-scoped, deterministic SLA; auto-actions gated behind human approval; every decision audited by `correlationId`.

---

## P5. Analytics Intelligence Contract

- **Purpose:** metric summaries — deterministic aggregation with optional LLM narration.
- **Owner:** Data Platform. **Canonical modules:** aggregation services (no LLM) + optional narration via gateway.
- **Entry point:** `summarize(req: AnalyticsInsightRequest): Result<AnalyticsInsight>`.
```
AnalyticsInsightRequest { envelope; companyId; metrics: AggregatedMetrics }  // pre-aggregated
AnalyticsInsight { narrative?; recommendations: Recommendation[]; evidence: MetricRef[]; confidence: Confidence }
```
- **Analysis requests:** consume pre-aggregated real metrics only (no fabricated data).
- **Insight/recommendation/evidence model:** every insight cites the metric refs it derives from; `confidence.basis` explicit.
- **Trend detection:** over real time-series; **deterministic fallback** when sample is insufficient (`views < N`).
- **Output validation:** narration is bounded to the provided metrics; no invention beyond evidence.

---

## P6. Market Intelligence Contract — *no fabricated evidence*

- **Purpose:** tiered market signals/insights with strict provenance separation.
- **Owner:** Intelligence Platform. **Canonical modules:** ingestion pipeline (retrieval) + deterministic engines (Website Intelligence) + labeled inference.
- **Entry point:** `intelligence(req: MarketIntelRequest): Result<MarketInsight[]>`.
```
MarketInsight {
  claim: string
  tier: 'deterministic' | 'retrieval_backed' | 'ai_inference' | 'speculative'
  provenance: Provenance        // sources REQUIRED for non-deterministic (Substrate §S5)
  trust?: TrustScore            // computed ONLY over real cited sources
  confidence: Confidence
  freshness: FreshnessLabel     // EVENT-time
}
```
- **Retrieval inputs / source validation:** real external fetch (YouTube/NewsAPI/SerpAPI ingestion) is the flagship source; each source validated + carries `url` + credibility.
- **Citation requirements:** every non-deterministic claim carries ≥1 real citation; a persisted signal always has a `source_url` or an explicit `deterministic`/`speculative` label.
- **Confidence / trust scoring:** trust is computed only over real cited sources — never over `{source_count:1, sources_json:[]}`.
- **Deterministic analysis:** Website Intelligence reads persisted crawl only, `deterministic:true`, tenant-scoped.
- **AI inference model:** synthesis over retrieved evidence, **labeled** `ai_inference`, citations attached.
- **Prohibited behaviors / fabrication policy:** an LLM `speculative` output MUST be labeled and MUST NOT be presented or scored as evidence; the Authority Index is activated (real source) or removed (no inert confidence surface).
