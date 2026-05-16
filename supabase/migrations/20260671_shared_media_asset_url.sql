-- Shared media — additive URL columns for runtime publishing resolution
--
-- PURE ADDITIVE. Adds nullable URL columns so the runtime can resolve a
-- shared/overridden asset_id → a concrete media URL without coupling to
-- any unknown media table. No row writes, no behavior change; existing
-- rows simply get NULL. ALTER TABLE ADD COLUMN does NOT fire the
-- row-level immutability trigger on content_core_asset (BEFORE
-- UPDATE/DELETE), so the immutable-lineage guarantee is preserved.

ALTER TABLE public.content_core_asset
  ADD COLUMN IF NOT EXISTS asset_url text;

ALTER TABLE public.content_asset_platform_override
  ADD COLUMN IF NOT EXISTS override_asset_url text;
