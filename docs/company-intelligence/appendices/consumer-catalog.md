# Appendix — Consumer Catalog

Every downstream consumer of company intelligence, its read path, and its contract. Consolidated from AUDIT-002 §5 (the certified inventory) and the consumer contracts in DESIGN-002 §6, IMPLEMENTATION-002D §4, and IMPLEMENTATION-002G §6.

Two read paths exist by design: **Grounding** (AI workflows consume Grounding Contexts — migrated in Phase 4) and **Projection** (display/report/analytics/UI consume derived read models — migrated in Phase 7). No consumer reads canonical storage directly (P11/P26).

## Grounding consumers (AI — Phase 4)

| Consumer | Required knowledge | Confidence floor | Freshness | Fallback |
|---|---|---|---|---|
| Content generation (blogs/posts/threads/newsletters/creator) | identity, offering, voice, themes, messaging | Inferred+ (voice/messaging flagged if unconfirmed) | ≤ refresh policy age | evidence-quoted; never fabricate voice |
| Campaigns / planner | identity, commercial, campaign purpose, PT | Confirmed for purpose; Inferred+ others | current | block on missing required → invoke conversation |
| Strategic / Intelligent Mix (BOLT) | offering, audience, platforms, themes | Inferred+ | current | reduced-scope plan |
| Recommendations | full graph + market intelligence | Inferred+ (confidence-weighted) | current | suppress below-floor |
| MarketPulse | competitors, markets, context intelligence | Deterministic for competitor rows | freshness-tiered | suppress stale rows |
| Engagement | voice, messaging, audience | Inferred+ | current | generic-safe register |
| AI Runtime / future agents | declared at registration | declared | declared | declared |

## Projection consumers (display/report/analytics/UI — Phase 7)

| Consumer | Required projections | Freshness | Fallback |
|---|---|---|---|
| Company Profile (UI) | Profile + Marketing + Strategy + PT + Context, **with state labels** | live via ProjectionUpdated | show Unknown honestly |
| Reports | Report projection (**Observed+ only**, P28) | re-verify stale pre-render | omit unverifiable sections, marked |
| Dashboard | Dashboard projection | live | last-known + staleness badge (P27) |
| Analytics / Customer Success | Trust composites (via Trust contract, Phase 2) | live | — |
| Ops / Super-admin | Ops projection | current | — |
| Onboarding | Onboarding projection | live | conversation prompt on gaps |

## Certified non-consumer

| Surface | Finding |
|---|---|
| **Chrome Extension** | Consumes **no** company-profile data (A2 §5). Its only profile call is `/user/profile` (user identity, outside the company-intelligence domain). Requires no migration. |

## Migration status by consumer (from the certified split, A2 §5)

- **Canonical (registered) — 96 grounding consumers:** migrated behind the canonical adapter seam; re-point to Grounding Authority in Phase 4.
- **Legacy `getProfile` — ~26 modules:** grounding-adjacent bypasses migrate in Phase 4; the rest in Phase 7.
- **Raw `company_profiles` — ~40 sites:** display/gating/scoring reads migrate to projections in Phase 7; writers migrated to the write authority in Phase 1.
- **Ungated intelligence channel** (MarketPulse ×4 + recommendations reading `company_context_intelligence` directly, A2 C10): routed through the Grounding Authority in Phase 4.

**Registration law:** every consumer registers a profile; the per-field consumer list is *derived* from registrations (I2G §4), retiring the hand-maintained 96-entry static registry (A2 C12).
