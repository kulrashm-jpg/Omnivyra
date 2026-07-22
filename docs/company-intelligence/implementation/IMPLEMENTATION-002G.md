# IMPLEMENTATION-002G — Projection Engine & Consumer Migration Implementation Program v1.0

**Status:** Authoritative program for the Projection Engine (WS-P) and Consumer Migration (WS-CM), the paired workstreams of Phase 7. Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]–[I2F]. Distinguishing invariant: **every consumer reads through projections; zero direct canonical reads; ProjectionUpdated is the sole freshness signal; projections are derived, never hand-edited** (P26).

**Classification: Ready for Development.**

---

## 1. Executive Summary

Builds the read side. Grounding [I2D] migrated AI-grounding consumers; this program migrates **display/report/analytics/UI** consumers to **materialized Projections** — derived read models over the graph — and retires the ~40 raw reads [A2 §5] and the dual notification stack [A2 C11]. Executes the highest-risk UI migration: the 2,384-line god hook [A1 §2] → projection-and-event client. The DESIGN-001 inversion lands: the Company Profile "row" is a projection of facts, always internally consistent (closes the read side of [A2 C4]). Projections are never hand-edited (P26); rebuild from Facts at any version (rollback = rebuild). A per-consumer dual-read strangle, display/API before frontend, frontend last and per-section. **The Chrome extension is certified a non-consumer** [A2 §5] — no migration.

## 2. Repository Inventory

Company Profile UI (god hook + localStorage/CustomEvent) → Refactor (projection + event client, last); reports raw read → Observed+ projection; dashboard/analytics/ops/onboarding raw reads → display projections; customer-success (migrated Phase 2); AI-runtime reads → projection. Canonical adapter → retired after grounding+display migrated; ~40 raw reads → Replace; buildContentContext → Preserve (Phase 4); frontend hooks → projection/event clients; localStorage/CustomEvent → Retire (ProjectionUpdated); dead endpoints + unused panel → Retire.

## 3. Projection Boundary (frozen)

**Owns:** Read Models, materialized views, Projection Registry, synchronization/refresh, consumer delivery, cache lifecycle, projection versioning. **Does NOT own:** Facts (derives), Evidence, Confidence (carries composite/labels), Grounding (sibling read model), Validation, Conversation, Generation. Never hand-edited (P26); always rebuildable.

## 4–5. Registry & Runtime

Per-projection: owner, consumer, source contexts (Knowledge+Trust), refresh triggers, freshness policy, cache policy, version, compatibility (N/N−1). Runtime: Requested → Built → Published → {Invalidated → Rebuilt} → version transition. Deterministic derivation; event-driven refresh; incremental field-level updates; replay from fact history; content-addressed invalidation; rebuild recovery; ProjectionUpdated on rebuild (sole freshness signal, retires [A2 C11]); N/N−1 during migration. Every consumer reads projections only.

## 6. Consumer Read Models

Company Profile UI (all projections, state labels, live); Reports (Observed+ only, P28); Dashboard (staleness badge, P27); Analytics/Customer Success (Trust composites, Phase 2); MarketPulse/Recs display; Ops; Onboarding; **Chrome Extension (none — certified non-consumer)**; future (declared).

## 7. API Migration

Every read endpoint reads a projection; dead endpoints retired; canonical adapter display residue re-points; ~40 raw reads re-point. Guarantee: zero `company_profiles` reads outside the runtime (census).

## 8. Frontend Migration

god hook → projection-and-event client (~230-key object dissolves as sections read projection slices); controller/dashboard/reports/campaigns/onboarding read projections; conversation UI → one client; localStorage/CustomEvent retired → ProjectionUpdated. Per-section, beta-first, parity checklist, dissolution zone, instant revert.

## 9. Cache Strategy

Runtime owns caches (no competing consumer caches); event-driven invalidation (content-addressed); ProjectionUpdated single publish; derived (flush-and-rebuild recovery); tenant-scoped eviction (P21); consistency guarantee (deterministic + event-invalidated, staleness surfaced honestly P27).

## 10. Event Integration

ProjectionRequested/Built/Updated/Invalidated/Published, ConsumerRefreshed. Per-projection ordering; idempotent by projection+source versions; replayable; observable; audited. ProjectionUpdated is the sole UI freshness signal.

## 11–12. Consumer & Legacy Migration

Display/API before frontend: (1) runtime stand-up; (2) reports; (3) dashboard/analytics/ops/super-admin; (4) onboarding/AI-runtime; (5) MarketPulse/recs display; (6) frontend (per-section, beta-first); (7) conversation UI; (8) dead endpoints retired. Proof: direct-read census = 0. Combined with WS-K writer census and WS-G bypass census, `company_profiles` is fully mediated: one writer, one grounding authority, one projection runtime.

## 13–14. Shadow & Rollback

Dual reads + projection/consumer/API/frontend comparison (internally-consistent output whitelisted); promotion on parity + determinism + freshness + performance. Rollback: projections rebuild from Facts; per-endpoint/per-section flag revert; god hook deployable per section until sunset; caches rebuild; no consumer interruption (structural).

## 15. Testing

Projection (derivation, consistency, labels), synchronization, cache, replay, API parity, frontend (per-section parity; god-hook dissolution; localStorage/CustomEvent retired), migration (census = 0), tenancy, performance, rollback.

## 16. Certification Gates

(1) one projection runtime; (2) one registry (list derived); (3) zero direct canonical reads; (4) projection correctness (closes [A2 C4] read side); (5) cache correctness; (6) synchronization (dual stack retired); (7) API correctness (dead endpoints retired); (8) frontend correctness (god hook dissolved; extension non-consumer); (9) event correctness; (10) rollback verified; (11) production safety.

## 17. Implementation Sequence

P0 (requires **WS-K + WS-T gates**; grounding-reads done in Phase 4) → P1 runtime + registry → P2 core projections → P3 report/ops/dashboard/onboarding projections → P4 cache + synchronization → P5 shadow → P6 API migration → P7 frontend migration (per-section) → P8 enforcement → P9 certification → P10 retirement.

## 18–19. Certification

**Ready for Development.** Complete scope; ~40 raw reads, dual notification stack, god hook, dead endpoints, read-side race each map to a census-enforced closure; extension certified non-consumer. Clean boundary (projections derive, sibling to grounding, never hand-edited). Not "Production Implementation Ready" — awaits Knowledge and Trust gates; frontend carries highest UI risk (last, per-section); on those gates, upgrades automatically.

---
**Related:** [IMPLEMENTATION-002F](IMPLEMENTATION-002F.md) · [IMPLEMENTATION-002H](IMPLEMENTATION-002H.md) · **Depends on:** I1, I2A–F · **Related ADRs:** [ADR-008](../adr/ADR-008-projection-runtime.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-002G-FULL.md`](../full/IMPLEMENTATION-002G-FULL.md) · **Certification:** Ready for Development · GATE-7. See [`../appendices/relationships.md`](../appendices/relationships.md).
