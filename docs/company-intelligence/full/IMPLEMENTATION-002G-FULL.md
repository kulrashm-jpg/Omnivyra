# IMPLEMENTATION-002G — Projection Engine & Consumer Migration (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-002G.md`](../implementation/IMPLEMENTATION-002G.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

WS-P + WS-CM, Phase 7. Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]–[I2F]. Distinguishing invariant: **every consumer reads through projections; zero direct canonical reads; ProjectionUpdated is the sole freshness signal; projections are derived, never hand-edited** (P26). **Classification: Ready for Development.**

---

## 1. Executive Summary

This program builds the read side of the platform. Where the Grounding Authority already migrated every AI-grounding consumer to Grounding Contexts, this program migrates every display, report, analytics, and UI consumer to materialized Projections — derived read models over the knowledge graph — and retires the ~40 certified raw `company_profiles` reads plus the dual notification stack (orchestration events + the frontend localStorage/CustomEvent channel). It also executes the migration the audits flagged as the highest-risk UI surface: the 2,384-line `useCompanyProfileState` god hook with its ~230-key object drilled through three layers and seven files over 500 lines, consolidated into a projection-and-event client. The core inversion, constitutional since DESIGN-001, lands here: the Company Profile "row" that consumers see is a projection of knowledge facts, not a store. Every named intelligence view becomes a derived, event-refreshed, versioned read model that is always internally consistent because it comes from one graph, never from the ten writers racing on one JSONB column. Projections are never hand-edited (P26); they rebuild from Facts at any version, which makes rollback a rebuild rather than a data risk. One certified simplification: the Chrome extension consumes no company-profile data — its only profile call is `/user/profile` (user identity, outside the domain). It is certified a non-consumer and requires no projection migration.

## 2. Repository Inventory

Company Profile UI (god hook + localStorage/CustomEvent) → Refactor (projection + event client, last); reports raw read → Observed+ report projection; campaigns/BOLT/content/recs/engagement (grounding already migrated) → Preserve; any display reads → projection; MarketPulse (grounding + intelligence channel migrated) → display residue → projection; Dashboard/Analytics display raw reads → display projections; Customer Success (migrated Phase 2) → Preserve; super-admin/ops raw reads → ops projection; onboarding display reads → onboarding projection; AI-runtime reads → projection; Chrome Extension → Preserve (certified non-consumer). Read infrastructure: the canonical adapter read path → retired after grounding + display migrated; ~40 raw reads → Replace; `buildContentContext` → Preserve (Phase 4); frontend hooks → projection/event clients; localStorage/CustomEvent → Retire (ProjectionUpdated); dead endpoints + unused panel → Retire; two report systems (canonicalReportBuilder LIVE) → the report projection serves the live builder.

## 3. Projection Boundary (frozen)

**Owns:** Read Models, materialized views, the Projection Registry, projection synchronization + refresh, consumer delivery, cache lifecycle, projection versioning. **Does NOT own:** Facts (derives from, never mutates), Evidence, Confidence (carries the composite + state labels, never computes), Grounding (grounding serves AI, projections serve display — distinct read models over the same facts), Validation, Conversation, Generation. Projections are derived and never hand-edited (P26) — always rebuildable from source Facts at any version. Projections and Grounding Contexts are *sibling* read models — grounding is task-scoped for prompt injection, projections consumer-scoped for display/reporting; both derive from the one graph, neither owns it.

## 4–5. Registry & Runtime

Per-projection: owner, consumer(s), source contexts (Knowledge facts + Trust confidence/state), refresh triggers (KnowledgeChanged, ConfidenceUpdated/Decayed, KnowledgeConfirmed/Contradicted), freshness policy, cache policy, version (SemVer; consumers declare accepted MAJOR), compatibility (N/N−1 dual-serving). Runtime: Requested → Built (materialized from Facts+Trust) → Published → {Invalidated → Rebuilt} → version transition. Deterministic derivation (internally consistent by construction); event-driven refresh (incremental field-level updates); replay (re-derives from fact history at any version — the standard recovery); invalidation (by source-event subscription, content-addressed, not TTL-guessing); recovery (rebuild from Facts — never a data-loss risk); synchronization (ProjectionUpdated on every rebuild — the sole freshness signal to consumers and UI, retiring the dual stack); version transitions (N and N−1 served concurrently during migration). Every consumer reads projections only.

## 6. Consumer Read Models

Company Profile UI (all projections, with state labels, live via ProjectionUpdated; show Unknown honestly); Reports (Report projection, Observed+ facts only, P28; re-verify stale pre-render; omit unverifiable sections, marked); Dashboard (Dashboard projection, live; last-known + staleness badge, P27); Analytics/Customer Success (Trust composites via the Trust contract, Phase 2); MarketPulse/Recommendations display; Ops/Super-admin; Onboarding (conversation prompt on gaps); **Chrome Extension (none — certified non-consumer)**; future (declared at registration). Read-model law: every consumer reads a registered projection matching its contract; freshness, fallback, and degradation are declared, not ad-hoc — the certified silent/inconsistent read behaviors become contractual.

## 7–8. API & Frontend Migration

API: every `company-profile` GET and display read endpoint reads a projection; the dead endpoints are retired; the canonical adapter's display-read residue re-points; the ~40 raw display reads re-point per consumer. Guarantee: zero `company_profiles` reads in API code outside the runtime (census). Frontend (the highest-risk surface): `useCompanyProfileState` consolidated into a projection-and-event client (the ~230-key object dissolves as sections read their own projection slices); the controller reads projection-derived view state; `CompanyContext` preserves the auth lifecycle with company/roster reads moving to projection; dashboard/reports/campaigns/onboarding read projections; the conversation UI becomes one client; frontend caches (localStorage `company_profile_updated`, the CustomEvent) are retired → ProjectionUpdated subscription. Migration discipline: per-section, beta-tenant-first, behind flags, with a parity checklist per section; the god hook is a dissolution zone — sections move to projection reads one at a time, never a concurrent in-place rewrite; instant flag revert restores the legacy hook per section.

## 9. Cache Strategy

The runtime owns projection caches (no consumer maintains a competing cache of profile data — the certified localStorage cross-feature signaling retired). Invalidation is event-driven by refresh triggers, content-addressed by source fact/confidence versions — correct by determinism. Synchronization: ProjectionUpdated is the single publish signal. Replay/recovery: caches are derived — flush and rebuild from Facts. Eviction per policy; tenant-scoped keys (P21). Consistency guarantee: because projections derive deterministically from versioned Facts and invalidate on source events, a consumer never sees a projection inconsistent with the current knowledge state beyond its declared freshness tolerance — and staleness is surfaced honestly (P27).

## 10. Event Integration

ProjectionRequested/Built/Updated/Invalidated/Published, ConsumerRefreshed. Per-projection ordering; idempotent by projection version + source versions; replayable (re-derives from fact history); observable (build/refresh/latency + staleness distribution + cache hit-rate); audited. ProjectionUpdated is the sole UI freshness signal — completing the closure of the certified two-notification split.

## 11–12. Consumer & Legacy Migration

Display/API before frontend, frontend last: (1) runtime + registry stand-up; (2) Reports (Observed+ projection); (3) Dashboard/Analytics/Ops/Super-admin display; (4) Onboarding/AI-runtime display; (5) MarketPulse/Recommendations display residue; (6) frontend (per-section, beta-first); (7) conversation UI; (8) dead endpoints + unused panel retired. Proof: a direct-read census confirms zero display/UI/report/analytics reads of `company_profiles` outside the runtime at enforce. Combined with the WS-K writer census and the WS-G grounding-bypass census, `company_profiles` is fully mediated: one writer, one grounding authority, one projection runtime.

## 13. Shadow & Rollback

Dual reads (legacy serves; the projection is built and recorded). Projection comparison (internally-consistent projection output — one graph vs racing writers — is expected divergence, whitelisted). Consumer/API/frontend comparison (per-consumer display parity; endpoint response parity; per-section visual/behavioral parity checklist, beta-tenant-first). Promotion (per consumer per tenant): parity within tolerance; determinism (rebuild reproducible); freshness verified; performance within budget; rollback exercised. Rollback: projections are derived — flush and rebuild from Facts; per-endpoint/per-section flag revert to the legacy read/hook (kept deployable until sunset); caches flush-and-rebuild; because projections build alongside legacy reads until enforce, are deterministically rebuildable, and every consumer/section reverts independently, no rollback interrupts a consumer (structural).

## 14. Testing Framework

Projection (per-projection derivation from Facts+Trust; internal consistency; state-label correctness); synchronization (ProjectionUpdated on every source change; incremental field-level refresh); cache (event-driven invalidation; content-addressed correctness; tenant-scoped eviction); replay (deterministic re-derivation from fact history); API (endpoint response parity; dead endpoints retired); frontend (per-section parity; god-hook dissolution; localStorage/CustomEvent retired); migration (direct-read census reaches zero; canonical adapter retired); tenancy; performance (projection read latency vs current direct read; cache hit-rate; UI render parity); rollback (no-interruption proof).

## 15. Certification Gates

(1) one Projection Runtime; (2) one Projection Registry (list derived; hand-maintained inventory retired); (3) zero direct canonical reads (the ~40 raw reads eliminated); (4) projection correctness (closes the read-side of the report_settings race); (5) cache correctness; (6) synchronization correctness (ProjectionUpdated sole signal; dual stack retired); (7) API correctness (dead endpoints retired); (8) frontend correctness (god hook dissolved; extension certified non-consumer); (9) event correctness; (10) rollback verified; (11) production safety.

## 16. Implementation Sequence

P0 (requires WS-K + WS-T gates; grounding-reads done in Phase 4) → P1 runtime + registry (dark) → P2 core projections (Profile/Marketing/Strategy/PT/Context) → P3 report/ops/dashboard/onboarding projections → P4 cache + synchronization → P5 shadow → P6 API migration → P7 frontend migration (per-section, beta-first; conversation UI client; localStorage/CustomEvent retired) → P8 enforcement → P9 certification → P10 retirement staging.

## 17–18. Certification

**Ready for Development.** Complete scope; the ~40 raw reads, dual notification stack, god hook, dead endpoints, and read-side race each map to a census-enforced closure; the extension certified a non-consumer; clean boundary (projections derive, sibling to grounding, never hand-edited). With this program's direct-read census at zero, `company_profiles` is fully mediated on all three axes (one writer, one grounding authority, one projection runtime). Not "Production Implementation Ready" — awaits the Knowledge and Trust gates; the frontend carries the highest UI risk (last, per-section); on those gates, upgrades automatically.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-002G.md`](../implementation/IMPLEMENTATION-002G.md) · [`IMPLEMENTATION-002F-FULL.md`](IMPLEMENTATION-002F-FULL.md) · [`IMPLEMENTATION-002H-FULL.md`](IMPLEMENTATION-002H-FULL.md) · **Related ADRs:** [ADR-008](../adr/ADR-008-projection-runtime.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** Ready for Development · GATE-7.
