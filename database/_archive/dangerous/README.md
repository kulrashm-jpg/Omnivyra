# DO NOT EXECUTE — NON-CANONICAL DESTRUCTIVE SCRIPTS

These 7 scripts were archived from `database/` on 2026-05-04 because they perform destructive operations:

| Script | What it does |
|---|---|
| `reset-and-apply-schema.sql` | Drops + recreates the entire schema |
| `cleanup-database.ps1` / `.sh` | Runs reset SQL via the Supabase / psql CLI |
| `cleanup-unnecessary-tables.sql` | Drops a list of tables |
| `clear-campaign-data.ps1` | Wipes campaign data tables |
| `setup-super-admin.ps1` | Inserts privileged super-admin role |
| `campaign-management-clean-schema.sql` | Drops + recreates campaign tables |

**None of these are part of the canonical migration chain.** They were operator-of-last-resort tooling. They are kept for forensic reference only.

If you genuinely need a destructive operation:
1. Write a new migration in `supabase/migrations/` with the operation explicit and reviewed.
2. Test on a dev branch project first.
3. Never run these archived scripts directly.
