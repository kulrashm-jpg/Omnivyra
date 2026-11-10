
-- t_insert(table, overrides): insert one row, filling every NOT NULL column that has no
-- default with a type-appropriate dummy, so the test depends only on the columns it sets.
CREATE OR REPLACE FUNCTION pg_temp.t_insert(t regclass, o jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cols text := ''; vals text := ''; r record; v text;
BEGIN
  FOR r IN SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS ty, a.attnotnull, ad.adbin IS NOT NULL AS hasdef, t2.typtype, a.atttypid
             FROM pg_attribute a JOIN pg_type t2 ON t2.oid = a.atttypid
             LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
            WHERE a.attrelid = t AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' LOOP
    IF o ? r.attname THEN
      v := CASE WHEN jsonb_typeof(o -> r.attname) = 'null' THEN 'NULL'
                WHEN r.ty LIKE '%[]' THEN quote_literal((SELECT '{' || string_agg(x, ',') || '}' FROM jsonb_array_elements_text(o -> r.attname) x)) || '::' || r.ty
                ELSE quote_literal(o ->> r.attname) || '::' || r.ty END;
    ELSIF r.attnotnull AND NOT r.hasdef THEN
      v := CASE WHEN r.typtype = 'e' THEN quote_literal((SELECT enumlabel FROM pg_enum WHERE enumtypid = r.atttypid ORDER BY enumsortorder LIMIT 1)) || '::' || r.ty
                WHEN r.ty = 'uuid' THEN 'gen_random_uuid()'
                WHEN r.ty LIKE '%[]' THEN '''{}''::' || r.ty
                WHEN r.ty IN ('boolean') THEN 'false'
                WHEN r.ty IN ('integer','bigint','smallint','numeric','double precision','real') OR r.ty LIKE 'numeric%' THEN '0'
                WHEN r.ty LIKE 'timestamp%' OR r.ty = 'date' THEN 'now()'
                WHEN r.ty IN ('jsonb','json') THEN '''{}''::' || r.ty
                ELSE '''x''::' || r.ty END;
    ELSE CONTINUE;
    END IF;
    cols := cols || CASE WHEN cols = '' THEN '' ELSE ', ' END || quote_ident(r.attname);
    vals := vals || CASE WHEN vals = '' THEN '' ELSE ', ' END || v;
  END LOOP;
  EXECUTE format('INSERT INTO %s (%s) VALUES (%s)', t, cols, vals);
END $$;

-- expect_refused(table, overrides, constraint): the insert must fail on exactly that constraint.
CREATE OR REPLACE FUNCTION pg_temp.expect_refused(t regclass, o jsonb, con text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  BEGIN
    PERFORM pg_temp.t_insert(t, o);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    IF c IS DISTINCT FROM con THEN RAISE EXCEPTION 'FAIL %: refused by % not %', o, c, con; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL %: accepted, expected refusal by %', o, con;
END $$;

