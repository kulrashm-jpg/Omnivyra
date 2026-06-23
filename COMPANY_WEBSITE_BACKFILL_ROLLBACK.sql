-- COMPANY_WEBSITE_BACKFILL_ROLLBACK.sql  (generated 2026-06-22T17:41:10.313Z)
-- Restores the 3 backfilled websites to their prior values.
BEGIN;
UPDATE companies SET website = NULL WHERE id = '4dae7f7a-b518-4557-b8cb-5c6123ff9658' AND website = 'https://www.drishiq.com';
UPDATE companies SET website = NULL WHERE id = '73e5fa6f-822d-4eb5-8c85-42d79b25f394' AND website = 'https://www.embrosales.in';
UPDATE companies SET website = NULL WHERE id = '7a606a40-4d8e-4d23-b967-3df0ca4b0c8a' AND website = 'https://www.nothingelsematterz.com';
COMMIT;
