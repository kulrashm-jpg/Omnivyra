# Schema Resilience & Missing Table Migrations

This document lists database migrations to run when you see schema-related warnings in logs. The application is hardened to continue running when these tables are missing, but running the migrations enables full functionality.

## Tables That May Be Missing

| Table | Migration File | When to Run |
|-------|----------------|-------------|
| `governance_audit_runs` | `database/governance_audit_runs.sql` | When you see: "governance_audit_runs table not found" |
| `external_api_health` | `database/external_api_health.sql` | When you see: "external_api_health table not found" |
| `external_api_usage` | `database/external-api-usage.sql` | When you see: "external_api_usage table not found" |

## signal_clusters Optional Columns

The signal clustering engine works with the base `signal_clusters` table. For full functionality (cluster → source API lookup, vector search), run:

| Column | Migration File | When to Run |
|--------|----------------|-------------|
| `source_api_id` | `database/signal_clusters_source_api_id.sql` | When you see: "Could not find the 'source_api_id' column of 'signal_clusters'" |
| `topic_embedding` | `database/add_signal_embeddings.sql` | For semantic clustering (optional) |

Without these, clustering continues with the minimal schema (cluster_topic, signal_count, etc.).

## content_analytics Schema Variants

The performance ingestion job supports two schema variants:
- **`date`** column (used by `complete-reset-and-apply.sql`, `comprehensive-scheduling-schema.sql`)
- **`analytics_date`** column (used by `safe-database-migration.sql`, `add-missing-tables.sql`)

The job auto-detects which column exists. The `user_id` column is **not required** in `content_analytics`; the job derives it from `scheduled_posts`.

## Running Migrations

```bash
# Run individual migrations via psql or Supabase SQL editor
psql $DATABASE_URL -f database/governance_audit_runs.sql
psql $DATABASE_URL -f database/external_api_health.sql
psql $DATABASE_URL -f database/external-api-usage.sql
```

Or apply via Supabase Dashboard → SQL Editor → paste and run each file's contents.
