# COMPANY-PROFILE-AUDIT-002 — Architecture Ownership & Canonical Responsibility Certification

**Scope:** Read-only. Builds on AUDIT-001. Certifies ownership before implementation planning.

**Classification: Partially Owned.**

---

## 1. Canonical Source of Truth Matrix

Seven candidate sources; one canonical by decree, one by adoption, the rest partial.

| # | Source | Owner | Authority today | Canonical? |
|---|---|---|---|---|
| S1 | `company_profiles` row | no single owner (10 writers) | de facto ultimate authority | as storage; no code owner |
| S2 | Canonical Profile Adapter (`getCanonicalProfile`) | `context/canonicalProfileAdapter.ts` | declared canonical read; flag default off → passthrough to S1 | **Yes — for grounding reads** |
| S3 | Legacy `getProfile` (Pulse.ts:720) | barrel service | residual — the actual execution path while flag off | No |
| S4 | Canonical Context (`company_context_*`) | `context/` | overlay-only, fill-empty, dark by default | No — subordinate |
| S5 | Company Knowledge Graph | `companyKnowledgeGraph.ts` | "the ONE canonical model," 1-endpoint adoption | No — canonical by intent |
| S6 | Intelligence Context (`company_context_intelligence`) | `companyContextIntelligenceService` | independent parallel authority, ungated | canonical for its table; a second grounding channel |
| S7 | Crawl metadata / knowledge versions (`report_settings.*`) | `crawl/` stores | authoritative for change detection | yes for crawl state; embedded in S1's JSONB |

**Certification:** multiple authorities exist. Exactly one declared canonical read seam (S2), but it is read-only, dark by default, and grounding-scoped. **No canonical write seam exists.** S5 and S6 are competing knowledge authorities with disjoint adoption.

## 2. Field Ownership Matrix

**10 write authorities (W1–W10):** W1 `saveProfile`→`buildSavePayload`→upsert (only path that ADDS locks); W2 AI refine `buildRefinedPayload` (bypasses buildSavePayload); W3 bootstrap (raw, fill-empty); W4 metadata refresh (raw); W5 touchRefreshedAt (raw); W6 setup-company (raw); W7 guidance (raw); W8 PT answers (only writer of PT confidence); W9 report_settings sub-key stores (raw merge); W10 governance merge + ops script. The `define-*` endpoints write nothing — they return structured fields to the client, which persists via W1.

Per-field certification highlights: `website_url` **Excellent** (verified, role-gated, strongest owned); `name`/socials/logo **High**; commercial/marketing/PT field groups **Clearly owned** with real user-lock protection; `industry`/`category` conflicted (classifier overrides user); `competitors` null-then-overwrite; `report_settings` the most contested object (W1 full-replace vs ≥8 read-merge writers).

## 3. Service Responsibility Matrix

Clear owners: identity/website resolution, crawling, refresh decision, change detection, AI grounding (canonical for 96), company facts, provenance, canonical context. Conflicted: industry classification (classifier vs user), competitors (spread over 4 files + parallel chat path), confidence (**no owner**; vocabulary+key drift), knowledge graph (owner exists, jurisdiction doesn't), intelligence context (ungated parallel channel), recommendations (split canonical/legacy). **Missing ownership — the largest gap: Persistence** (10 writers, 2 conventions, no repository).

## 4. Lifecycle Ownership Matrix

L1 Website change: mostly owned (two disjoint notification systems). L2 Creation: owned (writes raw). L3 Manual edit: owned with internal precedence conflicts (classifier override, competitors null-then-recompute, report_settings full-replace). L4 AI refine: clear orchestrator, ambiguous initiation (read path can trigger). L5 Competitor update: three entry paths, one engine over 4 files. L6 Guided conversation: fragmented — no server-side owner of conversation/question state across endpoints. L7 Bootstrap: the cleanest lifecycle.

## 5. Consumer Ownership Matrix

Read-path split: 96 canonical-seam consumers (registry-complete for AI grounding), ~26 legacy `getProfile` modules, ~40 raw table sites. Content/campaigns/BOLT/recs/reports/trends/engagement/creator consume the whole profile as grounding through the canonical seam (mostly indirect via buildContentContext). MarketPulse+recs also read `company_context_intelligence` directly (ungated, S6). Analytics/customer-success consume confidence numbers (≥60 thresholds). **Chrome extension consumes NO company-profile data** — only `/user/profile` identity.

## 6. Ownership Conflict Register (14 conflicts)

C1 no canonical write seam (10 writers, 2 conventions). C2 four grounding authorities. C3 KG vs Canonical Context (competing "what we know"). C4 report_settings container (full-replace vs merge, lost-update races). C5 competitors null-then-overwrite (order-dependent). C6 confidence key/vocabulary drift (`company_name`/`unique_value_proposition` written; `name`/`unique_value` read — nodes permanently degrade; `'Needs Review'` unrecognized). C7 classifier vs user on industry/category (unprotected). C8 phantom locks (geography, social_profiles honored but never set). C9 read initiates write (autoRefine). C10 S6 ungated (MarketPulse ×4 + recs). C11 two downstream-notification systems. C12 registry-by-hand (96-entry static list). C13 conversation-state ownership absent across endpoints. C14 tenancy owner mismatch (no FK, non-isolating RLS, TEXT company_id).

## 7. Architectural Boundary Certification

Clean: Identity (best boundary), AI (single gateway seam). Overlapped: Business (classifier reaches into user-edit), Marketing (two AI paths converge), Intelligence (parallel to profile, not layered), **Knowledge (most overlapped — three representations, key drift)**, Recommendations (crossed inconsistently), Guidance (fragmented). **Undefined: Persistence.**

## 8. Final Ownership Certification

**Partially Owned.** Bimodal by axis. Clearly owned: the AI-grounding read axis (one seam, complete registry, rollout machinery), the AI provider boundary, crawl/refresh lifecycle, bootstrap, identity/website, and the commercial/marketing/PT field groups (real lock protection). Not owned: **persistence has no owner at all** (the most consequential finding); the knowledge/confidence boundary is contested by three implementations with active silent contract drift; `report_settings` has ≥9 writers with undefined precedence; conversation/question governance has 1-of-6 jurisdiction; tenant isolation is owned by convention. Not "Highly Fragmented" because functioning ownership institutions exist (registry, refresh gate, lock system, bootstrap) and the migration direction is explicit — the failure mode is **incomplete jurisdiction**: the institutions govern reads and AI spend, while writes, confidence, and conversation state remain ungoverned commons.

---
**Related:** [AUDIT-001](AUDIT-001.md) · [AUDIT-003](AUDIT-003.md) · [DESIGN-001](DESIGN-001.md) · **Depends on:** AUDIT-001 · **Related ADRs:** [ADR-001](../adr/ADR-001-one-write-authority.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/AUDIT-002-FULL.md`](../full/AUDIT-002-FULL.md) · **Certification:** Partially Owned. See [`../appendices/relationships.md`](../appendices/relationships.md).
