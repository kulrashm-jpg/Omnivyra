-- Rollback for 20270111000002_tenant_tables_client_privileges_revoked.sql.
--
-- Restores production's pre-change CLIENT ACL on the 50 tables exactly as
-- captured read-only on 2026-10-31T04:08Z (evidence/prod-relations.json):
--   group 1 (33 tables)  anon=arwdxtm, authenticated=arwdxtm
--   group 2 ( 5 tables)  authenticated=arwdxtm (anon none)
--   group 3 ( 4 tables)  anon=rm, authenticated=rm
--   group 4 ( 8 tables)  no client privilege (the forward migration changed nothing)
-- (TRUNCATE stays revoked from the client roles, as 20261026000000 left it.)
-- service_role/postgres entries and policies were not changed by the forward
-- migration, so nothing else is restored.
--
-- This RE-OPENS the latent exposure documented in the forward migration
-- (including blog_comments.author_email to anon). Use it only to restore
-- service, and only if a client-role path the audit did not find depends on
-- these grants.

BEGIN;

-- grant-ok: rollback restores the exact pre-SEC-A production ACL (group 1)
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.action_registry, public.campaigns, public.canonical_domains, public.canonical_page_views,
  public.canonical_pages, public.canonical_revenue_events, public.canonical_sessions,
  public.data_source_status, public.decision_events, public.decision_objects,
  public.extension_commands, public.extension_events, public.extension_sessions,
  public.canonical_media_assets, public.company_topic_coverage, public.composition_asset_references,
  public.creator_asset_attachments, public.creator_assets, public.feature_completion, public.reports,
  public.access_requests, public.free_credit_claims, public.free_credit_events,
  public.free_credit_profiles, public.free_credit_unlocks, public.notifications,
  public.user_override, public.user_preferences,
  public.companies, public.users, public.user_company_roles,
  public.blog_comments, public.public_blogs
  TO anon, authenticated;

-- grant-ok: rollback restores the exact pre-SEC-A production ACL (group 2)
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.content_approval_history, public.content_block, public.content_quality,
  public.content_recommendation, public.creator_composition_briefs
  TO authenticated;

-- grant-ok: rollback restores the exact pre-SEC-A production ACL (group 3)
GRANT SELECT, MAINTAIN ON TABLE
  public.blog_relationships, public.blog_series, public.blog_series_posts, public.content_type
  TO anon, authenticated;

DO $rollback$
DECLARE
  spec record;
  p text;
  want text[];
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('g1', 'anon',          ARRAY['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER','MAINTAIN']),
      ('g1', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER','MAINTAIN']),
      ('g2', 'anon',          ARRAY[]::text[]),
      ('g2', 'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER','MAINTAIN']),
      ('g3', 'anon',          ARRAY['SELECT','MAINTAIN']),
      ('g3', 'authenticated', ARRAY['SELECT','MAINTAIN']),
      ('g4', 'anon',          ARRAY[]::text[]),
      ('g4', 'authenticated', ARRAY[]::text[])) v(grp, role, privs)
  LOOP
    FOR p IN SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) LOOP
      DECLARE
        t text;
        tables text[] := CASE spec.grp
          WHEN 'g1' THEN ARRAY['action_registry','campaigns','canonical_domains','canonical_page_views','canonical_pages',
            'canonical_revenue_events','canonical_sessions','data_source_status','decision_events','decision_objects',
            'extension_commands','extension_events','extension_sessions','canonical_media_assets','company_topic_coverage',
            'composition_asset_references','creator_asset_attachments','creator_assets','feature_completion','reports',
            'access_requests','free_credit_claims','free_credit_events','free_credit_profiles','free_credit_unlocks',
            'notifications','user_override','user_preferences','companies','users','user_company_roles',
            'blog_comments','public_blogs']
          WHEN 'g2' THEN ARRAY['content_approval_history','content_block','content_quality','content_recommendation',
            'creator_composition_briefs']
          WHEN 'g3' THEN ARRAY['blog_relationships','blog_series','blog_series_posts','content_type']
          ELSE ARRAY['brand_memory','content','content_asset','content_memory','content_originality','content_revision',
            'content_variant','publication_lineage'] END;
      BEGIN
        FOREACH t IN ARRAY tables LOOP
          IF has_table_privilege(spec.role, ('public.' || quote_ident(t))::regclass, p) IS DISTINCT FROM (p = ANY (spec.privs)) THEN
            RAISE EXCEPTION 'SEC-A rollback: % % on public.% is %, production had %',
              spec.role, p, t, has_table_privilege(spec.role, ('public.' || quote_ident(t))::regclass, p), (p = ANY (spec.privs));
          END IF;
        END LOOP;
      END;
    END LOOP;
  END LOOP;
END
$rollback$;

COMMIT;
