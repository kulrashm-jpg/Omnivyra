-- Rollback of 20270217000051_totp_factors_last_used_step.sql (e1). Roll the CODE back FIRST (the verify path writes this
-- column); with the column gone and the M3 code still deployed, every TOTP verification fails closed.
ALTER TABLE public.totp_factors DROP COLUMN IF EXISTS last_used_step;
