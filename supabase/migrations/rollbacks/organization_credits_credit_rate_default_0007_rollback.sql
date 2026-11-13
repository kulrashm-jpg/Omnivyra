-- Rollback of 20270217000047_organization_credits_credit_rate_default_0007.sql (e1).
-- Restores the previous DEFAULT. Existing rows are not changed (they were never changed by 047 either).
ALTER TABLE public.organization_credits ALTER COLUMN credit_rate_usd SET DEFAULT 0.01;

DO $verify$
BEGIN
  IF (SELECT pg_get_expr(d.adbin, d.adrelid)
        FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'public.organization_credits'::regclass AND a.attname = 'credit_rate_usd') IS DISTINCT FROM '0.01' THEN
    RAISE EXCEPTION '047 rollback: credit_rate_usd DEFAULT is not 0.01';
  END IF;
END
$verify$;
