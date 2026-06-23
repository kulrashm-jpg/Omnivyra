-- PHASE10C_ROLLBACK.sql  (generated 2026-06-22T18:25:44.467Z)
-- Restores website + website_domain to NULL for the 3 Phase-10C companies,
-- ONLY if current values still equal the Phase-10C backfill values.
BEGIN;
UPDATE companies SET website = NULL, website_domain = NULL
  WHERE id = '4dae7f7a-b518-4557-b8cb-5c6123ff9658' AND website = 'https://www.drishiq.com' AND website_domain = 'drishiq.com';
UPDATE companies SET website = NULL, website_domain = NULL
  WHERE id = '73e5fa6f-822d-4eb5-8c85-42d79b25f394' AND website = 'https://www.embrosales.in' AND website_domain = 'embrosales.in';
UPDATE companies SET website = NULL, website_domain = NULL
  WHERE id = '7a606a40-4d8e-4d23-b967-3df0ca4b0c8a' AND website = 'https://www.nothingelsematterz.com' AND website_domain = 'nothingelsematterz.com';
COMMIT;
