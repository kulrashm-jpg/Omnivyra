# IMPLEMENTATION-002C — Evidence Context Implementation Program (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-002C.md`](../implementation/IMPLEMENTATION-002C.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

WS-E, Phase 3 (parallels Phase 2). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A], [I2B]. Distinguishing invariant: **Evidence is immutable from birth — superseded, never edited** (P1). **Classification: Ready for Development.**

---

## 1. Executive Summary

The Evidence Context makes every observation the platform collects — from any source — an immutable, attributed, versioned, freshness-governed object, and **routes all of it to every consumer**. It resolves the certified quality root cause: intelligence degrades not because evidence is unavailable but because it is *unrouted* — the knowledge graph, Wikidata/Wikipedia, the blog/post corpus, the 250-page BFS crawl, and JSON-LD structured data each reached exactly one workflow or none. Evidence collapses the two certified crawlers into one collection layer over a single store, promotes JSON-LD from fingerprint-only hashes to typed evidence, and captures conversation turns and generation outputs as first-class evidence. Evidence is the most *independently buildable* context — its store depends only on the Phase-0 fabric — but it formally sequences after the WS-K gate because its primary consumers are Knowledge (evidence is the basis for `ObserveFact`/`ProposeFact` mutations) and Trust (evidence class is the input to the evidence-confidence dimension). The program is an **additive-shadow strangle**: evidence is written alongside existing crawl flows first (zero behavior change), collectors are re-seated to emit Evidence Objects, and the certified-sound deterministic backbone — refresh gate, change detection, fingerprinting, SSRF layer — is preserved and re-homed as the Evidence context's collection policy engine. The distinguishing invariant is that Evidence is immutable from birth — the strongest data-integrity guarantee in the platform and the foundation on which all lineage and explainability rest.

## 2. Repository Inventory

`crawlWebsiteSources` → emits Evidence Objects (page selection/summarization preserved); `crawlCompanyWebsite` (250-page BFS) → a collection *strategy* over the one store; `extractWebsiteMetadata` → typed metadata evidence; JSON-LD parsing → promoted to typed structured-data evidence (dual use: still feeds the fingerprint); Wikidata/Wikipedia adapters → external-knowledge evidence routed to all; Crunchbase/Bloomberg → Preserve (dark, ready when keyed); blog/post reads → historical evidence for all. Refresh gate + `refreshPolicyEngine`, change detection, fingerprint service, safeFetch/SSRF → Preserve (re-homed as the collection policy engine). `crawlResultCache` → tenant-scoped key (closes the global-key concern; TTL/FIFO preserved). `incrementalMetadataStore`/`fingerprintStore`/`knowledgeVersionStore` → route collection-state writes through the Knowledge write authority's `RecordSystemState` (Evidence is a client, not a writer of company_profiles). `canonical_pages` Preserve; `report_settings` sub-keys via the authority; crawl event emitters re-seat onto the bus.

## 3. Evidence Context Boundary (frozen)

**Owns:** Evidence Objects (all types), Observations, evidence versioning/supersession, source attribution, freshness policy + decay signals, evidence-class reliability assignment, collection policy (refresh/change/fingerprint engine), collection scheduling + transport, the evidence store + retrieval. **Does NOT own:** Facts (supplies the *basis*, never creates facts), Confidence composition (supplies *evidence-class reliability* as one dimension input, never composes), Grounding (exposes retrieval; the authority selects and assembles), AI/Generation (captures generation *outputs* as evidence but never invokes models), Projections, Consumers. Evidence writes company-profile collection state *only through the Knowledge write authority* — a mutation client for that shared seam, never a direct writer (P3).

## 4. Evidence Object Specification

One uniform object for every observation: identity (content-addressed for dedup), type (crawl-page, structured-metadata, json-ld, blog-content, landing-page, social-profile, document, user-input, conversation-turn, generation-output, external-knowledge, analytics-signal, connector-payload), source attribution (origin, locator, collection method, collector version), immutable versioning (supersede never overwrite; chain preserved), freshness (observed-at; valid-until per type — crawl decays fast, registry slowly, user-input never), evidence confidence (source-class reliability — the input to Trust's dimension), traceability (the reverse index: which Facts/derivations reference this evidence). Observation = a typed extraction from an Evidence Object; immutable; re-extraction versions. Design rules: everything learned is evidence-first (including conversation answers and accepted suggestions — closing the certified "no record of why" gap); both crawlers feed one store; structured data is first-class; external knowledge is routed to all; historical generations are voice evidence; connectors emit objects.

## 5. Lifecycle & State Machine

Collected → Extracted → Active → {Superseded | Expired} → Archived. Entry to Active requires complete attribution; supersession = a same-locator newer observation; expiry = freshness policy elapsed. Forbidden (enforced + tested): any edit-in-place (P1); Archived → anything; deletion outside retention; extraction that fabricates observations absent from source. Freshness signals flow to Trust (EvidenceExpired → freshness-confidence decay) and to the collection policy engine (staleness → refresh candidacy).

## 6. Collection Policy Integration

The certified deterministic backbone re-homed unchanged in behavior: the 16-branch refresh gate (cooldowns 1/3/7d, fail-open, token-savings accounting, P24); change detection + fingerprinting (JSON-LD now emits typed evidence *and* feeds the fingerprint); the SSRF layer preserved verbatim (IP-pinning, redirect re-validation, fail-closed, byte/timeout caps — security non-regression is a gate); the cache preserved except the key becomes tenant-scoped (closing the global-key concern); lazy/on-demand scheduling (no scheduled crawl introduced); collection-state writes route through `RecordSystemState`/`ObserveFact`.

## 7–9. Knowledge / Trust / Validation Integration

`ObserveFact`/`SeedFacts` mutations carry evidence ids as basis; the authority validates evidence-linkage. Crawl-derived logo/favicon/geography flow as `ObserveFact` (fill-empty, lock-aware). JSON-LD product/service observations become `ObserveFact` basis. Traceability closure: when Knowledge creates a Fact version from evidence, Evidence records the reverse reference. Trust: evidence-class reliability + corroboration count → the evidence-confidence dimension; freshness signals → decay. Validation surface: attribution completeness, immutability, extraction fidelity (no fabrication), freshness assignment, tenancy. Sequencing: requires the WS-K gate closed so evidence-based mutations have a write authority to target.

## 10. Event Integration

EvidenceCollected/Extracted/Activated, EvidenceSuperseded/Expired/Archived, CollectionRequested/Skipped/Failed, CollectionPolicyDecided. Idempotent by content-address (re-collection of identical content is a no-op); replayable; observable (+ the preserved `duplicate_prevented`/`network_requests_saved` crawl metrics); audited.

## 11. Legacy Migration

(1) evidence store stand-up (additive; legacy bundles still serve their one consumer); (2) `crawlWebsiteSources` emission; (3) metadata + JSON-LD typed; (4) external-knowledge routing (suggest-competitors/facts-lookup keep working); (5) BFS re-home; (6) blog/post corpus → all generators; (7) collection-state via the authority; (8) tenant-scoped cache key. Proof: a CI census confirms zero collection paths writing observation data outside Evidence and zero consumers reading a siloed source directly at enforce.

## 12. Shadow & Rollback

Dual collection (legacy serves; the store records equivalent objects). Comparison: evidence-derived observations diffed against legacy extraction; richer capture (JSON-LD now typed, headings no longer empty) is expected divergence, whitelisted; the routing rescue validated by confirming previously-siloed evidence is now retrievable for all. Promotion (per source per tenant): attribution completeness = 100%; immutability holds; no lost observations; SSRF/tenancy non-regression; performance within budget; rollback exercised. Rollback: per-source, per-tenant flag revert to the legacy crawl flow; evidence append-only and immutable — rollback never loses evidence; no consumer disruption (structural).

## 13. Testing Framework

Evidence object (all types, attribution, content-address dedup, type-specific freshness); immutability (property; no edit-in-place path reachable); state machine (no forbidden transition; extraction-fidelity); collection policy (all CKRE contract tests green); security (SSRF non-regression); extraction (parity + new typed structured data); Knowledge/Trust integration; event (transactionality, ordering, idempotency, replay); concurrency (parallel collection, supersession races, dedup); tenancy (isolation, tenant-scoped cache); performance; rollback.

## 14. Certification Gates

(1) one evidence layer (census); (2) evidence immutability (append-only/supersession-only property); (3) complete attribution (100% of Active); (4) complete routing (the one-workflow-per-source defect closed); (5) structured data promoted (JSON-LD typed evidence); (6) collection policy preserved (CKRE tests green; token-savings intact); (7) security non-regression (SSRF/tenancy; global cache-key closed); (8) integration correctness; (9) event correctness; (10) rollback verified; (11) production safety.

## 15. Implementation Sequence

E0 (requires Phase 0 + WS-K gate; parallels WS-T) → E1 store + object model (additive, dark) → E2 collection policy re-home (tenant-scoped cache) → E3 primary collector refactor (metadata + JSON-LD typed) → E4 extraction/observation layer → E5 external + historical routing (Wikidata/Wikipedia/connectors; blog/post; BFS re-home) → E6 Knowledge/Trust integration (needs WS-T T1) → E7 collection-state via the authority → E8 shadow → E9 enforcement → E10 certification → E11 retirement staging.

## 16–17. Certification

**Ready for Development.** Complete scope; the evidence-routing and discarded-structured-data defects map to named refactors with routing-rescue shadow validation; the two-crawler fork and global cache key each individually addressed; the certified backbone preserved with security non-regression as a gate. Not "Production Implementation Ready" — awaits the WS-K gate and WS-T T1 for the dimension consumer; on those, upgrades automatically.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-002C.md`](../implementation/IMPLEMENTATION-002C.md) · [`IMPLEMENTATION-002B-FULL.md`](IMPLEMENTATION-002B-FULL.md) · [`IMPLEMENTATION-002D-FULL.md`](IMPLEMENTATION-002D-FULL.md) · **Related ADRs:** [ADR-003](../adr/ADR-003-immutable-evidence.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** Ready for Development · GATE-3.
