-- Rollback for 20270217000048_creator_audit_log_company_backfill_once: deliberately a NO-OP.
--
-- 048 changes DATA only (company_id on legacy creator_audit_log rows that were NULL); it creates no object and
-- leaves trg_creator_audit_log_no_update enabled exactly as it found it (its postcondition asserts tgenabled = 'O').
-- Setting company_id back to NULL would need a second append-only exception and would re-create the tenant-data
-- defect (MISSING company, 83 C91) that the owner ruled to fix. The backfilled rows are identifiable without any
-- marker: they are exactly the rows whose company_id equals their campaign's (or their post's campaign's) company
-- and whose created_at precedes the writer fix's deploy.
-- If a backfilled value is ever found wrong, forward-fix it with a NEW owner-approved migration of the same shape.
DO $$ BEGIN RAISE NOTICE '048 rollback: no-op by design (data-only backfill; trigger state unchanged)'; END $$;
