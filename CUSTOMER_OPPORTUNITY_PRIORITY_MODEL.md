# CUSTOMER_OPPORTUNITY_PRIORITY_MODEL.md

Phase 12E · Phase 1+3 — the prioritization model. **Read-only.** Converts detected
opportunities into a ranked "who deserves attention first" list. No delivery, no
automation, no customer-facing changes. Source of truth:
[backend/services/customerOpportunityPriorityService.ts](backend/services/customerOpportunityPriorityService.ts).

## Principle

Priority = **value × engagement × addressable opportunity**. It is NOT just
opportunity count: a churned free tenant with many gaps is low priority; a paying,
active, near-ready tenant with a high-severity gap is high.

## Scoring factors & exact weights

`priority_score = value + engagement + severity + addressability + opportunity_volume +
age_momentum` (capped at 100).

| Factor | Signal | Weight |
|---|---|---|
| **Subscription value** | `billing_ready` | paying **20**, free **3** |
| **Engagement (tenant status)** | `tenant_status` | ACTIVE **30**, COMPANY_CREATED **18**, DORMANT **5**, INACTIVE **0**, EMAIL_VERIFIED/SIGNUP_STARTED **0** |
| **Opportunity severity** | highest detected severity | HIGH **15**, MEDIUM **8**, LOW **3** |
| **Addressability (readiness)** | `readiness_bucket` | PARTIAL **22**, AT_RISK **5**, READY **0** |
| **Opportunity volume** | `min(count, 6) / 6 × 5` | up to **5** |
| **Age momentum** | tenant created ≤ 30 days ago | **5** (else 0) |

**Max raw = 97 → capped at 100.** A tenant with **0 opportunities** is forced to
`priority_score = 0` and tier `READ_ONLY` (nothing to act on).

Calibration intent: **engagement** (ACTIVE 30 vs DORMANT 5) and **addressability**
(PARTIAL 22 vs AT_RISK 5) are the primary discriminators. Opportunity volume is
deliberately small (5) — many gaps ≠ urgent; a dormant tenant with everything missing
is low-ROI, not high-priority. This concentrates CRITICAL/HIGH on the few engaged,
near-ready, valuable tenants (live: 5 of 38) instead of flagging everyone.

Rationale for the addressability curve: a **PARTIAL** tenant (40–79% ready) is closest
to "done" and the highest-leverage push, so it scores above an **AT_RISK** tenant
(lots of work, lower per-action ROI) and a **READY** tenant (nothing left).

## Tiers

| Tier | Condition |
|---|---|
| **READ_ONLY** | opportunity_count = 0 |
| **CRITICAL** | score ≥ 75 |
| **HIGH** | 55 ≤ score < 75 |
| **MEDIUM** | 35 ≤ score < 55 |
| **LOW** | score < 35 |

## Priority rules (Phase 3 — worked examples)

| Scenario | Computation | Score | Tier |
|---|---|---|---|
| ACTIVE + PAYING + HIGH-severity gap, PARTIAL | 20+30+15+22+2 | ~89 | **CRITICAL** |
| ACTIVE + PAYING + HIGH-severity gap, AT_RISK | 20+30+15+5+5 | ~75 | **CRITICAL** |
| DORMANT + PAYING + many missing (AT_RISK) | 20+5+15+5+5 | ~50 | **MEDIUM** (dormant pulls it well below active) |
| DORMANT + FREE + many missing (AT_RISK) | 3+5+15+5+4 | ~32 | **LOW** |
| READY tenant, no opportunities | — | 0 | **READ_ONLY** |
| INACTIVE + FREE + gaps | 3+0+15+5+4 | ~27 | **LOW** (engagement 0 pulls it down) |
| COMPANY_CREATED + PAYING + new (≤30d) | 20+18+sev+addr+vol+5 | high | **HIGH/CRITICAL** (onboarding momentum) |

## Determinism

`prioritizeCustomers` sorts by `priority_score` desc, tie-broken by `company_id`
ascending — fully deterministic for a fixed input + clock. Weights and thresholds are
named constants (`PRIORITY_WEIGHTS`, `PRIORITY_TIER_THRESHOLDS`) for tuning.
