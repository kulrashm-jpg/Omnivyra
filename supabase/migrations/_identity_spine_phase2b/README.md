# Identity Spine Phase 2B — Migration Drafts (v2 with fixes A–F)

Status: **DRAFT — NOT APPLIED**.

Files 1–6 in `supabase/migrations/` are committed but have not been pushed through `supabase db push` or `mcp__supabase__apply_migration`.

## Files

| Order | File | Purpose |
|---|---|---|
| 1 | `20260506000001_identity_spine_source_columns_and_fk_columns.sql` | ADD `source_of_truth` + `source_priority` to `unified_persons`; ADD nullable `unified_person_id` FK on `users` + `leads` |
| 2 | `20260506000002_unified_person_merges_table.sql` | **NEW (FIX C)** — `unified_person_merges` audit log: winner_person_id, loser_person_id, reason, merged_by, metadata |
| 3 | `20260506000003_identity_spine_backfill_unified_persons.sql` | INSERT spine rows from users (email→phone) and leads (email→phone). **No canonical inserts (FIX B).** Tag: `legacy_migration_20260506` (FIX E) |
| 4 | `20260506000004_identity_spine_link_records.sql` | UPDATE FKs on users/leads/canonical_users/canonical_leads/canonical_revenue_events. Enrich `external_keys`. Link contacts via `external_keys.contact_keys[]`. Link engagement_threads via contact_id, with raw_payload fallback (FIX A). canonical_users external_user_keys fallback (FIX F) |
| 5 | `20260506000005_identity_spine_unique_indexes.sql` | DROP non-unique idx; CREATE UNIQUE on `(company_id, primary_email)`; CREATE UNIQUE on `(company_id, primary_phone)` **with `LENGTH(primary_phone) >= 10` guard (FIX D)** |
| 6 | `20260506000006_identity_spine_users_leads_not_null.sql` | DO `$$` assert zero NULLs (raises `IDENTITY_SPINE_BACKFILL_INCOMPLETE`); SET NOT NULL on users + leads |

## Out-of-band files (this folder)

- `rollback.sql` — reverse-order rollback. Spine deletions scoped to versioned tag `legacy_migration_20260506` (FIX E) — won't touch future runtime rows.
- `verification.sql` — sections A–F. Includes A6 (merge table), C orphan checks for contacts + engagement_threads, D phone-index LENGTH guard, F source-of-truth distribution.
- `README.md` — this file.

## Fixes A–F applied (per Phase 2B feedback)

| Fix | Description | Where |
|---|---|---|
| A | contacts + engagement_threads now linked | File 4: `external_keys.contact_keys[]` for contacts; `contact_id`-based + `raw_payload->>'external_user_key'`-based for threads |
| B | canonical_users removed from INSERT sources | File 3: only users + leads INSERT into spine; canonical_users is mapping-only |
| C | merge log table | File 2: `unified_person_merges` |
| D | phone unique index has LENGTH guard | File 5: `WHERE primary_phone IS NOT NULL AND LENGTH(primary_phone) >= 10` |
| E | versioned tag for safe rollback | Files 3 + rollback: `legacy_migration_20260506` |
| F | canonical_users external_user_key fallback | File 4: enrich spine `external_keys.external_user_keys[]`, then UPDATE canonical_users match |

## Apply order on Supabase branch

```
mcp__supabase__create_branch        --name identity-spine-test
# then for each file in order 1→2→3→4→5→6:
mcp__supabase__apply_migration      --name identity_spine_<n>_<purpose>
# then run verification.sql via execute_sql; inspect every PASS/FAIL row
# only after ALL PASS, merge the Supabase branch to prod
```

## Honest disclosure of no-op linking on current data

For the current 2 users / 18 leads / 24 canonical_users / 18 canonical_leads / 10 contacts / 91 engagement_threads, the linking statements in file 4 will:

- **users + leads**: link 100% (email is NOT NULL on both tables; backfill creates spine rows for every email).
- **canonical_users**: link those whose email matches a user/lead email. Others linked via phone fallback. Remaining (no email AND no phone) stay NULL — acceptable per design (NOT NULL not applied to canonical_users).
- **canonical_leads / canonical_revenue_events**: link transitively through canonical_users. Coverage = canonical_users coverage.
- **contacts**: **0 of 10 linked** on current data. The `contact_keys[]` lookup is a no-op until ingestion or a separate enrichment migration writes those keys into `unified_persons.external_keys`. This is documented as a known gap, not a regression — current `contacts` records were already unlinked.
- **engagement_threads**: **0 of 91 linked** unless either (a) their `contact_id` resolves to a linked contact (which won't happen on current data), or (b) their `raw_payload` carries an `external_user_key` matching a linked canonical_users row.

The linking SQL is in place so that future ingestion (which writes `external_keys.contact_keys[]`, populates `contact_id` + links upstream contacts, or includes `external_user_key` in webhook payloads) is **automatically retroactive**: re-running file 4's UPDATE statements after enrichment will link all newly-resolvable rows without any additional migration.

## Out of scope (carried to next phase)

- Code patches: `createLead()`, `syncAuthUserToLocal()`, `identityGateway.ts` chokepoint — Phase 2C
- Test fixtures broken by NOT NULL — Phase 2C
- Code that calls `merge_unified_persons()` at runtime when collisions are detected

## DEFERRED IDENTITY COVERAGE (Phase 2B.5)

**contacts (10 rows on prod):**
- No email / phone / external identity linkage available on the table or any related table (`engagement_authors` also has no email column)
- 0 of 10 will be linked by this migration; remains NULL post-apply
- Resolution requires enrichment via external platform APIs (X/Instagram/LinkedIn for the underlying user behind `platform_user_id`) or by parsing `engagement_messages.raw_payload` for embedded identity fields
- Tracked as Phase 2B.5

**engagement_threads (91 rows on prod):**
- 91 of 91 have NULL `contact_id`
- 91 of 91 lack `raw_payload.external_user_key`
- 0 of 91 will be linked by this migration; remains NULL post-apply
- Resolution requires upstream ingestion changes that populate either `contact_id` or `raw_payload.external_user_key` for new threads, plus the same enrichment work as contacts for historical threads
- Tracked as Phase 2B.5

**canonical_users anonymous tracking sessions (4 of 24 rows on prod):**
- `user_type = 'anonymous'` — no identity by design, NULL `unified_person_id` is correct
- These are NOT a coverage gap; they are sessions, not persons
- File 6 NOT NULL is therefore intentionally not extended to canonical_users

The forward-only contracts honored by Track A:
- New users / leads written via patched ingestion (Phase 2C) MUST carry `unified_person_id` (NOT NULL)
- Runtime merges go through `merge_unified_persons(winner, loser, reason, actor)` (file 2) — never raw UPDATE+DELETE
- All future identity ingestion writes `source_of_truth` with a non-`legacy_migration_*` tag so rollbacks remain safe

## Known gotchas at apply time

1. File 5's `CREATE UNIQUE` on email will fail if file 3 produced collisions. The `NOT EXISTS` guard in file 3 should prevent this; if it fails, run section D of `verification.sql` to identify the duplicate group and patch file 3 before retrying.
2. File 6's `DO $$` block aborts if any users/leads still have NULL `unified_person_id`. Currently impossible (`users.email` is NOT NULL UNIQUE, `leads.email` is NOT NULL), but if a prior migration relaxed either constraint while this draft was sitting unapplied, file 6 fails.
3. **Code MUST be patched (Phase 2C) before file 6 is applied to prod**, otherwise the next user/lead insert hits the NOT NULL constraint with no `unified_person_id`. Apply schema + code together in one PR or feature-flag the runtime path.
4. Phone duplicates with normalized length < 10 will be allowed by the unique index — this is intentional (test fixtures, partial data fragments). Cleaner phones (E.164) all pass the guard.
