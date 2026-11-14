-- Rollback of 20270217000054_intelligence_poll_tenant_catalog_row.sql (e1). Deletes ONLY the row 054 wrote, matched on
-- its description marker; a differently configured intelligence_poll_tenant row (not 054's) is left untouched.
DELETE FROM public.credit_cost_config
 WHERE action_type = 'intelligence_poll_tenant'
   AND description = 'Tenant-owned source check, per source per day (20270217000054)';
