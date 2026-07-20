# AI Architecture Decision Records (AI-ARCH-000)

Each ADR records a canonical decision, its context (OMNI-AI-001 evidence), the decision, and consequences. ADRs are binding on Waves 1–5; a deviation requires a superseding ADR.

---

### ADR-001 — The provider gateway is the single chat-LLM seam
- **Context:** OMNI-AI-001 verified one chat-SDK client (`aiGatewayCore.ts:523`), 103 consumers routing through it, zero product bypass; a second, divergent provider abstraction exists only for unbilled intelligence probes.
- **Decision:** `aiGatewayCore` is the sole chat seam. Image (`gpt-image-1`) and embeddings (`text-embedding-3-small`) are **sibling seams**, not bypasses. The `intelligence/adapters` abstraction is merged onto the gateway.
- **Consequences:** New providers = new adapters behind the seam. Retry/pooling/fallback policy is defined once. Gemini/Perplexity/Copilot, if productized, enter via the gateway.

### ADR-002 — One Generation Runtime owns content orchestration
- **Context:** Four live orchestrations (canonical runtime OFF by default; inline post/thread; long-form; BOLT); `unifiedContentGenerationEngine` carries a "DEPRECATED" banner yet is worker-wired.
- **Decision:** `content/runtime/generationRuntime.ts` is the sole content orchestration. `blueprintGenerator`/`platformVariantGenerator` are its primitives; the legacy inline path, `unifiedContentGenerationEngine`, and `contentGenerationService` are replaced then removed. BOLT and long-form route through the runtime.
- **Consequences:** Parity is no longer hand-maintained across copies (which bit once, WRITER-CERT-006). Cutover is flag-gated and fall-back-safe (ADR-014).

### ADR-003 — One prompt assembly system; no duplicated prompt ownership
- **Context:** ~5 assembly paths; 3 content-type prompt sources; duplicate `PLATFORM_VARIANTS_SYSTEM`; `CONTENT_GENERATION_PROMPT_VERSION` collides (`1` vs `'v3_unified'`); two fingerprint algorithms; dead V3 builders.
- **Decision:** `promptAssembler` owns the assembled bytes. One content-type system-prompt source, one variant system, one version constant, one sha256 fingerprint. Dead V3 builders and the orphaned registry entry are archived/removed.
- **Consequences:** Prompt drift becomes impossible by construction; fingerprints are comparable; telemetry logs one version.

### ADR-004 — One grounding engine with a grounding floor and freshness gate
- **Context:** Single canonical read exists (`getCanonicalProfile`), but grounding is silently optional (failed profile → generic output) and freshness is computed but never enforced (`autoRefine:false` everywhere; event-time-blind).
- **Decision:** One grounding engine. Generation MUST NOT silently degrade to ungrounded output (fail-closed/queue). The `stale` label is enforced at generation time.
- **Consequences:** Eliminates ungrounded generic output and the cross-tenant near-duplication root; stale snapshots no longer silently ground content.

### ADR-005 — One originality engine, both tiers live, all generation paths covered
- **Context:** Embedding/semantic tier is dead (no caller enables it; `content_memory.embedding` always null); only post/thread are gated; scheduled/BOLT, Creator, blog bypass or use separate validators.
- **Decision:** `originalityGate` is the one engine. The embedding-cosine tier is activated (populate embeddings; pgvector). Every generation path is gated or indexed — no bypass.
- **Consequences:** Paraphrase-level duplicates are caught; scheduled content becomes visible to dedup; "Originality Engine with embeddings" becomes true rather than aspirational.

### ADR-006 — Market Intelligence separates evidence tiers; no fabricated evidence
- **Context:** Flagship MarketPulse is LLM-fabricated (no retrieval/citations); signals persist with no `source_url` + hard-coded credibility; trust scores computed over synthetic single sources; a real ingestion pipeline exists but is disconnected; Authority Index emits nothing.
- **Decision:** Four labeled tiers (deterministic · retrieval-backed · inference · speculation). Trust/evidence scores only over real cited sources. Every persisted signal has a `source_url` or an explicit label. The real ingestion pipeline is the flagship source. Authority Index is activated or removed.
- **Consequences:** Users never see fabricated data dressed as evidence; "trust theater" is eliminated.

### ADR-007 — Safety brackets generation and fails closed
- **Context:** Near-absent injection defense (untrusted text raw-concatenated into system prompts); no output moderation; moderation runs only on inbound signals and is fail-open.
- **Decision:** A first-class safety layer: pre-gen injection defense (delimit/escape untrusted text + instruction hierarchy) and pre-publish output moderation, both fail-closed. Distinct from the abuse guard (fail-open by design).
- **Consequences:** Crawled/competitor/user text cannot hijack prompts; generated content and replies are scanned before publish.

### ADR-008 — Tenant isolation in every key and read
- **Context:** Stored-knowledge isolation is solid, but in-flight coalescing + exact-cache keys omit tenant id; `getThreadMemory` read isn't org-filtered.
- **Decision:** Tenant id is part of every cache/coalescing key; every memory read is org-filtered at the query level.
- **Consequences:** Latent cross-tenant response sharing is closed structurally, not by convention.

### ADR-009 — Deterministic, explainable decisions where possible (the Campaign model)
- **Context:** Campaign Intelligence boxes the LLM to temp-0 ideation and derives all scheduling/sequencing/allocation by rule with per-slot provenance and hard validators — the platform's strongest subsystem.
- **Decision:** This pattern is the reference. Scheduling, sequencing, allocation, and policy decisions are deterministic rules with provenance, not free-LLM. The plan ideation call is seeded.
- **Consequences:** Reproducible, explainable decisions; the LLM is confined to where non-determinism is acceptable (creative text).

### ADR-010 — One structured-output contract with a shared safe-parse
- **Context:** Only `json_object` mode; 17 unguarded `JSON.parse(output)` sites; no shared safe-parse/extract; a fenced/truncated completion throws unhandled.
- **Decision:** One safe-parse/extract utility + strict structured outputs where supported; no raw `JSON.parse` on model output.
- **Consequences:** Malformed completions degrade gracefully, not as failed generation.

### ADR-011 — Billing coverage is explicit per operation
- **Context:** Most product AI is unbilled raw-gateway; the `generate*` wrappers skip even the shadow billing guard; only ~4 routes bill.
- **Decision:** Every AI operation is either billed (`runBilledAiCompletion`) or explicitly exempt with a recorded reason; system/`UNKNOWN_ORG` spend is costed.
- **Consequences:** No blind cost/margin leakage; billing is a policy, not an accident of which wrapper was used.

### ADR-012 — Brand contract is fully adopted
- **Context:** `brandRuntime` models voice/vocabulary/compliance but only `brand_voice` reaches Writer prompts; Creator/Engagement do consume the full contract — an inconsistency.
- **Decision:** The full `brandRuntime` contract (prohibited/required terms, compliance, disclaimers) is injected uniformly across Writer, Creator, and Engagement.
- **Consequences:** Consistent brand/compliance enforcement across products.

### ADR-013 — One image generation seam, guarded
- **Context:** Two divergent direct-OpenAI image stacks bypass `aiRequestGuard`, each with its own guard/billing/moderation.
- **Decision:** One image seam, routed through the platform guard/billing/observability (a sibling to the chat gateway).
- **Consequences:** HARDEN-006's "one guard seam" invariant holds for image traffic; one prompt builder, one moderation path.

### ADR-014 — Backward-compatible, flag-gated evolution
- **Context:** The Writer-runtime cutover (`WRITER_RUNTIME_DELEGATION_ENABLED`) is flag-gated and fall-back-safe (certified parity, WRITER-CERT-006).
- **Decision:** Every consolidation cutover is flag-gated, fall-back-safe, and parity-verified before the legacy path is removed.
- **Consequences:** Waves 1–5 ship without regression risk; removal follows verified parity.
