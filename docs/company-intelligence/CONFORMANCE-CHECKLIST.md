# Conformance Checklist — Mandatory Production Gate

**This is not a suggestion. It is the architectural gate that every pull request against the Company Intelligence Platform must pass.**

Complete this checklist on every PR that touches company-intelligence code (Identity, Evidence, Knowledge, Trust, Generation, Distribution — including grounding, validation, conversation, projections, and learning). A reviewer blocks the PR on any unchecked item that applies, and on any CI census regression (see [`GOVERNANCE.md`](GOVERNANCE.md) §3).

Each item maps to a **DESIGN-002 invariant (Pxx)**, an **IMPLEMENTATION program + phase**, and a **certification gate**. Citation keys: `[D2]` DESIGN-002, `[I1]` IMPLEMENTATION-001, `[I2A]`–`[I2H]` context programs.

How to use: mark `[x]` if satisfied, `[n/a]` if the item does not apply to this PR (state why), `[waiver:<id>]` if a governed waiver exists (see GOVERNANCE §5). An item that applies and is neither satisfied nor waived **blocks merge**.

---

## 1. Ownership Boundary

- [ ] **No new write authority introduced.** All persistence to knowledge state goes through the single Knowledge write authority.
  Ref: **P3** · [I2A] Phase 1 · **Gate: I2A §14.1 (writer census = 1)**
- [ ] **No context writes outside its boundary.** The change touches only its own context's owned concerns.
  Ref: **P30** · each program §3 (boundary) · **Gate: boundary tests**
- [ ] **No ownership overlap added.** No concern gains a second owner.
  Ref: **P17** · [D2] §15 · **Gate: ownership census**

## 2. Context Ownership

- [ ] **Facts** mutated only via Knowledge mutations (ObserveFact/ConfirmFact/CorrectFact/ContradictFact/…).
  Ref: **P8, P15** · [I2A] §5 · **Gate: I2A §14.4 (immutable history), §14.1**
- [ ] **Confidence** computed only by the Trust engine; not self-reported by generators.
  Ref: **P12** · [I2B] §4 · **Gate: I2B §16.1 (confidence engine = 1)**
- [ ] **Evidence** immutable from birth; superseded, never edited.
  Ref: **P1** · [I2C] §5 · **Gate: I2C §15.2 (immutability)**
- [ ] **Grounding** assembled only by the Grounding Authority; not by ad-hoc serialization.
  Ref: **P11** · [I2D] §5 · **Gate: I2D §17.1**
- [ ] **Prompts/models/packs** governed as versioned assets; no inline prompts, no direct model reads.
  Ref: **P16** · [I2F] §5–8 · **Gate: I2F §16.3, §16.4**
- [ ] **Projections** derived, never hand-edited.
  Ref: **P26** · [I2G] §3 · **Gate: I2G §16.4**
- [ ] **Learning** recommends only; never mutates another context directly.
  Ref: **P14** · [I2H] §3 · **Gate: I2H §16.3**

## 3. Canonical Authority (the four singletons)

- [ ] One write authority · Ref: **P3, P4** · [I2A] · **Gate: I2A §14.1**
- [ ] One grounding authority · Ref: **P4, P11** · [I2D] · **Gate: I2D §17.1**
- [ ] One confidence vocabulary/engine · Ref: **P4, P12** · [I2B] · **Gate: I2B §16.1**
- [ ] One conversation engine · Ref: **P4, P17** · [I2E] · **Gate: I2E §15.1**
- [ ] **No fifth singleton introduced** (no new writer/grounding/confidence/conversation stack).
  Ref: **P4** · [D2] §13 · **Gate: all four census rules**

## 4. Consumer Registration

- [ ] **Every consumer is registered** with a declared profile (required/optional knowledge, confidence floor, freshness, fallback, explainability).
  Ref: **[D2] §6** · [I2D] §4, [I2G] §4 · **Gate: I2D §17.7, I2G §16.2**
- [ ] **No unregistered consumer obtains grounding or a projection.**
  Ref: **P11** · [I2D] §4 · **Gate: I2D §17.3**
- [ ] Per-field consumer list is **derived from declarations**, not hand-maintained.
  Ref: closes A2 C12 · [I2G] §4 · **Gate: I2G §16.2**

## 5. Event Compliance

- [ ] **All cross-context effects are evented** (no out-of-band notification channel).
  Ref: **P23** · [D2] §5 · **Gate: each program event suite**
- [ ] Events carry the full envelope (tenant, aggregate id+version, causation/correlation, producer+version, timestamp).
  Ref: **[D2] §5** · **Gate: event correctness suites**
- [ ] Consumers are **idempotent**; ordering is per-aggregate; replay rebuilds read models.
  Ref: **[D2] §5** · **Gate: idempotency + replay tests**

## 6. Validation

- [ ] **No generated value persists without a `ValidationPassed` token**, on any path (including client-mediated).
  Ref: **P19** · [I2D] §7 · **Gate: I2D §17.2, I2E §15.6, I2F §16.5**
- [ ] Observable fields extract-or-null; interpretive fields inference-labeled; **no fabricated content**.
  Ref: **P10, P20** · [I2D] §7 · **Gate: I2F §16 (PT fallback deleted)**
- [ ] Contradictions surfaced, never silently resolved.
  Ref: **P13** · [I2D] §7 · **Gate: I2A §14, I2D §17.6**

## 7. Grounding

- [ ] **Every AI workflow consumes a Grounding Context**; no raw profile-row serialization.
  Ref: **P11** · [I2D] §5, [I2F] §9 · **Gate: I2D §17.1, §17.6**
- [ ] **No prohibited grounding inputs** (raw rows, AI-output-as-evidence, unlabeled inference, cross-tenant, unattributed).
  Ref: **[D2] §7** · [I2D] §5 · **Gate: I2D §16 (prohibited-input scan)**
- [ ] Grounding is **deterministic** (identical inputs → identical context) and **read-only** (never triggers generation).
  Ref: **P2** · [I2D] §5 · **Gate: I2D §17.4**

## 8. Projection

- [ ] **No direct canonical reads** — consumers read projections (display) or grounding (AI), never `company_profiles` directly.
  Ref: **P26** · [I2G] §6 · **Gate: I2G §16.3 (direct-read census = 0)**
- [ ] **ProjectionUpdated is the sole freshness signal**; no localStorage/CustomEvent side channels.
  Ref: closes A2 C11 · [I2G] §9 · **Gate: I2G §16.6**
- [ ] Projections are rebuildable from Facts at any version.
  Ref: **[D2] §10** · [I2G] §5 · **Gate: I2G §16.4 (replay)**

## 9. Learning

- [ ] **No unmanaged learning** — no feedback-driven behavior change outside the Learning Runtime.
  Ref: **P14** · [I2H] §3 · **Gate: I2H §16.1, §16.3**
- [ ] **No production behavior changes automatically** — learning recommends; owning context adopts through governance.
  Ref: **P14** · [I2H] §7 · **Gate: I2H §16.3**
- [ ] Learned adjustments are reproducible and version-tracked.
  Ref: **P12** · [I2H] §5 · **Gate: I2H §16.7**

## 10. Versioning

- [ ] Every versioned artifact (evidence, knowledge, grounding, prompt, model, projection, confidence, consumer contract) is **SemVer'd**; MAJOR changes serve N/N−1.
  Ref: **[D2] §10** · [I1] §10 · **Gate: versioning suites**
- [ ] Frozen-contract changes go through the amendment process (GOVERNANCE §4), not ad hoc.
  Ref: **P30** · [D2] §10 · **Gate: amendment record present**

## 11. Rollback

- [ ] The change is **flag-gated** and revertible without a data operation.
  Ref: **[I1] §9** · each program §13–14 · **Gate: rollback verified**
- [ ] Rollback preserves data integrity (append-only history) and does not interrupt any consumer.
  Ref: **P15** · each program §14 · **Gate: no-loss / no-interruption proof**
- [ ] Legacy path retained (dormant) through its declared sunset window.
  Ref: **[I1] §13** · **Gate: retirement staging**

## 12. Observability

- [ ] Every new seam emits fail-safe bounded metrics; every event type has counters/latency/dead-letter visibility.
  Ref: **[D2] §5** · [I1] §15 · **Gate: observability dashboards live**
- [ ] Silent data loss is impossible — any dropped write is an error, never a warning.
  Ref: **P29** · [I2A] §14 · **Gate: I2A §14.3**

## 13. Performance

- [ ] Latency and cost within declared per-consumer/per-workflow budgets vs. the phase baseline.
  Ref: **P24** · [I1] §15 · **Gate: performance certification**
- [ ] Every generation records cost; cost policies govern every AI stage.
  Ref: **P24** · [I2F] §7 · **Gate: I2F §16.11**

## 14. Security

- [ ] SSRF/outbound-fetch posture non-regressed (safeFetch layer preserved).
  Ref: [I2C] §6 · **Gate: I2C §15.7**
- [ ] Role/authorization enforced uniformly at the write/mutation seam (not per-endpoint variance).
  Ref: [I2A] §4 · **Gate: I2A §14.7**
- [ ] No credential/PII leakage in events, provenance, or diagnostics (keys only, never values).
  Ref: **[D2] §5** · [I2B] §6 · **Gate: security suite**

## 15. Multi-tenancy

- [ ] Tenancy is **structural** on every new object (FK-bound), not enforced by call-site filters.
  Ref: **P21** · [D2] §2 · **Gate: each program tenancy suite**
- [ ] Cross-tenant reads/writes are impossible by construction; caches are tenant-scoped.
  Ref: **P21** · [I2G] §8 · **Gate: tenancy tests = zero leaks**

## 16. Testing

- [ ] Unit + integration + contract + event + replay + rollback + tenancy + performance suites present for the change.
  Ref: each program §-Testing · **Gate: exit bars met**
- [ ] Certified legacy contract tests (KG, confidence math, competitor gates, PT flow, CKRE, canonical rollout) remain green.
  Ref: [I1] §10 · **Gate: no regression**
- [ ] Coverage holes closed where the change touches previously-untested workflows (marketing draft, prompt assembly, normalization/save).
  Ref: A4 §1 · **Gate: coverage map**

## 17. Production Readiness

- [ ] Explainability complete — every persisted fact answers the seven questions (why / based on what / confidence / last updated / by whom / evidence / alternatives).
  Ref: **P7** · [D1] §12 · **Gate: I2D §17.5, explainability suite**
- [ ] All applicable phase gate items ([I1] §6) for this change's phase are satisfied.
  Ref: **[I1] §15** · **Gate: phase gate**
- [ ] The change advances a census toward target and regresses none.
  Ref: **[D2] §12** · GOVERNANCE §3 · **Gate: CI census**
- [ ] No item above is unresolved without a governed waiver.
  Ref: **P30** · GOVERNANCE §5

---

## Quick reference — the five headline census rules

| Rule | Must be | Gate |
|---|---|---|
| No new write authority | writer census = 1 | I2A §14.1 |
| No grounding bypass | bypass census = 0 | I2D §17.3 |
| No direct canonical reads | read census = 0 | I2G §16.3 |
| No unregistered AI workflow | LLM-call census = 0 | I2F §16.1 |
| No unmanaged learning | learning census = 0 | I2H §16.1 |

A PR that raises any of these **cannot merge**.
