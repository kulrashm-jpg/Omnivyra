# DIGITAL_ADOPTION_MODEL.md

Phase 14D · Phase 2 — deterministic digital-adoption model. Evidence-only; UNKNOWN stays
UNKNOWN.

## Capabilities & per-capability states

7 capabilities: PROFILE, DOMAIN_VERIFICATION, GA, GSC, SOCIAL, TEAM, BILLING.

| State | Definition |
|---|---|
| ADOPTED | readiness area = READY |
| NOT_STARTED | readiness area = NOT_READY |
| UNKNOWN | readiness area = UNKNOWN |
| PARTIAL | *(defined, but no source signal — readiness is binary; never emitted)* |

## Per-company adoption

- `adoption_score` = adopted capabilities / 7 × 100.
- `adoption_status`: **ADOPTED** (all 7) · **PARTIAL** (1–6) · **NOT_STARTED** (0) ·
  **UNKNOWN** (all 7 unknown).
- `adopted_capabilities` / `missing_capabilities` lists + evidence + confidence (HIGH unless
  a capability is UNKNOWN → MEDIUM).

## Adoption funnel (independent stage-reach)

```
COMPANY_CREATED → PROFILE_READY → DOMAIN_VERIFIED → GA_CONNECTED → GSC_CONNECTED
→ SOCIAL_CONNECTED → TEAM_ESTABLISHED → BILLING_ACTIVE → ACTIVATED
```

Per stage: reached, lost, loss %, conversion %. **Non-strict** — `ACTIVATED` is
activity-driven, not capability-gated, so stages are independent reach, not a strict
sequence.

## Path & gap analysis (association only)

- **Path** = sorted signature of a company's adopted capabilities (e.g. `PROFILE+BILLING`,
  or `NONE`). Reported per activation cohort with counts + activation rate.
- **Capability matrix** = per capability: ready / missing counts and activation rate when
  present vs absent. **Association only — never causality**; small "present" populations are
  low-confidence.
