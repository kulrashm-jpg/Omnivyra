# IMPLEMENTATION-002C — Evidence Context Implementation Program v1.0

**Status:** Authoritative program for the Evidence Context (WS-E, Phase 3; parallels Phase 2). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A], [I2B]. Distinguishing invariant: **Evidence is immutable from birth — superseded, never edited** (P1).

**Classification: Ready for Development.**

---

## 1. Executive Summary

Makes every observation an immutable, attributed, versioned, freshness-governed object and **routes all of it to every consumer** — resolving the certified quality root cause: evidence is unrouted, not unavailable [A4 §2]. Collapses the two crawlers into one collection layer over one store; promotes JSON-LD from fingerprint hashes to typed evidence; captures conversation turns and generation outputs as first-class evidence. The certified deterministic backbone (refresh gate, change detection, fingerprinting, SSRF) is preserved and re-homed as the collection policy engine. An additive-shadow strangle.

## 2. Repository Inventory

crawlWebsiteSources → emit Evidence Objects; BFS crawler → collection strategy; metadata extractor → typed evidence; **JSON-LD → typed structured-data evidence** (dual use, fixes [A4 §2]); Wikidata/Wikipedia → routed to all; Crunchbase/Bloomberg → Preserve (dark); blog/post reads → historical evidence for all. Refresh gate/change detection/fingerprint/SSRF → Preserve. Cache → tenant-scoped key (closes global-key concern). Collection-state writes → route through Knowledge authority (RecordSystemState). canonical_pages Preserve; report_settings sub-keys via authority.

## 3. Evidence Boundary (frozen)

**Owns:** Evidence Objects, Observations, versioning/supersession, attribution, freshness + decay signals, evidence-class reliability, collection policy/scheduling/transport, the store. **Does NOT own:** Facts (supplies basis), Confidence (supplies class reliability as a Trust dimension input), Grounding, AI/Generation, Projections. Writes company-profile collection state only through the Knowledge authority (P3).

## 4. Evidence Object

Identity (content-addressed), type (12 kinds), source attribution, immutable versioning, freshness (valid-until per type), evidence confidence (source-class reliability — Trust dimension input), traceability (reverse index). Observation = typed immutable extraction. Rules: evidence-first everything; both crawlers one store; structured data first-class; external knowledge routed; historical generations = voice evidence; connectors emit objects.

## 5. Lifecycle & State Machine

Collected → Extracted → Active → {Superseded | Expired} → Archived. Guards: complete attribution before Active; supersession = same-locator newer. Forbidden: edit-in-place (P1); Archived→anything; deletion outside retention; fabricated observations. Freshness signals → Trust decay + collection policy.

## 6. Collection Policy Integration

Refresh gate (16-branch, cooldowns, fail-open, token-savings), change detection + fingerprint (JSON-LD dual use), SSRF preserved verbatim, tenant-scoped cache, lazy scheduling, collection-state via Knowledge authority.

## 7–9. Knowledge/Trust/Validation Integration

Evidence-as-basis (ObserveFact/SeedFacts carry evidence ids; Knowledge validates linkage); structured-data → facts; traceability closure. Trust: evidence-class reliability + corroboration → evidence-confidence dimension; freshness → decay. Validation: attribution, immutability, extraction fidelity, freshness, tenancy.

## 10. Event Integration

EvidenceCollected/Extracted/Activated/Superseded/Expired/Archived, CollectionRequested/Skipped/Failed, CollectionPolicyDecided. Idempotent by content-address; replayable; observable (+ preserved crawl metrics); audited.

## 11. Legacy Migration

(1) store stand-up (additive); (2) crawlWebsiteSources emission; (3) metadata + JSON-LD typed; (4) external knowledge routing; (5) BFS re-home; (6) blog/post corpus; (7) collection-state via authority; (8) tenant-scoped cache. Proof: CI census — zero collection paths writing observations outside Evidence; zero siloed-source direct reads.

## 12–13. Shadow & Rollback

Dual collection + observation diff (richer capture whitelisted; routing rescue validated); promotion on attribution completeness + immutability + no lost observations + SSRF/tenancy non-regression. Rollback: legacy collection flag revert; evidence immutable/additive; no loss (structural).

## 14. Testing

Evidence object (types, dedup, freshness), immutability (property), state machine, collection policy (CKRE tests green), security (SSRF non-regression), extraction (+ typed structured data), integration, event, concurrency, tenancy, performance, rollback.

## 15. Certification Gates

(1) one evidence layer; (2) immutability; (3) complete attribution; (4) complete routing (one-workflow defect closed); (5) structured data promoted; (6) collection policy preserved; (7) security non-regression; (8) integration correctness; (9) event correctness; (10) rollback verified; (11) production safety.

## 16. Implementation Sequence

E0 (requires Phase 0 + **WS-K gate**; parallels WS-T) → E1 store + object model → E2 collection policy re-home → E3 primary collector refactor → E4 extraction/observation → E5 external + historical routing → E6 Knowledge/Trust integration (needs T1) → E7 collection-state via authority → E8 shadow → E9 enforcement → E10 certification → E11 retirement.

## 17–18. Certification

**Ready for Development.** Complete scope; the evidence-routing and discarded-structured-data defects [A4 §2] map to named refactors; the certified backbone preserved with security non-regression as a gate. Not "Production Implementation Ready" — awaits WS-K gate and WS-T T1 for the dimension consumer; on those, upgrades automatically.

---
**Related:** [IMPLEMENTATION-002B](IMPLEMENTATION-002B.md) · [IMPLEMENTATION-002D](IMPLEMENTATION-002D.md) · **Depends on:** I1, I2A, I2B · **Related ADRs:** [ADR-003](../adr/ADR-003-immutable-evidence.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-002C-FULL.md`](../full/IMPLEMENTATION-002C-FULL.md) · **Certification:** Ready for Development · GATE-3. See [`../appendices/relationships.md`](../appendices/relationships.md).
