# DESIGN-002 — Production Constitution v1.0

**Status:** Constitutional specification. Built on AUDIT-001..004 ([A1]–[A4]) and DESIGN-001 ([D1]). Freezes contracts; implements nothing. MUST/MUST NOT are conformance-binding.

**Classification: Production Constitution Complete.**

---

## 1. Executive Summary

Converts the six-context architecture into enforceable law: 24 objects with lifecycles, field-level contracts, a closed event vocabulary, consumer contracts, AI governance, the review model, the learning contract, versioning law, 30 platform invariants, measurable conformance, and compatibility guarantees. The constitutional test: an implementation is conformant iff it writes through the single write authority, grounds through the Grounding Authority, validates through the pipeline, uses the canonical confidence vocabulary, leaves every fact explainable, and violates no invariant.

## 2. Canonical Object Model

24 first-class objects, each tenant-bound with referential integrity, each answering its class's explainability questions, none mutated outside its owning context's write authority: Company, Evidence (immutable), Observation, Fact (append-only), Inference, Insight, Recommendation, Opportunity/Risk, Competitor, Audience/Goal/Strategy, Campaign/Content/Marketing/Context Intelligence (projections), Problem Transformation, Confidence (computed only), Provenance (immutable), Review, Conversation (turns are evidence), Learning Signal, Grounding Context (immutable snapshot). Explainability: Facts and derivations answer all seven questions; Evidence answers source/when/how; projections trace to fact versions; inferences retain their Grounding Context reference.

## 3. Canonical Field Contract Specification

**Contract law:** every field belongs to one object and one context; orphan fields prohibited (P18). Authority types: Observed, User (lock on edit), Derived-Deterministic (never hand-edited), Derived-Interpretive (inference-labeled, user-confirmable). Universal source priority: user confirmation > registry/external > site claim > structured metadata > AI extraction > AI inference. Overwrite defaults: user-authority never auto-overwritten (proposals only); observed superseded by better/fresher evidence with lineage; derived recomputed. The certified anti-patterns (classifier overriding user, null-then-overwrite, phantom locks) are unconstitutional. Full per-field contracts specified for Identity, Company Facts, Classification, Offering & Market, Commercial (7), Marketing (7), Problem Transformation (9), Campaign/Context, and Trust/system fields. Validation strictness and confidence ceiling follow determinability class.

## 4. State Machine Specification

Transitions not listed are forbidden; one owning context each. **Evidence:** Collected → Extracted → Active → {Superseded | Expired} → Archived. **Fact:** Unknown → Inferred → Observed → Confirmed + lateral Corrected/Contradicted/Proposed. **Inference/Generation:** Requested → Grounded → Generated → Validated → {Proposed → Accepted | Rejected} | Failed. **Recommendation:** Generated → Validated → Presented → {Accepted | Dismissed | Expired} → Archived. **Conversation:** Started → Active(turns) → {Completed | Abandoned}. **Review:** Requested → Assigned → {Accepted | Rejected | Corrected} → Closed / Expired. **Learning Signal:** Captured → Aggregated → Applied → Archived. **Confidence:** recomputed on triggers, history retained. Forbidden across all: non-user writes to Confirmed/Corrected; inference presented as observation; silent contradiction resolution; skipping validation; monotonic confidence floors; direct fact writes from conversation.

## 5. Domain Event Specification

Every event carries tenant, aggregate id+version, causation/correlation, producer+version, timestamp. Events are the **only** cross-context signal (dual notification stack unconstitutional). At-least-once delivery; idempotent consumers; per-aggregate ordering; dead-letter capture; per-type metrics; audit-retained. Full catalog specified per context (Knowledge, Trust, Evidence, Grounding+Validation, Conversation, Generation, Projections, Learning). Payloads reference objects by id+version, never embed mutable state.

## 6. Consumer Contract Specification

Every consumer declares and the Grounding Authority enforces: required/optional knowledge, minimum confidence per field class, freshness tolerance, refresh triggers, degradation, explainability pass-through. No consumer bypasses the Grounding Authority for grounding (P11); display/ops reads use projections. Twelve consumer contracts specified.

## 7. AI Governance Specification

**Prompt:** versioned governed assets; approved before production; retired formally; must declare determinability class + evidence-discipline clause; contradictory-stance prompts fail approval. **Model:** registered set; routing by capability/tier/cost/budget; fallback among approved; versioned; rollback. **Grounding:** versioned snapshots; required sections (knowledge/evidence/constraint/gap); prohibited inputs (raw rows, AI-output-as-evidence, unlabeled inference, cross-tenant, unattributed). **Generation:** deterministic boundary (observable extract-or-null; no fabrication), inference boundary (labeled, capped), hallucination boundary (claim without evidence = validation failure). **Evaluation:** offline judge bench = standing gate; per-workflow acceptance criteria gate prompt/model promotion; regression testing mandatory. **Safety:** protected fields (user-authority, confirmed/corrected) are AI-proposal-only; user authority absolute and permanent per field.

## 8. Review & Approval Specification

Auto-approved (within safety envelope), Needs Review (soft-flag/impact threshold/below floor), User Confirmation (user-authority fields), Admin Review (identity/cross-tenant/escalation), Terminal (Accepted/Rejected/Corrected — immutable, reviewer-attributed), Expired (conservative fallback). Dispositions captured as Learning Signals; Review triggers Knowledge transitions.

## 9. Continuous Learning Specification

Inputs: edits/corrections, confirmations, accept/reject, conversation corrections, content/campaign/engagement performance, review outcomes, bench results. Outputs (only permitted effects): confidence calibration, evidence-selection weights, industry-pack revisions, prompt-revision triggers, question-value re-ranking. Determinism preserved (adjusts declared-policy parameters, never behavior paths; reproducible). **Learning never silently changes Facts (P14).** Decay half-lives; retraining/prompt triggers via governance.

## 10. Versioning Specification

SemVer everywhere (MAJOR breaking, MINOR additive, PATCH corrective); every artifact records lineage; rollback = re-point, never destructive. Per-artifact compatibility rules for evidence, knowledge, grounding, prompt, model, generation, confidence, review, projection, conversation, consumer contracts, and this constitution.

## 11. Platform Constitution (Invariants P1–P30)

See [`../appendices/invariants.md`](../appendices/invariants.md) for the full table with rationale and audit anchors. The four singletons (P4): one write authority, one grounding authority, one confidence vocabulary, one conversation engine — permanent, non-waivable.

## 12. Architectural Conformance Rules

Measurable pass/fail per area, evaluated per PR and per release: Ownership (zero writers outside authority), Grounding (zero non-Grounding-Context AI inputs), Evidence (every fact links evidence or is inference-labeled), Confidence (zero self-reported keys; 100% composites), Provenance (100% coverage), Validation (zero unvalidated persistence), Lifecycle (zero forbidden transitions), Event (all effects evented), Consumer (all registered), Explainability (sampled fields answer seven questions). A release is conformant only if all areas pass; waivers require a versioned amendment.

## 13. Backward Compatibility Specification

Consumer projection shapes preserved; 96 consumers migrate by re-pointing (N/N−1 dual-serving). Off/shadow/enforce with divergence forensics is mandatory; shadow must show zero unauthorized overwrites before enforcement. Every subsystem lands dark, byte-faithful, per-tenant promotable, instantly revertible. Additive-first schema; single ordered migration lineage resolves the certified dual-source ambiguity. No consumer observes a behavior change without a contract version change and event trail.

## 14. Production Readiness Certification

Every certified defect class maps to a binding instrument (10 writers → P3/§12; 5 grounding → P4/P11; unvalidated chat-save → P10/P19; confidence drift → P6/P12; evidence mis-routing → P22; consistency vacuum → single-graph + Con tier; no learning loop → §9; deterministic fabrication → P20; tenancy by discipline → P21; dual stacks → P23).

## 15–16. Final Constitution & Certification

**Production Constitution Complete.** Every object, field, lifecycle, event, consumer, and governance surface has a binding contract. Every audit-certified defect is closed by a named invariant or contract, not intention. Conformance is measurable (§12). The remaining unspecified layers (APIs, schemas, migrations, tasks) are exactly what the constitution's constraints exclude by design — they are implementation realizations whose acceptance test is §12 + P1–P30. The platform is completely specified for implementation. Conformant work realizes the specification; non-conformant work is rejected regardless of local merit (P30).

---
**Related:** [DESIGN-001](DESIGN-001.md) · [IMPLEMENTATION-001](../implementation/IMPLEMENTATION-001.md) · [`../CONFORMANCE-CHECKLIST.md`](../CONFORMANCE-CHECKLIST.md) · **Depends on:** DESIGN-001 · **Related ADRs:** [ADR-001..010](../adr/README.md) · **Amendments:** none (change only via [`../amendments/`](../amendments/)) · **Editions:** Reference (this) · Full: [`../full/DESIGN-002-FULL.md`](../full/DESIGN-002-FULL.md) · **Certification:** Production Constitution Complete. See [`../appendices/relationships.md`](../appendices/relationships.md).
