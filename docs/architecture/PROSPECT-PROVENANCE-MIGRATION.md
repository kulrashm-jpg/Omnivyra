# Prospect provenance — migration and operator procedure

Migration: `supabase/migrations/20270107000000_pi_prospect_source_contributions.sql`
Contract: `docs/architecture/PROSPECT-PROVENANCE-CONTRACT.md`, `lib/prospectProvenance/contract.ts`
Writer (only write path): `backend/services/prospectProvenance/contributionWriter.ts`
Tests: `backend/tests/unit/piProvContributionWriter.test.ts`,
`backend/tests/realschema/pi_prov_contributions.test.ts`

Status: NOT applied to production. No deploy applies migrations; application is a
separate, explicitly authorised operator step (below).

## What the migration does

1. **Preflight** (aborts, changing nothing): PostgreSQL ≥ 15 (needed for
   `ON DELETE SET NULL (column)`); `companies`, `canonical_leads`, `source_records`,
   `contacts`, `lead_signals`, `opportunity_feed_items`, `engagement_messages` exist;
   `engagement_messages.organization_id` is NOT NULL; the existing tenant keys
   `idx_canonical_leads_id_company`, `uq_source_records_id_org`,
   `engagement_messages_id_org_unique` exist; `auth.role()` exists.
2. **`source_records`** gains nullable `source_category` (CHECK
   `source_records_source_category_valid`, the 12-value vocabulary), `platform`,
   `source_url`. No default, no backfill — existing rows read NULL.
3. **Tenant keys** `uq_contacts_id_org`, `uq_lead_signals_id_org`,
   `uq_opportunity_feed_items_id_org` — UNIQUE `(id, organization_id)`. `id` is
   already the primary key, so these cannot fail on existing data.
4. **`public.prospect_source_contributions`** with the contract columns, CHECKs,
   the contract unique constraint and partial index, lookup indexes and six
   composite tenant FKs.
5. **Exposure**: RLS enabled (not forced), one policy
   `prospect_source_contributions_service_role` (`TO service_role`),
   `REVOKE ALL` from PUBLIC/anon/authenticated/authenticator/service_role, then
   `GRANT SELECT, INSERT TO service_role`.
6. **`$verify$`** postcondition block: re-proves every object above (names,
   definitions, delete actions incl. the SET NULL column lists, privileges,
   policy, RLS) and raises — rolling back the whole transaction — on any drift.

Everything is `IF NOT EXISTS` or guarded by name; the file is one
`BEGIN … COMMIT` and re-applies cleanly (verified twice on a local replay).

## Schema diagram

```
companies (id) ─────────────────────────────── ON DELETE CASCADE ────────────┐
   │                                                                          │
canonical_leads (id, company_id) ◄── psc_lead_tenant_fk ── CASCADE ───────────┤
                                                                              │
                         ┌────────────────────────────────────────────────────┴──┐
                         │ prospect_source_contributions                         │
                         │  id uuid PK                                           │
                         │  organization_id uuid NOT NULL  (tenant)              │
                         │  canonical_lead_id uuid NOT NULL                      │
                         │  contribution_role  originating|contributing          │
                         │  source_category    12-value CHECK                    │
                         │  external_ref       ^[a-z][a-z0-9_]{0,39}:.+          │
                         │  source_record_id, contact_id, lead_signal_id,        │
                         │  opportunity_feed_item_id, engagement_message_id      │
                         │  platform, source_url, ingestion_run_id (text)        │
                         │  observed_at NOT NULL, created_at default now()       │
                         │  evidence, source_metadata jsonb object, default {}   │
                         │                                                       │
                         │  UNIQUE uq_psc_org_lead_external_ref                  │
                         │         (organization_id, canonical_lead_id,          │
                         │          external_ref)                                │
                         │  UNIQUE uq_psc_one_originating_per_lead               │
                         │         (canonical_lead_id) WHERE role='originating'  │
                         └───┬──────────┬──────────┬──────────┬──────────┬───────┘
   (pointer, organization_id) composite FKs, each ON DELETE SET NULL (pointer)
                             │          │          │          │          │
          source_records ────┘          │          │          │          │
            (id, organization_id)       │          │          │          │
          contacts ─────────────────────┘          │          │          │
            (id, organization_id) NEW key          │          │          │
          lead_signals ────────────────────────────┘          │          │
            (id, organization_id) NEW key                     │          │
          opportunity_feed_items ─────────────────────────────┘          │
            (id, organization_id) NEW key   (signal_id → lead_signals CASCADE)
          engagement_messages ───────────────────────────────────────────┘
            (id, organization_id)
```

Indexes: `idx_psc_org_lead_observed (organization_id, canonical_lead_id, observed_at DESC)`,
`idx_psc_org_source_record (organization_id, source_record_id) WHERE NOT NULL`,
`idx_psc_org_category_observed (organization_id, source_category, observed_at DESC)`, and
partial single-column indexes on each nullable pointer (`idx_psc_contact`,
`idx_psc_lead_signal`, `idx_psc_opportunity_feed_item`, `idx_psc_engagement_message`)
so that a parent delete — e.g. a 10 000-row retention batch of feed items — does not
scan this table once per deleted parent.

## Constraint rationale

| Constraint | Why |
|---|---|
| `psc_contribution_role_valid` | exactly two roles (contract). |
| `psc_source_category_valid` | the 12-value vocabulary, identical to `SOURCE_CATEGORIES`; a new category is a contract change (TS + both CHECKs). |
| `psc_external_ref_namespaced` | `^[a-z][a-z0-9_]{0,39}:.+` — the same provider pattern as `namespacedExternalRef`/`parseExternalRef`; un-namespaced (legacy raw) keys cannot enter the ledger. |
| `psc_evidence_is_object`, `psc_source_metadata_is_object` | the reader treats both as objects; arrays/scalars are rejected at the database too. |
| `uq_psc_org_lead_external_ref` | idempotency of a source event per lead: a retried ingestion converges (writer → `duplicate`). Declared inside the table so its index precedes the originating index; a retried *originating* event therefore reports this name first (verified). The writer handles either order. |
| `uq_psc_one_originating_per_lead` | at most one originator per lead. Partial, so ON CONFLICT cannot infer it — the writer uses INSERT → catch 23505 → retry as `contributing` (`roleDowngraded`). |
| Composite FKs `(pointer, organization_id)` | a contribution cannot reference another tenant's lead/record/contact/signal/feed item/message: PostgreSQL raises 23503 (verified for all six). |
| Privileges SELECT+INSERT only | append-only at the privilege level; no client role can UPDATE/DELETE. |

## ON DELETE decisions (evidence)

| FK | Action | Evidence / reasoning |
|---|---|---|
| `organization_id → companies` | CASCADE | House convention: every PI/tenant table cascades from `companies` (e.g. `canonical_leads_company_id_fkey`, `source_records_organization_id_fkey`). Tenant offboarding removes everything it owns. |
| `psc_lead_tenant_fk → canonical_leads` | **CASCADE** | (a) `canonical_lead_id` is NOT NULL — a contribution without its prospect has no subject. (b) Erasure: contributions carry `source_url` and `evidence`, which can be personal data; deleting/erasing a prospect must take its provenance with it. RESTRICT would make every prospect with provenance undeletable and would break the existing cascades that reach `canonical_leads` (`companies` → CASCADE, `canonical_users` via `canonical_leads_user_fk` → CASCADE). (c) Precedent: `canonical_revenue_events_lead_fk` (same composite shape) is CASCADE. (d) CODE-INFERRED: no application code deletes `canonical_leads` today (grep of `backend/`, `lib/`, `pages/` excluding tests: no `.delete()` / `DELETE FROM canonical_leads`); person erasure (`backend/services/prospectIdentity/personErasure.ts`) deletes `unified_persons` only, and `canonical_leads.unified_person_id` is `SET NULL (unified_person_id)`, so erasing a person leaves the lead and its contributions — a lead-level erasure procedure, if one is added, gets cascade semantics for free. |
| `psc_opportunity_feed_item_tenant_fk` | SET NULL (`opportunity_feed_item_id`) | `backend/services/retentionService.ts` hard-deletes `opportunity_feed_items` (`retention_policies.target_kind = 'opportunity_feed_items'`, `archival_mode = 'hard_delete'`). The contract requires the contribution to survive. RESTRICT would turn every contribution into a retention blocker (the retention executor already special-cases `RETENTION_PROTECTED_CHILDREN`); CASCADE would lose provenance. |
| `psc_lead_signal_tenant_fk` | SET NULL (`lead_signal_id`) | `opportunity_feed_items_signal_id_fkey` is CASCADE from `lead_signals`; deleting a signal deletes its feed items. Both pointers on the same contribution are cleared in one statement (verified). |
| `psc_source_record_tenant_fk` | SET NULL (`source_record_id`) | The contribution keeps `external_ref`, `platform`, `source_url`, `observed_at`, `evidence`, so it stays readable without the record. RESTRICT (the `prospect_problem_observations` choice) would block source-record cleanup/erasure on a ledger that must never block. |
| `psc_contact_tenant_fk` | SET NULL (`contact_id`) | matches `lead_signals_contact_id_fkey` and `engagement_threads_contact_id_fkey` (both SET NULL). |
| `psc_engagement_message_tenant_fk` | SET NULL (`engagement_message_id`) | messages cascade from `engagement_threads`; same survival reasoning. |

All SET NULL actions use the PG15+ **column-list** form. A bare `ON DELETE SET NULL`
on a composite FK nulls every referencing column — including `organization_id`
(NOT NULL) — and the parent delete would fail. The `$verify$` block asserts
`confdelsetcols` names exactly the pointer column. The referential action runs as
the table owner, so it is unaffected by the append-only grants.

Note: SET NULL is the only mutation a contribution ever undergoes after insert.
Readers must treat a NULL pointer as "the referenced row no longer exists", not
"there never was one"; the writer is expected to copy durable identifiers into
`external_ref` / `evidence` at write time.

## Operator application procedure (production)

Prerequisites: explicit owner authorisation for this migration; target confirmed
by project ref `klkiseupptzbecbxwrky`. Never `supabase db push` (the production
migration ledger is out of sync with the repository). Apply this single file.

1. **Read-only pre-checks** (SQL editor):
   ```sql
   SELECT current_setting('server_version_num');                         -- ≥ 150000
   SELECT to_regclass('public.prospect_source_contributions');           -- NULL
   SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='source_records'
      AND column_name IN ('source_category','platform','source_url');    -- 0 rows
   SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND indexname IN ('idx_canonical_leads_id_company','uq_source_records_id_org',
                      'uq_contacts_id_org','uq_lead_signals_id_org','uq_opportunity_feed_items_id_org');
   SELECT conname FROM pg_constraint WHERE conname='engagement_messages_id_org_unique';
   SELECT count(*) FROM public.contacts; SELECT count(*) FROM public.lead_signals;
   SELECT count(*) FROM public.opportunity_feed_items;                   -- sizes the index builds
   ```
2. **Locks**: the three `CREATE UNIQUE INDEX` statements take a SHARE lock on
   `contacts`, `lead_signals`, `opportunity_feed_items` for the build (writes wait,
   reads continue); `ALTER TABLE source_records ADD COLUMN` (nullable, no default)
   is metadata-only but takes a brief ACCESS EXCLUSIVE lock. Production sizes are
   small, but apply in a low-traffic window. If any of those tables has grown
   large, pre-create the three indexes with `CREATE UNIQUE INDEX CONCURRENTLY IF
   NOT EXISTS …` (outside a transaction) first; the migration then skips them.
3. **Apply**: run the whole file as-is in the SQL editor (it is one transaction).
   Success ends with `NOTICE: PSC: prospect_source_contributions verified — …`.
   Any `PSC preflight:` / `PSC postcondition:` exception means nothing was changed.
4. **Ledger**: record the version in `supabase_migrations.schema_migrations`
   (version `20270107000000`, name `pi_prospect_source_contributions`) the same
   way as the other individually-applied migrations.
5. **Post-checks**: re-run the file (it must succeed again — idempotent, and the
   `$verify$` block re-proves the end state); `SELECT count(*) FROM
   public.prospect_source_contributions` → 0; confirm existing
   `source_records` rows read NULL for the three new columns.

## Rollback considerations

- The migration is a single transaction: a failure leaves nothing behind.
- After a successful apply, rollback is only safe **before any writer runs**
  (the table is then empty). Once contributions exist, dropping the table
  destroys provenance that cannot be reconstructed — prefer disabling the writers
  (feature flag at the ingestion paths) over a schema rollback.
- Manual rollback (no rollback file is shipped; run only with owner approval):
  ```sql
  BEGIN;
  DROP TABLE IF EXISTS public.prospect_source_contributions;   -- drops its FKs, indexes, policy
  ALTER TABLE public.source_records DROP CONSTRAINT IF EXISTS source_records_source_category_valid;
  ALTER TABLE public.source_records DROP COLUMN IF EXISTS source_url,
                                    DROP COLUMN IF EXISTS platform,
                                    DROP COLUMN IF EXISTS source_category;
  -- The three (id, organization_id) keys are harmless and may be kept; drop only
  -- if nothing else has started referencing them:
  -- DROP INDEX IF EXISTS public.uq_contacts_id_org, public.uq_lead_signals_id_org,
  --                      public.uq_opportunity_feed_items_id_org;
  COMMIT;
  ```
  Dropping the `source_records` columns loses any values written to them; check
  `SELECT count(*) FROM source_records WHERE source_category IS NOT NULL OR
  platform IS NOT NULL OR source_url IS NOT NULL` first. Remove the ledger row too.
- Code that writes contributions (`recordSourceContribution`) returns
  `{status:'error'}` rather than throwing if the table is absent, so a rollback
  does not crash ingestion — but callers must not treat that as success.
