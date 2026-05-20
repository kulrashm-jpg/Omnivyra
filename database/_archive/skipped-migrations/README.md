# Skipped Migration Drafts

Files in this folder were removed from `supabase/migrations/` because the Supabase CLI skipped them as invalid or intentionally disabled migration files.

They are archive-only and must not be applied directly.

To revive any change:

1. Review the SQL against current production schema.
2. Copy only the required statements into a new valid timestamped migration under `supabase/migrations/`.
3. Run the normal migration and schema authority checks.
