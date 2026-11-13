-- Rollback of 20270217000040_provider_invoice_imports_one_per_period.sql (6f).
-- Drops the exclusion constraint and the period CHECK. After this, overlapping cost invoices for one provider are
-- refused by the application alone (reconciliationPersist) - app-level and NOT atomic again (single-writer assumption).
-- idx_pii_period is untouched (040 keeps it). The privilege statements of 040 restate the posture that already existed
-- and are deliberately NOT reverted: revoking from service_role would break the reconcilers.
--
-- btree_gist (83 point 4): it is DROPPED only if nothing else depends on it. An object created after 040 may use its
-- operator classes; dropping it then would fail (or, with CASCADE, destroy that object) - so the rollback checks
-- pg_depend first and leaves the extension in place, saying so, when anything still depends on it.
ALTER TABLE public.provider_invoice_imports DROP CONSTRAINT IF EXISTS provider_invoice_imports_no_overlap;
ALTER TABLE public.provider_invoice_imports DROP CONSTRAINT IF EXISTS provider_invoice_imports_period_nonempty;

DO $drop_ext$
DECLARE
  v_ext oid;
  v_deps int;
BEGIN
  SELECT oid INTO v_ext FROM pg_extension WHERE extname = 'btree_gist';
  IF v_ext IS NOT NULL THEN
    -- objects that are NOT members of the extension but depend on one of its members (an opclass used by an index...)
    SELECT count(*) INTO v_deps
      FROM pg_depend d
      JOIN pg_depend m ON m.classid = d.refclassid AND m.objid = d.refobjid AND m.deptype = 'e' AND m.refobjid = v_ext
     WHERE NOT EXISTS (SELECT 1 FROM pg_depend o WHERE o.classid = d.classid AND o.objid = d.objid
                         AND o.deptype = 'e' AND o.refobjid = v_ext);
    IF v_deps = 0 THEN
      DROP EXTENSION btree_gist;
    ELSE
      RAISE NOTICE '040 rollback: btree_gist KEPT - % dependent object(s) still use it', v_deps;
    END IF;
  END IF;
END
$drop_ext$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.provider_invoice_imports'::regclass
              AND conname IN ('provider_invoice_imports_no_overlap', 'provider_invoice_imports_period_nonempty')) THEN
    RAISE EXCEPTION '040 rollback: a 040 constraint still exists on provider_invoice_imports';
  END IF;
  IF to_regclass('public.idx_pii_period') IS NULL THEN
    RAISE EXCEPTION '040 rollback: idx_pii_period is missing (040 never drops it)';
  END IF;
END
$verify$;
