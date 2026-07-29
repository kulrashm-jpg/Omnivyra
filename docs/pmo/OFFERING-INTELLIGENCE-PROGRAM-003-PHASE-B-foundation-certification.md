# OFFERING-INTELLIGENCE-PROGRAM-003 — Phase B

## Canonical Offering Foundation, Adoption & Convergence — Certification

**Type:** Foundation implementation (adopt-not-rebuild; flag-dark, shadow-only, additive,
deterministic). **Verified 2026-07-28.** Branch `feat/lead-understanding-foundation`, commit `0d026a8e`.
**Authority:** Phase A (certified w/ adjustments); Programs 1 & 2 (production-certified — define the
shared spine). **Nature:** establishes the canonical Offering runtime by adopting the certified-shadow
design onto the shared contracts — no engines, no consumer migration, no production behaviour change.

---

## 0. Certification Decision

# ✅ PHASE B CERTIFIED

Offering is now the **third canonical Understanding entity** on the **shared** Product-Intelligence
spine: one Offering Understanding, one builder, one Facet evidence model, one reasoning contract, one
(shared, dimension-generic) scoring contract, one projection, one graph model, one persistence contract,
a shadow runtime, and observability — **reusing Programs 1 & 2's contracts, not forking them**, and
**adopting the certified-shadow OFFERING-UNDERSTANDING-001 domain design rather than rebuilding it**. The
three Phase-A adjustments (A-OI-1/2/3) are **all resolved**. 100% additive (Programs 1 & 2 preserved — the
one shared edit is a non-breaking graph-union widening; **81/81** tests incl. 71 Programs 1&2 regression),
both flags default OFF, tsc-clean.

| Validation requirement | Verdict |
|---|---|
| Certified shadow design adopted, not rebuilt | ✅ domain design (offering_type, discovery→resolution→projection, evidence-first) adopted onto the shared spine |
| Exactly one Offering Understanding | ✅ `offeringIntelligence/types.ts` |
| Shared canonical contracts reused | ✅ Facet/EvidenceRef/ReasoningTrace/GraphNodeRef/scoring from `intelligence/canonical` — **no fork** (resolves the shadow module's forked `Facet`) |
| Company no longer owns Offering semantics | ✅ Offering **solely** owns value-prop/pricing/features/positioning/lifecycle/adoption/integrations/roadmap; Company's `offerings` facet is a **name-list reference** |
| One builder / evidence / reasoning / projection / persistence / graph | ✅ single owners; shared spine |
| Zero duplicate ownership / drift | ✅ references-only graph; Programs 1 & 2 unchanged |
| Shadow runtime operational / production unchanged | ✅ `computeOfferingUnderstandingShadow` null when OFF; nothing imports it |

---

## 1. OI-B201 Offering Adoption + OI-B202 Shared Contracts

The certified-shadow OFFERING-UNDERSTANDING-001 design is **adopted, not rebuilt**: `offering_type`
(`product|service|bundle`, extensible), discovery→resolution→projection, evidence-first + abstain-null,
deterministic canonical id. Its **forked trivial `Facet<T>` (`evidence: string[]`) is replaced** by the
shared `Facet`/`EvidenceRef` (the OI-B202 reconciliation) — `offeringIntelligence` imports every contract
from `intelligence/canonical`; it redefines **none**. No certified functionality was rebuilt (the shadow
files live on a separate worktree and are superseded by this spine-aligned runtime).

## 2. OI-B203 Canonical Offering Runtime

`backend/services/offeringIntelligence/` — `OfferingUnderstanding` (24 facet domains + `offeringType`)
built solely by `buildOfferingUnderstanding`. `fromSeed.ts` is the adoption bridge:
`discoverOfferingSeeds(company products/services)` (Company **upstream**; Offering seeds from it),
`resolveOfferingId` (deterministic slug, exact-match dedup — no fuzzy), `offeringFromSeed` (project a
seed into canonical evidence + facets, abstain on absent fields — never fabricate).

## 3. OI-B204 Ownership Convergence

**Verified boundary:** the Offering entity is the **sole owner** of offering semantics — value
proposition, pricing, packaging, features, positioning, lifecycle, adoption, integrations, roadmap all
live **only** in `offeringIntelligence`. Company's `OfferingsValue` is `{ products: string[]; services:
string[] }` — a **name list (reference)**, never offering semantics; Company's `marketPosition` is
*company-level* market position (a distinct subject). **No duplicate ownership of offering semantics.**
*(Consumer-level rewiring — Company/GTM/Content reading the Offering projection — is Phase D, explicitly
out of scope here.)*

## 4. OI-B205 Evidence + OI-B206 Reasoning

The shared `EvidenceRef` (kinds, lifecycle, provenance, freshness, contradictions, abstention) and
`ReasoningTrace` + `validateReasoning` are reused (no duplicate systems). The shadow module's ad-hoc
`evidence: string[]` is superseded.

## 5. OI-B207 Graph + OI-B208 Projection

`offeringEdge`/`buildOfferingGraph` build offering-owned edges to Company/Feature/PricingPlan/Persona/
Industry/Integration/Competitor/… as **references only** (shared `GraphNodeRef`), self-loops rejected,
deduped. `GraphNodeType`/`GraphEdgeType` widened **additively** (`+feature/pricing_plan/persona/industry/
integration` + `has_feature/priced_as/serves_persona`) — non-breaking (A-OI-2). `projectOffering` is the
**single** projection owner (derived reshape, versioned, deterministic).

## 6. OI-B209 Shadow + OI-B210 Observability

`computeOfferingUnderstandingShadow` returns null when `OFFERING_UNDERSTANDING_ENABLED` is unset
(default) — no work, no side effects; when ON it builds from a seed and reports **field-parity**.
`summarizeOfferingRun` = pure observability. No live telemetry emission (keeps Phase B additive).

---

## 7. Verification

- **Tests:** `offeringUnderstanding.test.ts` (10) + Programs 1 & 2 regression (71) = **81/81 green**,
  deterministic — shared-contract reuse, discovery+resolution+seed adoption + abstention, single builder
  + projection + determinism, references-only graph, persistence + compat, field-parity shadow (parity=1
  when projected from the seed), flag-gating, observability, flags-OFF.
- **Types:** new module **tsc-clean** (0 errors).
- **Additivity:** `git diff` shows only `leadUnderstanding/types.ts` (the **non-breaking** graph-union
  widening); Programs 1 & 2 byte-behaviour intact (71 tests pass unchanged).

---

## 8. Certification Statement

Offering Intelligence now has a **canonical foundation on the same architectural spine as Lead and
Company Intelligence**: one `OfferingUnderstanding`, one builder, unified Facet evidence, shared
reasoning + dimension-generic scoring, single projection, references-only graph, persistence + compat
adapter, a shadow runtime, and observability — the certified-shadow **design adopted, not rebuilt**, its
forked Facet reconciled to the shared contract, Offering established as the **sole owner of offering
semantics**, and Programs 1 & 2 preserved. The three Phase-A adjustments (A-OI-1/2/3) are resolved.

**Decision: ✅ PHASE B CERTIFIED. Authorize Phase C — Analyst-Grade Offering Intelligence Pipeline.**

*Foundation only — flag-dark, shadow-only, additive; no engines, no consumer migration, no authoritative
mode, no deploy, no merge. Advancing to Phase C is your decision.*
