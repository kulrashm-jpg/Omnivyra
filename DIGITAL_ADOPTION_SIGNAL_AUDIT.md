# DIGITAL_ADOPTION_SIGNAL_AUDIT.md

Phase 14D · Phase 1 — adoption source inventory. **Audit only.** All sources already feed
readiness (12A/C); the adoption engine reads no new tables.

| Source | Capability | Coverage | Freshness | Confidence | Owner | Consumers | Class |
|---|---|---|---|---|---|---|---|
| `company_profiles` | PROFILE | 29/38 rows; 3 ready | on edit (`last_refined_at`) | HIGH | core | adoption, profile-completion | **COMPLETE** |
| `company_domains` | DOMAIN_VERIFICATION | 1 verified | on verify (`verified_at`) | HIGH | identity | adoption | **COMPLETE** |
| `analytics_integrations` (GA4) | GA | 0 connected | live-check | MEDIUM (presence) | core | adoption | **PARTIAL** |
| `analytics_integrations` (GSC) | GSC | 0 connected | live-check | MEDIUM (presence) | core | adoption | **PARTIAL** |
| `social_accounts` | SOCIAL | 2 connected | refresh | MEDIUM (presence) | core | adoption | **PARTIAL** |
| `user_company_roles` | TEAM | 1 established | real-time (`accepted_at`) | HIGH | core | adoption | **COMPLETE** |
| `organization_plan_assignments` / `organization_credits` | BILLING | 28 active | assign/grant | MEDIUM (org-keyed) | billing | adoption | **PARTIAL** |

## Findings

- **BILLING is the only widely-adopted capability** (28/38). Every other capability is
  near-zero: GA/GSC = 0, SOCIAL = 2, TEAM = 1, DOMAIN = 1, PROFILE-ready = 3.
- **GA/GSC/SOCIAL are connection-presence** (12B), not data-flow → PARTIAL.
- **No PARTIAL adoption sub-signal** — readiness is binary (READY/NOT_READY/UNKNOWN), so the
  model's `PARTIAL` capability state has no current source and is never emitted per-capability.
