# Legacy database/ archive — read-only reference

317 SQL files (and a few `.md` docs) that previously lived directly under `database/`. Archived on 2026-05-04 as part of the Database & Migration Governance migration source-of-truth consolidation.

**These files are NOT part of the canonical migration chain.** Canonical source = [`supabase/migrations/`](../../../supabase/migrations/).

## Why kept

- Forensic reference: lets you see what a given table's first DDL looked like when applied out-of-band.
- Recovery: if a future audit finds an object exists in prod that was applied from one of these files but is absent from canonical, you can use the file as starting material for a new fix migration.

## Why not deleted

- Per Phase C directive: "DO NOT DELETE FILES."
- The folder is preserved verbatim to avoid losing operational history.

## Do NOT

- Edit these files.
- Reference them from runtime code (CI guard `scripts/check-no-database-folder.js` blocks any path that re-introduces `database/X.sql`).
- Execute them via `psql` / `supabase db push` / the SQL Editor.

## Authoritative replacements

If you were about to run one of these, instead:

1. `git log --diff-filter=A -- supabase/migrations/` — find when the table entered canonical
2. If absent → file a follow-up to add a `*_fix_*.sql` migration (model it on the four Phase C fix files: `20260504010001`–`20260504010004`)
3. Apply via `supabase db push`, never via the legacy file
