# Database SQL Archive

Production schema authority is `supabase/migrations/`.

Files in this `database/` folder are legacy/reference/operator SQL unless they are deliberately promoted into a timestamped Supabase migration. Do not bulk-apply this folder to production.

Skipped or disabled migration drafts are parked under `database/_archive/skipped-migrations/` so the Supabase CLI does not treat them as malformed migrations.

Current cleanup status:

- Runtime tables that were directly referenced by code but missing from Supabase were promoted through `supabase/migrations/20260701000000_runtime_missing_contract_tables.sql`.
- Empty, unreferenced public tables were parked in the `archive` schema through `supabase/migrations/20260701001000_quarantine_unused_public_tables.sql`.
- Indirect runtime contracts were promoted through `supabase/migrations/20260701002000_indirect_runtime_contract_tables.sql`.
- Remaining runtime table/view/RPC contracts were completed through `supabase/migrations/20260701003000_runtime_contract_completion.sql`.
- `npm run check:schema-authority` is the guard for preventing schema drift from returning.
- Direct database cleanup/setup scripts in this folder now refuse execution before opening a database connection.
