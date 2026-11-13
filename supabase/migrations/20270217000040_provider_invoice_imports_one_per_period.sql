-- 20270217000040 - one provider invoice per (provider, period) (6f; version from 83; e1 ruling as ledger owner).
--
-- WHY.
--   The provider reconcilers (openai / anthropic / gemini / audio / image) compare ONE invoice against the WHOLE
--   period's estimated spend. Two invoices for the same provider and period (a split invoice, a credit note) were
--   each matched against that full estimate - the variance was counted twice - and, since cost_reconciliation_runs
--   is unique per (provider, period), the second run overwrote the first one's totals. The intended semantics are
--   ONE invoice per (provider, period_start, period_end); a split invoice is merged into one manifest by the operator.
--   SCOPE (e1): IDENTICAL bounds are enforced here, in the DB; OVERLAPPING periods are enforced in the app only
--   (reconciliationPersist refuses any other invoice with period_start < :end AND period_end > :start, half-open).
--   A DB overlap rule would need EXCLUDE USING gist (provider WITH =, tstzrange(...) WITH &&), i.e. btree_gist,
--   which is not installed (not in baseline, migrations or bootstrap) - so it is not proposed here.
--   The app already refuses a second invoice (reconciliationPersist, fix/reconciler-platform-usage-20261113); this
--   index makes the rule hold for ANY caller, not only the single-operator localhost CLI (e1), and closes the
--   check-then-insert race. The app treats a 23505 for an invoice it cannot find stored as "the period belongs to
--   another invoice" and refuses.
--
-- WHAT. Schema only - NO data write. A unique index on provider_invoice_imports(provider, period_start, period_end).
--   The existing non-unique idx_pii_period on the same columns is left in place (additive only; a later cleanup can
--   drop it). Production holds 0 rows in provider_invoice_imports (83, C58, read-only, owner-approved), so the
--   preflight below cannot fire there; it exists for any environment that has data.
--   Privilege posture RESTATED (enumerative-hardening lesson, e1): anon / authenticated hold nothing (as set by
--   20261026000000); service_role is GRANTed SELECT, INSERT explicitly - the reconcilers' only operations (the table
--   is append-only: raise_ledger_immutable blocks UPDATE / DELETE). Hosted Supabase already gives service_role ALL,
--   so the GRANT is a no-op there; the postcondition therefore asserts only what must hold in EVERY environment.
--
-- ROLLBACK: rollbacks/provider_invoice_imports_one_per_period_rollback.sql (drops the index only; the privilege
--   statements restate the pre-existing posture and are not reverted).

-- Preflight 1: duplicates would make the unique index fail half-way - refuse with the offending keys instead.
DO $preflight_dups$
DECLARE
  v_groups int;
  v_sample text;
BEGIN
  SELECT count(*), string_agg(k, '; ')
    INTO v_groups, v_sample
    FROM (
      SELECT provider || ' ' || period_start::text || '..' || period_end::text || ' x' || count(*)::text AS k
        FROM public.provider_invoice_imports
       GROUP BY provider, period_start, period_end
      HAVING count(*) > 1
       LIMIT 20
    ) d;
  IF v_groups > 0 THEN
    RAISE EXCEPTION '040 preflight: % (provider, period) group(s) already hold more than one invoice - merge or archive them first (owner-approved D-step): %', v_groups, v_sample;
  END IF;
END
$preflight_dups$;

-- Preflight 2: an index of this name with a different shape was not created by this migration - refuse to adopt it.
-- (Compared field by field from the catalog: unique, valid, no predicate, no expressions, exactly these columns.)
DO $preflight_name$
DECLARE
  v_ok boolean;
BEGIN
  IF to_regclass('public.provider_invoice_imports_one_per_period_uidx') IS NOT NULL THEN
    SELECT i.indrelid = 'public.provider_invoice_imports'::regclass AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
           AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.ord)
               = ARRAY['provider', 'period_start', 'period_end']
      INTO v_ok
      FROM pg_index i WHERE i.indexrelid = to_regclass('public.provider_invoice_imports_one_per_period_uidx');
    IF NOT coalesce(v_ok, false) THEN
      RAISE EXCEPTION '040 preflight: provider_invoice_imports_one_per_period_uidx exists with another shape: %',
        pg_get_indexdef(to_regclass('public.provider_invoice_imports_one_per_period_uidx'));
    END IF;
  END IF;
END
$preflight_name$;

CREATE UNIQUE INDEX IF NOT EXISTS provider_invoice_imports_one_per_period_uidx
  ON public.provider_invoice_imports (provider, period_start, period_end);

-- Privilege posture, restated.
REVOKE ALL ON TABLE public.provider_invoice_imports FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.provider_invoice_imports TO service_role;

-- Postcondition: exactly what this migration promises, measured.
DO $verify$
DECLARE
  v_ok boolean;
  r text;
  p text;
BEGIN
  SELECT i.indrelid = 'public.provider_invoice_imports'::regclass AND i.indisunique AND i.indisvalid
         AND i.indpred IS NULL AND i.indexprs IS NULL
         AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.ord)
             = ARRAY['provider', 'period_start', 'period_end']
    INTO v_ok
    FROM pg_index i WHERE i.indexrelid = to_regclass('public.provider_invoice_imports_one_per_period_uidx');
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION '040 postcondition: unique index provider_invoice_imports_one_per_period_uidx missing, invalid or of another shape';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(r, 'public.provider_invoice_imports', p) THEN
        RAISE EXCEPTION '040 postcondition: % still holds % on provider_invoice_imports', r, p;
      END IF;
    END LOOP;
    -- has_table_privilege does NOT see column-level grants (e1): check those separately.
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege(r, 'public.provider_invoice_imports', p) THEN
        RAISE EXCEPTION '040 postcondition: % holds a column-level % on provider_invoice_imports', r, p;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
    IF NOT has_table_privilege('service_role', 'public.provider_invoice_imports', p) THEN
      RAISE EXCEPTION '040 postcondition: service_role lacks % on provider_invoice_imports', p;
    END IF;
  END LOOP;
END
$verify$;
