# CUSTOMER_EXECUTIVE_INSIGHT_MODEL.md

Phase 12F · Phase 1+3 — the executive insight model. **Read-only, deterministic,
rules-based.** No AI, no LLM, no delivery. Source of truth:
[backend/services/customerExecutiveInsightService.ts](backend/services/customerExecutiveInsightService.ts).

## Insight types

Each insight is derived from KNOWN readiness signals (NOT_READY / tenant_status).
`UNKNOWN` areas never produce an insight.

| Type | Trigger | Severity | Confidence |
|---|---|---|---|
| **VERIFICATION_GAP** | `website_ready = NOT_READY` (domain unverified) | HIGH | HIGH |
| **READINESS_BLOCKER** | `company_profile_ready = NOT_READY` → MED; else `readiness_bucket = AT_RISK` → HIGH | MED / HIGH | HIGH |
| **ADOPTION_GAP** | any of `ga_ready` / `gsc_ready` / `social_ready` = NOT_READY | MEDIUM | HIGH |
| **ENGAGEMENT_RISK** | `tenant_status = INACTIVE` → HIGH; `DORMANT` → MED | HIGH / MED | MEDIUM |
| **BILLING_RISK** | `billing_ready = NOT_READY` AND status ∈ (ACTIVE, DORMANT) | HIGH if ACTIVE else MED | MEDIUM |
| **TEAM_EXPANSION_OPPORTUNITY** | `team_ready = NOT_READY` (single seat) | LOW | HIGH |

Each insight carries: **title**, **severity**, **reason**, **evidence**, **confidence**.

Confidence reflects how definitive the underlying signal is: domain verification,
profile completeness, integration presence, and seat count are deterministic DB facts
(HIGH); engagement and billing are derived from coarser proxies (`last_sign_in_at`,
plan/credit signals) → MEDIUM.

## Selection (deterministic)

- **key_insight** = highest-severity insight; ties broken by a fixed type order
  (VERIFICATION_GAP → READINESS_BLOCKER → ENGAGEMENT_RISK → BILLING_RISK → ADOPTION_GAP
  → TEAM_EXPANSION_OPPORTUNITY).
- **primary_blocker** = highest-severity among **blocker** types (VERIFICATION_GAP,
  READINESS_BLOCKER, ENGAGEMENT_RISK, BILLING_RISK).
- **primary_opportunity** = highest-severity among **opportunity** types (ADOPTION_GAP,
  TEAM_EXPANSION_OPPORTUNITY).

## Narrative rules (Phase 3 — deterministic, no AI)

```
narrative = "{Status} {value} with {readiness clause}{ {connective} {gaps} }."
```
- **Status**: ACTIVE→"Active", DORMANT→"Dormant", INACTIVE→"Inactive", COMPANY_CREATED→"New".
- **value**: paying → "paying customer", else "tenant".
- **readiness clause**: profile (complete/incomplete) + website (verified/unverified),
  joined with "and"; falls back to "with limited profile data".
- **gaps**: missing integrations (GA/GSC/social), "no team expansion", "no paid plan".
- **connective**: "but" when the readiness clause is positive (profile or website
  ready), otherwise "and".

Examples (live):
- `"Active paying customer with a complete profile and verified website but missing GA, GSC and social integrations."`
- `"Dormant tenant with an incomplete profile and an unverified website and missing GA, GSC and social integrations and no team expansion."`

The same input always yields the same narrative (no randomness, no model).

## Portfolio insights (Phase 5)

Across all tenants: **top blockers** (blocker-type counts), **top opportunities**
(opportunity-type counts), **most common readiness gaps** (NOT_READY per area), and
**most common verification gaps** (website-unverified count). All read-only counts.
