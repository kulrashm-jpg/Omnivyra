# IMPLEMENTATION-002A — Knowledge Context Implementation Program v1.0

**Status:** Authoritative program for the Knowledge Context (WS-K, Phase 1). Inputs frozen: [A1–A4], [D1], [D2], [I1]. Distinguishing invariant: **no conversation ever re-asks a satisfied node; no context writes a Fact except through this authority** (P3/P8/P15).

**Classification: Ready for Development.**

---

## 1. Executive Summary

The first and most consequential cutover: replaces the certified ten-writer persistence surface [A2 §2.1] with **one constitutional write authority**, establishes append-only Fact versioning with lineage, makes locks real, makes contradictions first-class, and closes the two early-fix defects (unvalidated chat-save [A3 §7]; confidence key registry groundwork [A3 §6]). A writer-by-writer strangle: authority goes live dark, shadows every legacy write, proves zero-unauthorized-overwrite, absorbs writers lowest-risk-first with the main save path last. Storage is not remodeled — the authority owns the existing storage seam initially (dual-writing version/lineage), so rollback is always a flag re-point.

## 2. Repository Inventory

**11 writers (census):** W1 saveProfile (Refactor → primary client; report_settings full-replace + column-drop retry retired), W2 AI refine (Refactor → Observe/Propose mutations), W3 bootstrap (Refactor → SeedFacts), W4 metadata refresh, W5 touchRefreshedAt, W6 setup-company, W7 guidance, W8 PT answers, W9 sub-key stores (with per-sub-key arbitration, closes C4), W10 governance + ops, W11 content-type-prefs — all Refactor to authority clients. Service barrel Refactor (dissolution zone); KG module Preserve (extends with Contradicted); dead endpoints Retire; tables Preserve as storage seam; refinements table → lineage substrate.

## 3. Knowledge Boundary (frozen)

**Owns:** Facts, Knowledge Nodes, Relationships, Fact state, version history, Contradictions, User Authority, Knowledge mutations, Knowledge events. **Does NOT own:** Evidence (references ids), AI/prompts/grounding, Confidence (stores what Trust computes), Projections, Review dispositions. Transitional custody of report_settings sub-keys during Phase 1 only.

## 4. Write Authority Specification

Single entry; only component with storage-seam write access (CI census). Mutation envelope: tenant/company, actor + class, basis (evidence/grounding/user-input), target field key (registry-validated), proposed value, expected-current-version, validation token. Ownership enforcement by field contract per actor class. Uniform auth at the seam. Conflict detection → version-check failure rejects; conflict with confirmed fact → auto-ContradictFact (never overwrite). Lock enforcement (fails loudly, P25). Version creation + transactional event.

## 5. Mutation Model

CreateCompanyKnowledge, SeedFacts (fill-empty), ObserveFact (evidence required; validation token for generated), ProposeFact (validation token + inference label mandatory), ConfirmFact (user/reviewer), CorrectFact (user only, +lock, Learning Signal), ContradictFact (auto), SupersedeFact, RestoreFact, MergeFacts/SplitFact, DeprecateFact/RetireFact, ArchiveFact, RecordSystemState (merge-only, no full-replace), RecordUserGuidance/TouchFreshness. Each: actor class, input, validation, transition, version, events, rollback. **No DeleteFact** — knowledge is append-only (P15).

## 6. Fact Versioning

One immutable version per mutation (value + state + actor + basis + provenance ref + parent). History never edited/deleted; current is a movable pointer; supersession records why; restoration creates a new head; lineage seeded from refinements history (honestly marked migrated). Legacy readers unchanged throughout Phase 1 — versioning additive.

## 7. State Machine Integration

Facts (Unknown→Inferred→Observed→Confirmed + Corrected/Contradicted/Proposed); Relationships; Contradictions (Raised→UnderReview→Resolved|Withdrawn); User Authority (Unlocked→Locked→Released); version history append-only. Guards enforced as rejections + tests; forbidden transitions unreachable.

## 8. Validation Integration

Authority-side: schema (registry key, shape), ownership (actor class), lifecycle (legal transition), authorization, contradiction (auto-contradict), consistency (partition assertions), validation token (generator mutations require it). **Interim Phase-1 rule:** until WS-V (Phase 4), the authority runs preserved S-tier validators + Sem filter on the chat-save path — closing [A3 §7] immediately.

## 9. Event Integration

KnowledgeCreated/Changed/Superseded/Confirmed/Contradicted/Merged/Archived/Restored, SystemStateRecorded. Transactional with mutation; per-company ordering; idempotent by event id + version; replayable; observable; audited. KnowledgeDeleted does not exist (P15).

## 10. Legacy Writer Migration

Risk-ascending: (1) W5/W9/W11 (narrow, report_settings arbitration first, R2 relief); (2) W7/W10; (3) W4/W3/W6 (deterministic fill-empty); (4) W2 (AI refine + tokens); (5) **W1 saveProfile + W8 last** (carries [A3 §7] fix + real locks). Proof: CI writer census = 1 permanently.

## 11–12. Shadow & Rollback

Shadow writes + field diff + divergence taxonomy (unauthorized-overwrite MUST be 0); promotion per-writer per-tenant on zero unauthorized overwrites + performance + exercised rollback. Rollback: re-activate dormant legacy writer per tenant atomically; append-only history rollback-proof; no user-visible data loss (structural).

## 13. Testing

Unit, mutation matrix (actor × field authority), state-machine property (append-only unbreakable), authorization, event (transactional/ordering/idempotent/replay), rollback (exercised, data-equivalence), concurrency (C4 race defeated), tenancy, performance.

## 14. Certification Gates

(1) writer census = 1; (2) all 11 at enforce, legacy dormant; (3) shadow overwrite = 0, lock violations fail loudly; (4) immutable version history; (5) 100% lineage; (6) event correctness; (7) authorization correctness; (8) validation enforcement (chat-save exploit blocked); (9) rollback verified; (10) production safety + Phase-1 gate items.

## 15. Implementation Sequence

K0 Preparation (requires Phase 0 + census rule) → K1 authority core → K2 interim validation shim → K3 shadow harness → K4 writer waves 1–3 → K5 wave 4 (AI refine) → K6 wave 5 (saveProfile/PT) → K7 contradiction + user-authority completion → K8 certification → K9 retirement staging.

## 16–17. Certification

**Ready for Development.** Complete scope coverage; the writer census (11) closes the Critical risk (R1); every mutation/transition/event enumerated with rollback. Not "Production Implementation Ready" — execution awaits Phase 0's gate (the census, event bus, schema lineage); on that gate it upgrades automatically.

---
**Related:** [IMPLEMENTATION-001](IMPLEMENTATION-001.md) · [IMPLEMENTATION-002B](IMPLEMENTATION-002B.md) · **Depends on:** I1 · **Related ADRs:** [ADR-001](../adr/ADR-001-one-write-authority.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-002A-FULL.md`](../full/IMPLEMENTATION-002A-FULL.md) · **Certification:** Ready for Development · GATE-1. See [`../appendices/relationships.md`](../appendices/relationships.md).
