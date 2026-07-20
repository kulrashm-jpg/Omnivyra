# Contract Decision Records (AI-CONTRACT-000)

Binding decisions on the interface layer. Each CDR is stable; a change requires a superseding CDR + a MAJOR version bump (Versioning Contract).

---

### CDR-001 — One `Result<T>` outcome shape; no throwing across contract boundaries
Every subsystem returns `Result<T>` (Substrate §S9). Failures are typed values, not exceptions. **Why:** uniform error handling, no unhandled throws (OMNI-AI-001 found 17 unguarded `JSON.parse` sites throwing to callers).

### CDR-002 — One request envelope + correlation id spanning the lifecycle
Every call carries `RequestEnvelope` with a `correlationId` stable across all subsystems (Substrate §S1). **Why:** end-to-end tracing/billing correlation; artifact↔call linkage (OMNI-AI-001: `reasoning_trace_id` was throwaway).

### CDR-003 — Tenant scope is mandatory on every request, key, and read
No default tenant; missing tenant → `TENANT_REQUIRED` (§S2). **Why:** OMNI-AI-001 found tenant-agnostic in-flight/exact-cache keys (latent cross-tenant sharing).

### CDR-004 — One unified error model + code namespace
All failures use `AiError` (§S7 / Error Contract). No parallel error types. **Why:** consistent retryability/severity/user-vs-dev separation across subsystems.

### CDR-005 — Provider gateway fails closed; abuse guard fails open
A provider/validation/safety failure returns `{ok:false}` (never a fabricated completion); only the abuse guard fails open, by documented tradeoff. **Why:** integrity vs availability are separated intentionally.

### CDR-006 — Grounding has a floor and an enforced freshness gate
Missing profile → `GROUNDING_MISSING_PROFILE` (fail-closed/queue); `stale` is enforced, not merely computed. **Why:** OMNI-AI-001: grounding silently degraded to generic output; freshness computed but ignored (`autoRefine:false` everywhere).

### CDR-007 — Originality requires the semantic (embedding) tier and full path coverage
Candidates/rows carry real embeddings; every generation path is gated or indexed. **Why:** the embedding tier was dead (null embeddings); scheduled/BOLT/creator/blog bypassed originality.

### CDR-008 — Safety brackets generation on both sides
Pre-gen injection defense + instruction hierarchy; post-gen output moderation; both fail-closed. **Why:** near-absent injection defense and no output moderation (OMNI-AI-001 HIGH).

### CDR-009 — No fabricated evidence in Market Intelligence
Every non-deterministic claim carries ≥1 real citation; trust scores only over real cited sources; speculative output is labeled and never scored. **Why:** flagship MarketPulse was LLM-fabricated with trust theater (OMNI-AI-001 CRITICAL).

### CDR-010 — Deterministic, explainable decisions carry provenance
Scheduling/sequencing/allocation are pure rules with per-slot provenance; the ideation LLM call is temp-0 + seeded. **Why:** codifies the Campaign Intelligence strength as the platform contract.

### CDR-011 — Billing is explicit per operation
Every op is `billed` or `exempt(reason)`; system spend is costed. **Why:** most product AI was unbilled raw-gateway; the `generate*` wrappers skipped even the shadow guard.

### CDR-012 — Prompt assembly owns the bytes; one version + one fingerprint
The assembler owns assembled bytes; exactly one `CONTENT_GENERATION_PROMPT_VERSION` and one sha256 fingerprint. **Why:** version collision (`1` vs `'v3_unified'`), two fingerprint algorithms, three content-type prompt sources.

### CDR-013 — Full brand contract is injected wherever brand applies
Voice + vocabulary + compliance, uniformly across Writer/Creator/Engagement. **Why:** `brandRuntime` full contract was inert on Writer (only `brand_voice` reached prompts).

### CDR-014 — Extension is composition, never a second interface
New capabilities compose existing contracts; a new provider is an adapter behind the gateway; no responsibility gets a second interface. **Why:** enforces "No Duplicate Interfaces" against the fragmentation OMNI-AI-001 found.
