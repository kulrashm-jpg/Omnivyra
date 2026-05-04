-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260501094752  Name: company_domains_final_domain_unique_and_not_null
-- Idempotency: NOT GUARDED — ADD CONSTRAINT will fail on second apply. Flagged in B0 report.
-- Pre-condition: scripts/backfillCanonicalDomains.ts collisions_found=0.

ALTER TABLE company_domains
  ADD CONSTRAINT unique_final_domain UNIQUE (final_domain);

ALTER TABLE company_domains
  ALTER COLUMN final_domain SET NOT NULL;
