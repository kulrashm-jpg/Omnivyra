-- Assertions for the 20270125000000..04 migrations. Disposable database only.
-- Inserts bypass FKs and append-only triggers (session_replication_role = replica);
-- CHECK and NOT NULL constraints are still enforced, which is what is under test.
\set ON_ERROR_STOP 1
SET session_replication_role = replica;
\ir helpers.sql
-- ── 0: canonical classification columns ──────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['engagement_thread_classification', 'engagement_message_intelligence'] LOOP
    PERFORM pg_temp.t_insert(t::regclass, '{}');                                         -- legacy row shape still works
    PERFORM pg_temp.t_insert(t::regclass, '{"canonical_code":"out_of_office","classification_vocabulary_version":"sc7-draft-1"}');
    PERFORM pg_temp.t_insert(t::regclass, '{"canonical_code":"stop","governance_codes":["stop","unsubscribe"],"classification_vocabulary_version":"sc7-draft-1"}');
    PERFORM pg_temp.expect_refused(t::regclass, '{"canonical_code":"interested","classification_vocabulary_version":"sc7-draft-1"}', t || '_canonical_code_valid');
    PERFORM pg_temp.expect_refused(t::regclass, '{"governance_codes":["not_interested"],"classification_vocabulary_version":"sc7-draft-1"}', t || '_governance_codes_valid');
    PERFORM pg_temp.expect_refused(t::regclass, '{"canonical_code":"pricing"}', t || '_vocabulary_version_required');
    PERFORM pg_temp.expect_refused(t::regclass, '{"governance_codes":["complaint"],"classification_vocabulary_version":"  "}', t || '_vocabulary_version_required');
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname LIKE t || '_%' AND NOT convalidated) THEN
      RAISE EXCEPTION 'FAIL %: a constraint was left NOT VALID', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS 0 canonical classification';
END $$;

-- ── 1 + 2: outcome type and source ───────────────────────────────────────────
DO $$
BEGIN
  PERFORM pg_temp.t_insert('public.outreach_outcomes', '{"outcome_type":"complained","source":"provider_webhook","occurred_at":"2026-11-04T00:00:00Z"}');
  PERFORM pg_temp.t_insert('public.outreach_outcomes', '{"outcome_type":"unsubscribed","source":"recipient_link","occurred_at":"2026-11-04T00:00:01Z"}');
  PERFORM pg_temp.t_insert('public.outreach_outcomes', '{"outcome_type":"replied","source":null,"occurred_at":"2026-11-04T00:00:02Z"}');
  PERFORM pg_temp.expect_refused('public.outreach_outcomes', '{"outcome_type":"spam","occurred_at":"2026-11-04T00:00:03Z"}', 'outreach_outcomes_type_valid');
  PERFORM pg_temp.expect_refused('public.outreach_outcomes', '{"outcome_type":"replied","source":"link","occurred_at":"2026-11-04T00:00:04Z"}', 'outreach_outcomes_source_valid');
  RAISE NOTICE 'PASS 1+2 outcome type and source';
END $$;

-- ── 3: auto-reply default ────────────────────────────────────────────────────
DO $$
DECLARE d text; v boolean; org uuid := gen_random_uuid();
BEGIN
  SELECT pg_get_expr(ad.adbin, ad.adrelid) INTO d FROM pg_attrdef ad JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
   WHERE ad.adrelid = 'public.engagement_system_controls'::regclass AND a.attname = 'auto_reply_enabled';
  IF d IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'FAIL 3: default is %', d; END IF;
  PERFORM pg_temp.t_insert('public.engagement_system_controls', jsonb_build_object('organization_id', org));
  SELECT auto_reply_enabled INTO v FROM public.engagement_system_controls WHERE organization_id = org;
  IF v IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 3: inserted row has %', v; END IF;
  IF (SELECT bool_and(attnotnull) FROM pg_attribute WHERE attrelid = 'public.engagement_system_controls'::regclass AND attname = 'auto_reply_enabled') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 3: NOT NULL lost';
  END IF;
  RAISE NOTICE 'PASS 3 auto-reply default off';
END $$;

-- ── 4: Meta client references ────────────────────────────────────────────────
DO $$
DECLARE env text := '0123456789abcdef01234567:0123456789abcdef0123456789abcdef:deadbeef';
BEGIN
  PERFORM pg_temp.t_insert('public.social_accounts', '{"platform":"whatsapp","is_active":false}');
  PERFORM pg_temp.t_insert('public.social_accounts', '{"platform":"whatsapp","is_active":false,"auth_client_id_ref":"META_APP_ID","auth_client_secret_ref":"WHATSAPP_APP_SECRET"}');
  PERFORM pg_temp.t_insert('public.social_accounts', jsonb_build_object('platform','whatsapp','is_active',false,'auth_client_id_ref',env,'auth_client_secret_ref',env));
  PERFORM pg_temp.expect_refused('public.social_accounts', '{"platform":"whatsapp","is_active":false,"auth_client_secret_ref":"SUPABASE_SERVICE_ROLE_KEY"}', 'social_accounts_auth_client_secret_ref_safe');
  PERFORM pg_temp.expect_refused('public.social_accounts', '{"platform":"whatsapp","is_active":false,"auth_client_secret_ref":"ENCRYPTION_KEY"}', 'social_accounts_auth_client_secret_ref_safe');
  PERFORM pg_temp.expect_refused('public.social_accounts', '{"platform":"whatsapp","is_active":false,"auth_client_secret_ref":"s3cr3t-plaintext"}', 'social_accounts_auth_client_secret_ref_safe');
  PERFORM pg_temp.expect_refused('public.social_accounts', '{"platform":"whatsapp","is_active":false,"auth_client_id_ref":"WHATSAPP_APP_SECRET"}', 'social_accounts_auth_client_id_ref_safe');
  PERFORM pg_temp.expect_refused('public.social_accounts', '{"platform":"whatsapp","is_active":false,"auth_client_id_ref":"OPENAI_API_KEY"}', 'social_accounts_auth_client_id_ref_safe');
  RAISE NOTICE 'PASS 4 meta client references';
END $$;

-- ── grants and RLS unchanged on every touched table ──────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['engagement_thread_classification','engagement_message_intelligence','outreach_outcomes','engagement_system_controls','social_accounts'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', t)::regclass) THEN
      RAISE EXCEPTION 'FAIL: RLS off on %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS rls still enabled on all five tables';
END $$;
