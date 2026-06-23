# CUSTOMER_ACTION_PLAYBOOK_CATALOG.md

Phase 13G · Phase 1 — the action catalog. One deterministic playbook per addressable
readiness gap. **Admin-only, read-only, visibility-only** — no delivery, no execution.

| playbook_id | playbook_name | area | target_condition | expected_outcome | required_signals | blocked_signals | success_measure | impact |
|---|---|---|---|---|---|---|---|---|
| VERIFY_DOMAIN | Verify company domain | WEBSITE | WEBSITE = NOT_READY | domain verified | WEBSITE | — | WEBSITE → READY | HIGH |
| COMPLETE_PROFILE | Complete company profile | COMPANY_PROFILE | COMPANY_PROFILE = NOT_READY | profile confidence ≥ 60 | COMPANY_PROFILE | — | COMPANY_PROFILE → READY | HIGH |
| ACTIVATE_BILLING | Activate plan / billing | BILLING | BILLING = NOT_READY | paid plan active | BILLING | — | BILLING → READY | HIGH |
| CONNECT_GA | Connect Google Analytics | GOOGLE_ANALYTICS | GA = NOT_READY | GA connected | GOOGLE_ANALYTICS | — | GOOGLE_ANALYTICS → READY | MEDIUM |
| CONNECT_GSC | Connect Google Search Console | GOOGLE_SEARCH_CONSOLE | GSC = NOT_READY | GSC connected | GOOGLE_SEARCH_CONSOLE | — | GOOGLE_SEARCH_CONSOLE → READY | MEDIUM |
| CONNECT_SOCIAL | Connect social accounts | SOCIAL_INTEGRATIONS | SOCIAL = NOT_READY | social connected | SOCIAL_INTEGRATIONS | — | SOCIAL_INTEGRATIONS → READY | MEDIUM |
| INVITE_TEAM | Invite team members | TEAM_MEMBERS | TEAM = NOT_READY | members accepted | TEAM_MEMBERS | — | TEAM_MEMBERS → READY | LOW |

COMMUNITY has no playbook (no source / structural).

## Per-playbook fields

- **target_condition** — the readiness area is `NOT_READY` (a clear gap). A `READY` area
  yields no playbook (not a suppression). An `UNKNOWN` area is suppressed (`GAP_UNCERTAIN`).
- **required_signals** — signals that must be confidently readable; if any is `UNKNOWN`
  confidence the playbook is suppressed (`REQUIRED_SIGNAL_MISSING`).
- **expected_value** — `impact_weight × priority_factor` (impact HIGH=3/MED=2/LOW=1;
  priority CRITICAL=1 … READ_ONLY=0.2), banded HIGH ≥ 2.4 / MEDIUM ≥ 1.2 / LOW.
- **confidence** — inherited from the area's signal confidence (13E); only HIGH/MEDIUM
  playbooks are ever recommended (LOW/UNKNOWN are suppressed).

## Suppression reasons (Phase 3)

`SIGNAL_LOW_CONFIDENCE` · `SIGNAL_UNKNOWN_CONFIDENCE` · `GAP_UNCERTAIN` ·
`REQUIRED_SIGNAL_MISSING` · `INSUFFICIENT_OUTCOME_HISTORY` (outcome-dependent playbooks
when outcome is NO_HISTORY) · `ACQUISITION_EVIDENCE_INCOMPLETE` (acquisition-dependent
playbooks when funnel evidence is incomplete).

## Prioritization (Phase 4)

Rank by customer **priority** → playbook **confidence** → **expected value** → stable id.
Cap **top 3 per company**, **top 20 portfolio-wide**. Fully deterministic.
