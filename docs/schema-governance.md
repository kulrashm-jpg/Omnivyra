# Schema Governance

Production schema authority lives in:

- `supabase/migrations/`
- `modules/extension/database/extension_schema.sql` for the extension package only

Other SQL folders are reference/operator/archive unless a file is promoted into a timestamped Supabase migration.

## Current Fate Rules

- Runtime-referenced tables must exist in Supabase `public`.
- Empty unused live tables should be quarantined into `archive`, not dropped directly.
- Local-only SQL with no runtime references belongs under `database/_archive/`.
- Commented SQL examples are not schema authority.
- `database/` is legacy/reference/archive SQL, not production authority.
- `db-utils/` is legacy reference SQL, not an execution source.
- Skipped or disabled migration drafts belong under `database/_archive/skipped-migrations/`.
- Direct SQL runners must refuse execution unless they call the authoritative migration flow.

## Enforced Check

Run:

```bash
npm run check:schema-authority
```

The check fails when:

- an authoritative local `CREATE TABLE` is missing from Supabase `public`
- runtime code directly references a missing table with `.from('table_name')`

The detailed machine-readable output is written to:

```text
tmp/schema-authority-check.json
```

## Recent Cleanup

- Direct runtime contracts were migrated in `20260701000000_runtime_missing_contract_tables.sql`.
- Empty unused public tables were moved to `archive` in `20260701001000_quarantine_unused_public_tables.sql`.
- Indirect runtime contracts were migrated in `20260701002000_indirect_runtime_contract_tables.sql`.
- Remaining runtime table/view/RPC contracts were completed in `20260701003000_runtime_contract_completion.sql`.
- Optional attribution continuity tables were applied in `20260701004000_universal_attribution_capture.sql`.
- Optional lead-capture topology persistence was applied in `20260701005000_lead_capture_topology.sql`.
- Local-only unused SQL was moved under `database/_archive/local-only-unused/`.
- Skipped migration drafts were moved under `database/_archive/skipped-migrations/`.
- Legacy direct SQL runners now refuse execution before opening database connections.
