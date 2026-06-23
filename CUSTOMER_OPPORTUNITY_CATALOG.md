# CUSTOMER_OPPORTUNITY_CATALOG.md

Phase 12D · Phase 1 — the opportunity catalog. **Detection only.** Opportunities are
derived read-only from the Customer Readiness model; nothing is shown to customers,
sent, or executed.

Opportunities fire on **KNOWN gaps** (`NOT_READY`). `UNKNOWN` areas are never
opportunities (we don't flag what we can't see). Source of truth:
[backend/services/customerOpportunityService.ts](backend/services/customerOpportunityService.ts).

| Opportunity | Description | Eligibility rule | Severity | Expected value |
|---|---|---|---|---|
| **WEBSITE_UNVERIFIED** | Domain not verified — identity foundation missing | `website_ready = NOT_READY` | HIGH | Unlocks verified identity, analytics domain mapping, trust |
| **PROFILE_INCOMPLETE** | Company profile missing fields / low confidence | `company_profile_ready = NOT_READY` | MEDIUM | Better content/strategy quality; richer reports |
| **MISSING_GA** | Google Analytics not connected | `ga_ready = NOT_READY` | MEDIUM | Performance insight; data-driven reporting |
| **MISSING_GSC** | Google Search Console not connected | `gsc_ready = NOT_READY` | MEDIUM | Search/keyword visibility |
| **MISSING_SOCIAL** | No connected social integrations | `social_ready = NOT_READY` | MEDIUM | Publishing + social listening capability |
| **MISSING_TEAM** | Single-seat tenant | `team_ready = NOT_READY` | LOW | Collaboration; expansion seats |
| **MISSING_BILLING** | Engaged tenant with no paid plan/purchase | `billing_ready = NOT_READY` AND `tenant_status ∈ (ACTIVE, DORMANT)` | HIGH if ACTIVE else MEDIUM | Revenue / conversion |
| **INACTIVE_COMPANY** | No activity > 90 days | `tenant_status = INACTIVE` | HIGH | Churn-risk / win-back |
| **DORMANT_COMPANY** | Activity 31–90 days ago | `tenant_status = DORMANT` | MEDIUM | Re-engagement window |
| **LOW_READINESS** | Overall readiness at-risk | `readiness_bucket = AT_RISK` (< 40%) | HIGH | Aggregate onboarding completion |

Notes on eligibility design:
- **MISSING_BILLING** deliberately excludes brand-new (`COMPANY_CREATED`) and churned
  (`INACTIVE`) tenants — a new tenant without billing is expected, and a churned one is
  covered by `INACTIVE_COMPANY`.
- A tenant can hold multiple opportunities; `LOW_READINESS` is the aggregate signal
  while the `MISSING_*` items are the specific gaps behind it.
- `COMMUNITY` is always `UNKNOWN` (no data source) → no opportunity is emitted for it.

Each detected opportunity carries: `type`, `severity`, `reason` (human), `evidence`
(the underlying readiness signal/value). No action, button, or delivery is attached.
