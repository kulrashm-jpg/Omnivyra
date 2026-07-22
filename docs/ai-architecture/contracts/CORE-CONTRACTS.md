# Core Pipeline Contracts (AI-CONTRACT-000)

The six contracts of the generation pipeline. All types build on [COMMON-SUBSTRATE.md](COMMON-SUBSTRATE.md). Each is the **single authoritative interface** for its subsystem (AI-ARCH-000 §2). Real repository shapes (e.g. `GatewayRequest`/`GatewayResponse` in `aiGatewayCore.ts`) are the as-is basis; the contract is the frozen to-be.

---

## C1. Provider Gateway Contract

- **Purpose:** the single chat-LLM execution seam. Owns routing, pooling, retry, fallback, streaming, timeout, structured output, usage reporting.
- **Owner:** AI Platform. **Canonical module:** `aiGatewayCore` (+ `aiGatewayProviders*`).
- **Entry point:** `execute(req: GatewayRequest): Result<GatewayResponse>` (streaming variant yields chunks + a terminal `Result`).

**Request**
```
GatewayRequest {
  envelope: RequestEnvelope
  messages: Message[]                 // role + content
  model:    ModelId                   // resolved by router; provider inferred
  params:   { maxTokens?, temperature?, seed?, responseFormat?: 'text'|'json_object'|'json_schema', schema? }
  stream?:  boolean                   // opt-in
  timeoutMs?: int                     // else resolved by operation/maxTokens
  billing:  BillingIntent             // §Billing — bill | exempt(reason)
  cachePolicy?: 'none' | 'exact' | 'near_match'   // tenant-keyed always
}
```

**Response**
```
GatewayResponse {
  output:   string
  parsed?:  unknown                   // present iff responseFormat != 'text' AND validation passed
  model:    ModelId; provider: 'openai'|'anthropic'
  usage:    UsageRecord               // tokens, cost, latency, attempts, cacheHit
  finishReason: 'stop'|'length'|'tool'|'aborted'
}
```

- **Routing:** one router resolves `ModelId` by plan tier + usage; BYOK bypasses downgrade. **Fallback:** cross-provider on rate-limit/network only; requires a second active provider (else typed `GATEWAY_NO_FALLBACK`).
- **Retry semantics (contract):** transient (5xx/timeout/429/529) → bounded exponential backoff + jitter; malformed output → not retried. Every attempt emits a UsageRecord.
- **Structured outputs:** `json_object` today; `json_schema` when provider-supported. Output parsing goes through the **one safe-parse** (never raw `JSON.parse`) → `parsed` or `VALIDATION_BAD_OUTPUT`.
- **Timeouts:** scale with work (long-form operations get an extended cap); the operation→timeout map is a contract input, not a hardcoded allowlist.
- **Failure semantics:** **fail-closed** — a provider error returns `{ok:false}`, never a fabricated completion. (Distinct from the abuse guard's fail-open.)
- **Billing hooks / rate limiting:** every call passes the abuse guard (`aiRequestGuard`) and carries `BillingIntent`.
- **Sibling seams (not this contract):** image generation and embeddings are separate seams with their own contracts (Creator, Knowledge).
- **Versioning:** semver; adding a provider or param is MINOR; changing response shape is MAJOR.
- **Consumers:** Generation Runtime, and (via it) every product. **Dependencies:** router, billing, guard, observability.
- **Deprecation:** the second `intelligence/adapters` abstraction is deprecated → merged (AI-ARCH ADR-001).

---

## C2. Generation Runtime Contract

- **Purpose:** the single content orchestration — context → grounding → prompt → safety → gateway → validation → originality → moderation → persist → observe.
- **Owner:** Content Platform. **Canonical module:** `content/runtime/generationRuntime`.
- **Entry point:** `generate(req: GenerationRequest): Result<GeneratedContent>`.

**Request**
```
GenerationRequest {
  envelope:   RequestEnvelope
  contentType: 'post'|'thread'|'blog'|'article'|'story'|'carousel'|'caption'|...  // profile-driven, not new code
  intent:     { topic, objective?, audience?, ctaType?, extraInstruction? }
  platform?:  PlatformId
  campaignId?: UUID
  groundingOverride?: GroundingHandle   // else runtime resolves via Grounding contract
}
```

**Response**
```
GeneratedContent {
  master:   ContentUnit                 // canonical spine row identity
  variants: PlatformVariant[]           // one per requested platform (differentiated)
  provenance: Provenance
  originality: OriginalityDecision      // §C5
  lifecycle:  LifecycleState
}
```

- **Execution lifecycle:** exactly the ordered states in Substrate §S4; **no stage is skipped or duplicated**; each stage is a contracted call (Grounding→Prompt→Safety→Gateway→Validation→Originality→Safety→Persist).
- **Validation rules:** output conforms to the content-type output contract (Prompt §C3); structural failure → single bounded regeneration, else `VALIDATION_REJECTED`.
- **Failure semantics:** grounding floor breach → `GROUNDING_MISSING_PROFILE` (fail-closed/queue, no silent generic output); originality block → regenerate-once then `ORIGINALITY_BLOCKED`; safety block → `SAFETY_BLOCKED`. Fall-back-safe cutover (ADR-014).
- **Extension rules:** a new content type is a **new profile** (prompt/grounding/validation/originality config), never a new orchestration.
- **Observability:** emits a UsageRecord + lifecycle terminal + grounding/originality signals per generation, correlated by `correlationId`.
- **Consumers:** Writer, Creator (copy), Campaigns (content), scheduled/BOLT. **Dependencies:** all core contracts.
- **Deprecation:** legacy inline post/thread paths, `unifiedContentGenerationEngine`, `contentGenerationService`, and the BOLT bypass are superseded by this contract.

---

## C3. Prompt Assembly Contract

- **Purpose:** deterministically assemble the exact system+user bytes from grounded inputs. Owns the bytes.
- **Owner:** AI Platform. **Canonical module:** `content/runtime/promptAssembler`.
- **Entry point:** `assemble(input: PromptInput): Result<AssembledPrompt>`.

**Request / Response**
```
PromptInput {
  envelope: RequestEnvelope
  contentType: ContentTypeId
  grounding:  GroundedContext           // §C4 output
  persona:    IdentityLock              // one builder
  brand:      BrandContract             // FULL brand (voice+vocab+compliance), §Brand
  platform?:  PlatformId
}
AssembledPrompt {
  system:  string                       // untrusted text delimited/escaped (Safety §C6)
  user:    string
  outputContract: OutputContract        // the expected structured shape
  version: ContractVersion              // ONE CONTENT_GENERATION_PROMPT_VERSION
  fingerprint: Sha256                   // ONE algorithm; comparable across the platform
}
```

- **Inputs:** system instructions (one content-type source), context blocks (one builder set), persona (one identity builder), brand voice (full contract), reasoning directives (per content-type profile), platform variant rules (one variant system).
- **Output format:** every content type declares one `OutputContract`; the gateway enforces it via safe-parse.
- **Prompt fingerprinting / versioning:** exactly one `version` constant and one sha256 `fingerprint`; no duplicate/colliding definitions.
- **Extension mechanism:** new context block = registered + versioned; never inline.
- **Validation:** untrusted fields (crawl/competitor/user) MUST be delimited/escaped before entering `system` (Safety contract precondition).
- **Invariant:** no duplicated prompt ownership; the assembler is the only owner of assembled bytes.

---

## C4. Grounding Contract

- **Purpose:** produce the single canonical grounded context for a tenant, deterministically, with a floor and freshness guarantees.
- **Owner:** AI Platform. **Canonical module:** `getCanonicalProfile` / `canonicalContentContextResolver`.
- **Entry point:** `ground(req: GroundingRequest): Result<GroundedContext>`.

```
GroundingRequest { envelope; companyId; contentType?; campaignId?; platform?; need: GroundingNeed[] }
GroundedContext {
  company:  CompanyGrounding
  brand:    BrandContract
  campaign?: CampaignGrounding
  website:  WebsiteGrounding             // deterministic, real crawl
  history:  ContentHistory               // company-scoped
  conversation?: ConversationMemory      // tenant-scoped (Engagement)
  retrieval: RetrievedKnowledge          // embedding retrieval (Knowledge)
  freshness: FreshnessLabel              // today|recent|aging|stale — ENFORCED, event-time
  confidence: Confidence
  provenance: Provenance
}
```

- **Guarantees:** single deterministic assembly (same inputs → same context, excluding timestamps); **grounding floor** — missing profile ⇒ `GROUNDING_MISSING_PROFILE` (fail-closed/queue), never silent generic output; **freshness gate** — `stale` triggers warn/refresh/block per policy, never silently proceeds.
- **Missing-data behavior:** unmeasured facets report `basis:'default'`, never a fabricated confidence; unimplemented sources report `not_evaluable`, fail to null (not to invention).
- **Grounding metadata:** every context carries `freshness` + `confidence` + `provenance`.
- **Consumers:** Prompt Assembly (all products). **Dependencies:** profile store, Website Intelligence, Knowledge, Brand.

---

## C5. Originality Contract

- **Purpose:** decide uniqueness of a candidate against per-company memory across lexical + semantic tiers, for every generation path.
- **Owner:** Content Platform. **Canonical module:** `originalityGate` + `contentMemoryService`.
- **Entry point:** `assertOriginality(req: OriginalityRequest): Result<OriginalityDecision>`; `index(unit: ContentUnit): Result<void>`.

```
OriginalityRequest {
  envelope; companyId; contentType; platform?; campaignId?
  candidate: { text; normalized; simhash; embedding }   // embedding REQUIRED (tier active)
  thresholds?: Thresholds                                 // else canonical defaults
}
OriginalityDecision {
  decision: 'original' | 'duplicate' | 'bypassed'
  score:    0.0..1.0
  maxSimilarity: 0.0..1.0
  matchedBy: 'exact'|'normalized'|'simhash'|'jaccard'|'structural'|'embedding'|'variant'|null
  matchRef?: ContentRef
}
```

- **Similarity thresholds (contract defaults):** exact/normalized hash → SimHash 0.90 → Jaccard/minhash 0.82 → structural (semantic floor 0.60) → **embedding cosine 0.92 (ACTIVE)** → variant 0.85. `isOriginal = score ≥ 0.82`.
- **Embedding requirement:** candidates and indexed rows carry a real embedding (`text-embedding-3-small`, pgvector). No null-embedding indexing.
- **Memory indexing:** every generated unit is indexed, keyed by (company, content_type, platform).
- **Cross-platform uniqueness:** variant axis compares siblings on the same platform (anti-collision).
- **Cross-campaign uniqueness:** campaign is a narrowing filter, never a boundary hiding repeats.
- **Cross-company policy:** dedup is per-company by design; cross-company collision is prevented upstream by the grounding floor (never by cross-tenant comparison).
- **Coverage (mandatory):** post · thread · carousel · story · caption · headline · CTA · hashtag · blog · scheduled/BOLT — all gated or indexed; **no bypass path exists**.
- **Exception handling:** any internal error → `bypassed` (logged) — fail-open for availability, but coverage/indexing are contractually required so bypass is the exception, not the norm.

---

## C6. Safety Contract

- **Purpose:** bracket generation — validate/defend inputs before the LLM, moderate outputs before persist/publish. Fail-closed.
- **Owner:** Platform Reliability. **Canonical modules:** pre-gen guard + `moderation/*` (output) + `aiRequestGuard` (abuse).
- **Entry points:** `screenInput(p: PromptScreenRequest): Result<ScreenVerdict>`; `moderateOutput(o: OutputModerationRequest): Result<ModerationVerdict>`.

```
ScreenVerdict   { allow: boolean; sanitizedSystem?: string; findings: Finding[]; risk: 'none'|'low'|'med'|'high' }
ModerationVerdict { allow: boolean; categories: Category[]; requiresHumanReview: boolean; auditId: UUID }
```

- **Pre-generation validation:** delimit + escape untrusted text (crawl/competitor/user) before system-prompt injection; enforce **instruction hierarchy** (system > developer > grounded-data > user; data is never executable instruction); reject impossible/oversized requests.
- **Prompt-injection defense:** scan grounded/user fields for instruction-override patterns; on detection → sanitize or `SAFETY_INJECTION_BLOCKED`.
- **Policy enforcement / compliance:** tenant policy + brand compliance facet checked.
- **Post-generation moderation:** generated content AND engagement replies scanned before persist/publish; slurs/PII/spam/regulated-claims → block or route to human review.
- **Risk classification / human review triggers:** complaints, negative sentiment, regulated claims, high-risk categories → `requiresHumanReview:true`.
- **Blocking behavior:** injection defense and output moderation **fail closed** (block on error). The abuse guard is fail-open by explicit, documented tradeoff.
- **Audit trail:** every screen/moderation decision writes an `auditId`-tagged record, correlated by `correlationId`.
