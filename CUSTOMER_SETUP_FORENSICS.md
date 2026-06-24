# CUSTOMER_SETUP_FORENSICS.md

Phase 16D · Phase 2–5 — per-customer setup forensics from raw records. CUSTOMER-only. Evidence
only.

## Per-customer setup state

| Customer | PROFILE | DOMAIN | GA | GSC | TEAM | Last completed | First incomplete |
|---|---|---|---|---|---|---|---|
| Drishiq | COMPLETE (conf 67) | NEVER_STARTED | ATTEMPTED_DISCONNECTED | NEVER_STARTED | NEVER_STARTED | PROFILE | DOMAIN |
| Unfinished Innovations LLP | COMPLETE (conf 100) | ATTEMPTED_PENDING | ATTEMPTED_DISCONNECTED | ATTEMPTED_DISCONNECTED | NEVER_STARTED | PROFILE | DOMAIN |
| Embrosales | **ATTEMPTED_UNSCORED** (conf 0, refined N) | ATTEMPTED_PENDING | NEVER_STARTED | NEVER_STARTED | NEVER_STARTED | — | PROFILE |
| Afrost | **ATTEMPTED_UNSCORED** | NEVER_STARTED | NEVER_STARTED | NEVER_STARTED | NEVER_STARTED | — | PROFILE |
| Infitoo Systems llp | **ATTEMPTED_UNSCORED** | NEVER_STARTED | NEVER_STARTED | NEVER_STARTED | NEVER_STARTED | — | PROFILE |

## Phase 3 — Domain verification forensics

| State | Count |
|---|---|
| verified | 0 |
| ATTEMPTED_PENDING (row, never verified) | **2** (Unfinished, Embrosales) |
| NEVER_STARTED | 3 |

**2 of 5 customers started domain verification and it never completed** (stuck at pending) —
direct product-flow evidence; 3 never started.

## Phase 4 — Analytics connection forensics

| | GA | GSC |
|---|---|---|
| CONNECTED | 0 | 0 |
| ATTEMPTED_DISCONNECTED | **2** | **1** |
| NEVER_STARTED | 3 | 4 |

**Where analytics was attempted, it is `disconnected`** (Drishiq GA; Unfinished GA+GSC) —
i.e. connected then lost. **The blocker is product flow (connections don't persist)**, not
purely customer behavior, for the customers who attempted.

## Phase 5 — Team formation forensics

| Metric | Value (all 5 customers) |
|---|---|
| invites sent | **0** |
| invites accepted | 0 |
| additional users added | 0 (each company has exactly 1 user) |

**No customer sent a single team invite.** First failure point = the invite step never
fires. Whether this is customer behavior or a missing invite prompt **cannot be determined
from the data (no attempt telemetry)** → UNKNOWN.

## Reading

Customers **did attempt** onboarding: all 5 have profile rows, 2 attempted domain
verification, 3 attempted analytics. The product **failed to complete** those attempts
(3 unscored profiles, 2 pending domains, disconnected analytics). Only TEAM is genuinely
un-started, and ambiguously so.
