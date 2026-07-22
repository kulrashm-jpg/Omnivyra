# IMPLEMENTATION-002A — Knowledge Context Implementation Program (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-002A.md`](../implementation/IMPLEMENTATION-002A.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

WS-K, Phase 1. Inputs frozen: [A1–A4], [D1], [D2], [I1]. Distinguishing invariant: **no context writes a Fact except through this authority; knowledge is append-only** (P3/P15). **Classification: Ready for Development.**

---

## 1. Executive Summary

The Knowledge Context is the first and most consequential cutover of the migration: it replaces the certified ten-writer persistence surface with **one constitutional write authority**, establishes append-only Fact versioning with lineage, makes locks real, makes contradictions first-class, and closes the two early-fix defects assigned to Phase 1 — the unvalidated chat-save path and the groundwork for the confidence key registry. The program is a **writer-by-writer strangle**: the authority goes live dark, shadows every legacy write, proves the zero-unauthorized-overwrite law, then absorbs writers in dependency order — lowest-risk system writers first, the main save path last — with per-writer flags and per-tenant enforcement. Storage is not remodeled in this program: the authority initially *owns the existing storage seam* (dual-writing the new version/lineage model alongside), so rollback is always a flag re-point and never a data migration.

## 2. Repository Inventory

**The writer census (11 writers)** with classifications: W1 `saveProfile` (Refactor → primary client; its lock computation and competitor resolution survive as mutation preprocessing; the `report_settings` full-replace and silent column-drop retry are retired under P29). W2 AI refine `buildRefinedPayload` (Refactor → emits `ObserveFact`/`ProposeFact`; direct upsert retired). W3 `bootstrapCompanyProfile` (Refactor → `SeedFacts`; fill-empty + idempotency preserved). W4 `refreshDiscoveredMetadata`, W5 `touchProfileRefreshedAt` (Refactor → `ObserveFact`/`TouchFreshness`). W6 `setup-company` + `onboarding/complete` (Refactor → `CreateCompanyKnowledge` + `SeedFacts`). W7 `guidance.ts` (Refactor → `RecordUserGuidance`). W8 PT answers (Refactor → PT-family mutations; confidence stamping moves to Trust in Phase 2). W9 six sub-key stores (Refactor → `RecordSystemState` with per-sub-key arbitration, closing C4; the sub-keys stay owned by their domains, only the seam changes). W10 governance + ops (Refactor). W11 content-type-prefs (Refactor). Other components: the 5-file barrel (Refactor, dissolution zone); the KG module (Preserve — becomes the Fact-state read model, extends with `Contradicted`); knowledge-writing endpoints (Refactor; `forced-context` Retire); tables (Preserve as the storage seam; refinements → lineage substrate); background jobs (Preserve, unaffected); event emitters (orchestration re-seat onto the bus, frontend channel Retire at Phase 7); validators (Preserve, wired into mutation validation); AI generators (out of boundary; interact only as mutation submitters); projections/consumers (out of boundary; reads not remodeled in Phase 1).

## 3. Knowledge Context Boundary (frozen)

**Owns:** Facts, Knowledge Nodes, Relationships, Fact state + version history (append-only), Contradictions, User Authority state (locks/confirmations/corrections), all Knowledge mutations + validation entry, Knowledge domain events. **Does NOT own:** Evidence (references ids, never stores observations), AI/prompts, Grounding, Confidence (stores what Trust computes), Projections, Review dispositions (executes the resulting transition only). Transitional custody of the shared `report_settings` sub-keys during Phase 1 only.

## 4. Write Authority Specification

Single entry; the only component with write access to the storage seam (CI census). The mutation envelope carries tenant + company identity, actor + actor class (user/deterministic-system/generator), basis (evidence ids, grounding-context id, or user-input marker), target field key(s) from the canonical registry (unknown keys rejected, P18), proposed value(s), expected-current-version (optimistic concurrency), and a validation token where required. Ownership enforcement per the field contract and actor class. Uniform authorization at the seam (resolving the certified per-endpoint variance). Conflict detection: version-check failure → rejected; value conflict with a Confirmed/Corrected fact by a non-user actor → automatic `ContradictFact` instead of overwrite. Lock enforcement (locked-field write by a non-user actor fails loudly, P25 — phantom locks impossible because locks and writes live at the same seam). Version creation + transactional event emission per accepted mutation.

## 5. Mutation Model

CreateCompanyKnowledge, SeedFacts (fill-empty), ObserveFact (evidence linkage required; validation token for generated values), ProposeFact (validation token + inference label mandatory, P10), ConfirmFact (user/reviewer), CorrectFact (user only, +lock, emits Learning Signal), ContradictFact (auto), SupersedeFact, RestoreFact (new head referencing old), MergeFacts/SplitFact (relationship integrity), DeprecateFact/RetireFact/ArchiveFact (retention), RecordSystemState (sub-key merge-only, full-replace prohibited), RecordUserGuidance/TouchFreshness. Each mutation specifies actor class, input, validation, transition, version behavior, emitted events, and rollback. **No DeleteFact** — knowledge is append-only (P15); deletion exists only as retention-law archival.

## 6. Fact Versioning

One immutable version per accepted mutation (value + state + actor + basis + provenance ref + timestamp + parent version). History never edited or deleted; "current" is a movable pointer. Supersession records why. Restoration creates a new head referencing the restored version — history never rewrites. Lineage: derived facts reference parent versions; the migrated refinements before/after history seeds retroactive chains, honestly marked `lineage-origin: migrated` where not derivable. Legacy readers continue reading the current-value seam unchanged throughout Phase 1 — versioning is additive alongside, guaranteeing no data loss and no reader disruption.

## 7. State Machine Integration

Implements [D2] §4 exactly. Facts (Unknown → Inferred → Observed → Confirmed + Corrected/Contradicted/Proposed); Relationships; Contradictions (Raised → UnderReview → Resolved|Withdrawn); User Authority (Unlocked → Locked → Released); version history append-only. Guards enforced as mutation rejections + property tests; forbidden transitions (non-user writes to Confirmed/Corrected; Inferred presented as Observed; silent Contradicted resolution; any transition skipping validation; in-place update) are unreachable.

## 8. Validation Integration

Content validation (Sem tier, generic filters, factuality) belongs to the Generation pipeline; the authority enforces that it happened and validates everything mutation-shaped: schema (envelope completeness, registry key, value shape), ownership (actor class admissible for the target field authority), lifecycle (legal transition), authorization (tenant + role), contradiction (auto-contradict vs current Confirmed/Corrected), consistency (partition assertions preserved), and a validation-token check (generator mutations require a ValidationPassed reference). **Interim Phase-1 rule (the early fix):** until WS-V stands up (Phase 4), the authority itself runs the preserved S-tier validators plus the existing Sem filter on the chat-save path — closing the certified launder gap immediately.

## 9. Event Integration

KnowledgeCreated/Changed/Superseded/Confirmed/Contradicted/Merged/Archived/Restored, SystemStateRecorded. Full envelope; transactional with the mutation; per-company ordering; idempotent by event id + aggregate version; replayable from history; observable; audit-retained. KnowledgeDeleted does not exist (P15); retention emits KnowledgeArchived.

## 10. Legacy Writer Migration

Risk-ascending: (1) W5/W9/W11 (narrow, mechanical; report_settings arbitration lands first, R2 relief); (2) W7/W10; (3) W4/W3/W6 (deterministic, fill-empty, idempotency markers preserved); (4) W2 (generator path, requires Propose/Observe + validation-token wiring); (5) **W1 saveProfile + W8 last** (the main user path; carries the launder fix and real-lock enforcement; response shape unchanged for the UI). **Proof (zero direct writers):** the Phase-0 static writer census runs in CI from program start; migration completes only when the census is exactly one (the authority) and stays there — a permanent conformance check.

## 11. Shadow Rollout Strategy

Shadow writes (legacy executes and serves; the authority records what it would write). Field-level diff per write, classified per a ratified taxonomy; the "unauthorized-overwrite class MUST be 0" law applies; forensic records are bounded, deduped, PII-free. Promotion criteria (per writer per tenant): zero unauthorized-overwrite divergences over the observation window; unexplained-divergence rate = 0; performance within budget; rollback exercised in a pre-production tenant. Enforcement: authority serves; legacy writer dormant (not deleted); dual-write of the version/lineage model continues from shadow onward.

## 12. Rollback Strategy

Per-writer, per-tenant flag re-point to the dormant legacy writer, atomic for a tenant's writes (no split-brain). Versions never rolled back — append-only history is rollback-proof; versions written during an enforce window remain valid lineage after a revert. Mutations individually reversible via pointer restores. Events: revert stops emission; subscribers idempotent; no un-emission. Guarantee: because the current-value seam is written identically under legacy and authority paths (verified by shadow) and history is additive, no rollback can lose user-visible data — structural, demonstrated by §13.

## 13. Testing Framework

Unit; mutation matrix (actor × field authority accept/reject); state-machine property (append-only unbreakable, no forbidden transition reachable); authorization matrices; event (transactionality, ordering, idempotent redelivery, replay); rollback (exercised revert per writer class + data-equivalence); concurrency (optimistic-version races; parallel sub-key writes — the C4 scenario defeated; lock races); tenancy (cross-tenant fail-closed); performance (mutation latency + shadow overhead); regression (the shadow diff as a standing production harness).

## 14. Certification Gates

(1) writer census = 1, permanent; (2) all 11 legacy writers at enforce with legacy dormant; (3) shadow unauthorized-overwrite = 0 across full windows; lock-violation writes fail loudly in production telemetry; (4) immutable version history (append-only property + storage-layer guard); (5) 100% lineage coverage; (6) event correctness; (7) authorization correctness (uniform seam auth); (8) validation enforcement (zero generator mutations without tokens; the chat-save exploit blocked in production verification); (9) rollback verified (one exercised production-tenant-class revert per writer class with data-equivalence proof); (10) production safety + all applicable Phase-1 gate items.

## 15. Implementation Sequence

K0 Preparation (requires Phase 0 complete; the writer-census CI rule lands here) → K1 authority core (envelope, registry, ownership/lifecycle/authorization validation, version+lineage dual-write dark, event emission) → K2 interim validation shim (S-tier + chat-save Sem) → K3 shadow harness → K4 writer waves 1–3 → K5 wave 4 (AI refine via Propose/Observe + tokens) → K6 wave 5 (saveProfile/PT) → K7 contradiction + user-authority completion (auto-contradict, restore/merge/split, phantom-lock realization) → K8 certification → K9 retirement staging.

## 16–17. Certification

**Ready for Development.** Every scope item has a binding specification traceable to its constitutional source, its blueprint slot, and its certification gate; the writer census (11) converts the Critical risk (unknown writers) into a guarantee; every mutation, transition, and event is enumerated with rollback. Not "Production Implementation Ready" — execution awaits Phase 0's gate (census, event bus, schema lineage); on that gate it upgrades automatically.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-002A.md`](../implementation/IMPLEMENTATION-002A.md) · [`IMPLEMENTATION-002B-FULL.md`](IMPLEMENTATION-002B-FULL.md) · **Related ADRs:** [ADR-001](../adr/ADR-001-one-write-authority.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** Ready for Development · GATE-1.
