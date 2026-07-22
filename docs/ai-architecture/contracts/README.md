# Omnivyra Canonical AI Contracts (AI-CONTRACT-000)

The single authoritative interface specification for every shared AI subsystem. These contracts freeze the communication boundaries that engineering Waves 1–5 implement against. **Interface definition only — no code, no implementation, no architecture change.** Grounded in [AI-ARCH-000](../CANONICAL-AI-ARCHITECTURE.md) and OMNI-AI-001 evidence.

Architecture defines ownership; **contracts define communication.**

## Documents

| Doc | Contracts |
|---|---|
| [COMMON-SUBSTRATE.md](COMMON-SUBSTRATE.md) | Request envelope · tenant scope · lifecycle · provenance · confidence · `Result<T>` · error/version primitives · design principles |
| [CORE-CONTRACTS.md](CORE-CONTRACTS.md) | Provider Gateway · Generation Runtime · Prompt Assembly · Grounding · Originality · Safety |
| [PRODUCT-CONTRACTS.md](PRODUCT-CONTRACTS.md) | Brand · Knowledge · Campaign Intelligence · Creator AI · Engagement AI · Analytics · Market Intelligence |
| [PLATFORM-CONTRACTS.md](PLATFORM-CONTRACTS.md) | Observability · Billing · Unified Error · Versioning · Extension |
| [CONTRACT-DECISION-RECORDS.md](CONTRACT-DECISION-RECORDS.md) | 14 CDRs (binding) |

## Contract Design Principles

Single Responsibility · Explicit Inputs/Outputs · Deterministic Where Applicable · Strong Typing (conceptual) · Backward-Compatible Evolution · Observable by Default · Secure by Default · Tenant Isolation by Design · Fail-Safe Defaults · No Hidden Side Effects · No Duplicate Interfaces · Versioned from Day One · Implementation-Agnostic.

## Contract Dependency Graph

Request/response boundaries between adjacent layers. Every arrow is a contracted `Result<T>` call carrying the shared `RequestEnvelope`/`correlationId`.

```
Request ─envelope→ Context Assembly
   └→ Grounding Contract (C4)            → GroundedContext (+floor,+freshness)
       └→ Prompt Assembly (C3)           → AssembledPrompt (+version,+fingerprint)
           └→ Safety pre-gen (C6)        → ScreenVerdict (delimited/escaped | blocked)
               └→ Generation Runtime (C2)
                   └→ Provider Gateway (C1) → GatewayResponse (+usage) | AiError (fail-closed)
                       └→ LLM
                   ← Validation (safe-parse) → parsed | VALIDATION_BAD_OUTPUT
               └→ Originality (C5)        → OriginalityDecision (lexical+semantic)
           └→ Safety post-gen (C6)        → ModerationVerdict (allow | blocked | human-review)
       └→ Persistence (Knowledge P1)      → ContentUnit + memory index (lexical+embedding)
   └→ Observability (X1) + Billing (X2)   → UsageRecord + BillingRecord (correlationId)
Response ← Result<GeneratedContent>
```
Cross-cutting contracts — **Error (E1)**, **Versioning (V1)**, **Extension (Z1)** — apply at every boundary. Non-content subsystems (Campaign P2, Market P6, Analytics P5, Engagement P4) compose the same core contracts over the subset of the lifecycle they use.

## Cross-Contract Consistency Report — CONSISTENT

| Consistency dimension | Verdict | Basis |
|---|---|---|
| Terminology | ✅ | one substrate; subsystems reference, never redefine |
| Common identifiers | ✅ | `requestId`/`correlationId`/`traceId`/`reasoningId` (Substrate §S1, X1) |
| Correlation IDs | ✅ | one `correlationId` spans the lifecycle (CDR-002) |
| Lifecycle states | ✅ | one ordered state set (§S4); subsystems map onto their subset |
| Observability model | ✅ | one `UsageRecord` + quality signals (X1); every layer emits |
| Security model | ✅ | tenant scope mandatory (§S2/CDR-003); safety fail-closed (C6/CDR-008) |
| Versioning policy | ✅ | one semver policy, `CONTRACT_INCOMPATIBLE` on MAJOR mismatch (V1) |
| Error model | ✅ | one `AiError` + code namespace (E1/CDR-004) |

No contradictory contracts exist: each responsibility has exactly one interface; shared concerns are defined once in the substrate.

## Architecture Conformance Report — CONFORMS

Every contract conforms to AI-ARCH-000 without requiring architectural change:

| AI-ARCH element | Contract realization |
|---|---|
| One gateway / runtime / prompt / grounding / originality | C1 / C2 / C3 / C4 / C5 (one interface each) |
| Safety brackets generation | C6 pre-gen + post-gen, fail-closed |
| Deterministic & explainable decisions | P2 (provenance + reproducible) |
| No fabricated evidence | P6 + CDR-009 |
| Tenant isolation by design | §S2 + CDR-003 |
| Observability by default | X1 (mandatory emit) |
| Billing explicit | X2 + CDR-011 |
| Backward-compatible evolution | V1 + ADR-014/CDR-014 |

**Ambiguities/missing interfaces identified:** none blocking. Two interfaces are newly *named* by this release because AI-ARCH-000 mandated the capability but no single interface existed in-code (Safety pre-gen screen; the unified image seam) — both are specified here (C6, P3) and require implementation in Waves 1/3, not further interface design.

## Implementation Readiness Assessment

| Gate | State |
|---|---|
| Every shared subsystem has exactly one authoritative contract | ✅ (15 contracts, one per subsystem) |
| Every request/response boundary defined | ✅ (dependency graph; every arrow typed) |
| Every error path standardized | ✅ (E1, one model) |
| Common versioning strategy | ✅ (V1, semver from day one) |
| Cross-contract dependencies consistent | ✅ (consistency report) |
| All extension points documented | ✅ (Z1) |
| Conforms to AI-ARCH-000 with no redesign | ✅ (conformance report) |
| Implementation-ready for Waves 1–5 | ✅ |

## Final Certification

**Canonical AI Contracts Approved.**

Every shared AI subsystem exposes exactly one authoritative contract; every request/response boundary is defined; every error path is standardized on one model; every subsystem follows one versioning strategy; cross-contract dependencies are internally consistent; all extension points are documented; and every contract conforms to AI-ARCH-000 without requiring architectural change. The contract layer is implementation-ready and governs Waves 1–5 without further interface redesign.

**Scope note:** this release added only the `docs/ai-architecture/contracts/` specification set — no code, migration, refactor, rename, or runtime change. It is the frozen interface layer atop the frozen architecture; Wave 1 (safety + integrity) implements against C6, P6, C1(safe-parse), and the Error/Observability contracts first.
