# CUSTOMER_UNKNOWNS_AUDIT.md

Phase 13H · Phase 3 — root-cause analysis for every UNKNOWN / UNOBSERVABLE source.
**Audit only — no telemetry added, no schema changed.**

## UNKNOWN (fixable — data could be observed but isn't persisted/linked)

### EMAIL_VERIFIED
- **Root cause:** verification state lives in Supabase `auth.users.email_confirmed_at`.
- **Missing source:** no `public`-schema mirror.
- **Missing persistence:** the public app layer never copies the verified flag into a
  readable table.
- **Missing linkage:** `signup_intents.supabase_uid` is empty (0 rows populated), so
  intents can't be joined to the auth user.
- **Limitation type:** **temporary/architectural** — fixable by persisting/mirroring the
  flag or populating `supabase_uid` (out of scope here).

### IDENTITY_VALIDATED
- **Root cause:** the identity/domain validation verdict is computed at signup time and
  used for the gate decision, then discarded.
- **Missing source:** no per-signup verdict row.
- **Missing persistence:** only *negative* domain checks land in
  `domain_eligibility_cache`; passes are recorded as `valid_company` (domain-level, not
  per-signup).
- **Limitation type:** **temporary** — fixable by persisting the verdict per attempt.

### UNKNOWN acquisition failures (19 pending intents)
- **Root cause:** `signup_intents.stage` is non-granular (always `pending`).
- **Missing source:** no stage-transition log.
- **Missing persistence:** the abandonment step is never recorded.
- **Limitation type:** **temporary** — fixable by writing stage transitions.

## UNOBSERVABLE (structural — cannot be observed with current architecture)

### VISITOR
- **Root cause:** no web-analytics instrumentation feeding the platform.
- **Missing source:** pre-signup traffic is entirely outside any owned table.
- **Limitation type:** **structural** — requires a new analytics data source.

### COMMUNITY
- **Root cause:** no community feature/table exists.
- **Missing source:** there is nothing to read; the readiness area is a placeholder.
- **Limitation type:** **structural** — UNKNOWN by design until a community surface ships.

## Temporal NO_HISTORY states (resolve with time, not engineering)

`SNAPSHOT_HISTORY`, `EVOLUTION_TRAJECTORY`, `OUTCOME_CLASSIFICATION`, `IMPACT_ATTRIBUTION`
are PARTIAL only because the snapshot table has **one** day of history (13B, Day 1). They
become COMPLETE automatically once the daily snapshot job has run ≥ 2 days — no code or
schema change required.
