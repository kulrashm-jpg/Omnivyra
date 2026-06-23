# READINESS_SNAPSHOT_SCHEMA.md

Phase 12H · Phase 1 — schema for `customer_readiness_snapshots`. A daily, read-only
time series of the Customer Readiness model per company. Additive, isolated table.

Migration: [supabase/migrations/20260723000000_customer_readiness_snapshots.sql](supabase/migrations/20260723000000_customer_readiness_snapshots.sql).

## Columns

| Column | Type | Notes |
|---|---|---|
| `snapshot_id` | uuid PK | `gen_random_uuid()` |
| `company_id` | uuid NOT NULL | the tenant (no FK — isolated audit/history table) |
| `taken_at` | timestamptz NOT NULL | when captured (default `now()`) |
| `snapshot_date` | date NOT NULL | UTC date of capture — idempotency key |
| `tenant_status` | text NOT NULL | SIGNUP_STARTED … INACTIVE |
| `overall_readiness_score` | integer NOT NULL | 0–100 |
| `readiness_bucket` | text NOT NULL | READY / PARTIAL / AT_RISK |
| `priority_score` | integer NOT NULL | 0–100 |
| `priority_tier` | text NOT NULL | CRITICAL … READ_ONLY |
| `opportunity_count` | integer NOT NULL | detected opportunities |
| `company_profile_ready` | text NOT NULL | READY / NOT_READY / UNKNOWN |
| `website_ready` | text NOT NULL | " |
| `ga_ready` | text NOT NULL | " |
| `gsc_ready` | text NOT NULL | " |
| `social_ready` | text NOT NULL | " |
| `community_ready` | text NOT NULL | " (always UNKNOWN today) |
| `team_ready` | text NOT NULL | " |
| `billing_ready` | text NOT NULL | " |
| `snapshot_version` | text NOT NULL | `readiness-snapshot-v1` (schema/semantics version) |

## Indexes / constraints

- **UNIQUE `(company_id, snapshot_date)`** → exactly one snapshot per company per day
  (the idempotency guarantee — the daily job is rerun-safe).
- INDEX `(company_id, taken_at DESC)` → fast latest-N reads for the evolution engine.

## Idempotency model

The daily generator upserts with `onConflict: (company_id, snapshot_date),
ignoreDuplicates: true`. A second run on the same UTC day inserts **0** rows — the
existing snapshot stands. Reruns are safe and produce no duplicates or mutations
outside this table.

## Activation (governed apply — not performed here)

The repo enforces schema governance (ad-hoc SQL is disabled; migrations live in
`supabase/migrations/`). This migration is **created but not applied** — applying
production DDL is a governed operator step (and there is no direct DB connection
available to this process). Once applied and the daily job runs, the Evolution engine
(`customerEvolutionService`) reads these rows automatically and trajectories activate
after ≥ 2 daily snapshots accumulate.
