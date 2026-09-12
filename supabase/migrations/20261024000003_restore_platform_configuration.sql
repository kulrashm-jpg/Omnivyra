-- ============================================================================
-- Forward reproducibility migration — B3 platform configuration DATA
--
-- Restores the reference rows of nine configuration tables that the canonical
-- production snapshot (supabase/_schema/baseline.sql) carries as SCHEMA ONLY.
-- Their seed statements live in 8-digit legacy migrations, which the
-- repository's replay rule (scripts/ci/real-schema-ci.sh:
-- `[ "${#ver}" -eq 14 ] || continue`) skips, so a fresh reconstruction
-- (baseline.sql + post-ledger replay) otherwise leaves these tables EMPTY.
--
-- Evidence chain: STEP 3AH-2 / 3AH-3 (production content audit, restoration
-- decisions), STEP 3AH-16 (row-by-row re-verification, SELECT-only, 2026-09-12):
-- all 35 rows of tables 1-7 are identical to their tracked sources in production
-- (0 value differences, 0 missing, 0 production-only), and the single production
-- row of tables 8 and 9 equals the tracked column DEFAULTs.
--
-- WHAT IS RESTORED (37 rows)
--   1 activity_class_economics   10   20260822_activity_economy_catalog
--   2 platform_rules              7   20260508_platform_rules_table
--   3 platform_rules_config       9   20260320_admin_config_tables
--   4 prediction_config           1   20260320_prediction_tables
--   5 tone_config                 3   20260320_admin_config_tables
--   6 curated_industry_sources    1   20260820_curated_industry_sources
--   7 creator_render_provider     4   20260669_creator_render_domain_substrate
--   8 decision_engine_config      1   20260320_admin_config_tables (DEFAULT VALUES)
--   9 content_validation_config   1   20260320_admin_config_tables (DEFAULT VALUES)
--
-- NOT COPIED FROM PRODUCTION
--   ids, created_at and updated_at take their column defaults
--   (gen_random_uuid() / now()), exactly as the source statements left them.
--   No secrets, credentials or environment-specific values; the only URL is
--   the public https://news.ycombinator.com (curated_industry_sources).
--
-- SAFETY
--   * INSERT only. No UPDATE, DELETE, TRUNCATE, DROP, ALTER, GRANT or DDL.
--   * Keyed tables use ON CONFLICT (<unique key>) DO NOTHING; the three
--     single-row tables without a natural key use WHERE NOT EXISTS. An existing
--     row is NEVER overwritten, so applying this to an already-configured
--     database (including production) changes nothing that exists.
--   * Safe to run twice: the second run inserts zero rows.
--   * Never run the legacy seed files against a configured database — some of
--     them use ON CONFLICT DO UPDATE (20260822) or have no conflict arbiter
--     (20260320_prediction_tables).
--   * None of these tables has an INSERT trigger or FORCE ROW LEVEL SECURITY.
-- ============================================================================


-- ─── 1. activity_class_economics (10) — values verbatim from 20260822 ────────
-- Source uses ON CONFLICT ... DO UPDATE; restored here as DO NOTHING (never overwrite).
INSERT INTO public.activity_class_economics
  (activity_class, entry_consumption_credits, minimum_credits, maximum_credits, abandonment_timeout_seconds)
VALUES
  ('REPLY',              1,  1,  3,   300),
  ('SHORT_GENERATION',   2,  3,  15,  600),
  ('LONG_GENERATION',    10, 10, 60,  1800),
  ('DEEP_RESEARCH',      15, 20, 90,  3600),
  ('INTELLIGENCE_SCAN',  2,  2,  30,  1800),
  ('AUTOMATION',         20, 40, 120, 7200),
  ('IMAGE_GENERATION',   2,  2,  12,  900),
  ('VIDEO_GENERATION',   10, 20, 150, 3600),
  ('VOICE',              2,  5,  60,  1800),
  ('SYSTEM',             0,  0,  0,   60)
ON CONFLICT (activity_class) DO NOTHING;


-- ─── 2. platform_rules (7) — values verbatim from 20260508_platform_rules_table ───
-- creator_dependent is not set by the source and is NULL in production; left NULL.
INSERT INTO public.platform_rules (platform, content_type, max_length, min_length, allowed_formats, frequency_per_week, best_days, best_times, required_fields, source)
VALUES
  ('linkedin',  'text',  3000, 50,  '["text"]'::jsonb,             3, '["Tuesday","Wednesday","Thursday"]'::jsonb, '["09:00"]'::jsonb, '["cta"]'::jsonb,                       'internal'),
  ('instagram', 'image', 2200, 50,  '["image","carousel"]'::jsonb, 4, '["Wednesday","Friday","Sunday"]'::jsonb,    '["19:00"]'::jsonb, '["hashtags"]'::jsonb,                   'internal'),
  ('x',         'text',  280,  10,  '["text"]'::jsonb,             5, '["Tuesday","Thursday"]'::jsonb,             '["12:00"]'::jsonb, '[]'::jsonb,                             'internal'),
  ('youtube',   'video', 5000, 30,  '["video"]'::jsonb,            2, '["Friday"]'::jsonb,                         '["18:00"]'::jsonb, '["cta"]'::jsonb,                        'internal'),
  ('blog',      'blog',  5000, 300, '["blog"]'::jsonb,             2, '["Tuesday"]'::jsonb,                        '["08:00"]'::jsonb, '["seo_title","seo_description"]'::jsonb, 'internal'),
  ('tiktok',    'video', 1500, 15,  '["video"]'::jsonb,            3, '["Thursday","Saturday"]'::jsonb,            '["20:00"]'::jsonb, '["hashtags"]'::jsonb,                   'internal'),
  ('podcast',   'audio', 3600, 60,  '["audio"]'::jsonb,            2, '["Monday"]'::jsonb,                         '["08:00"]'::jsonb, '["cta"]'::jsonb,                        'internal')
ON CONFLICT (platform, content_type) DO NOTHING;


-- ─── 3. platform_rules_config (9) — values verbatim from 20260320_admin_config_tables ───
INSERT INTO public.platform_rules_config (platform, content_type, rules) VALUES
  ('linkedin',  'post',      '{"max_sentences_per_paragraph":2,"prefer_sentence_per_line":false,"enforce_cta_at_end":true,"guidelines":["Strong opening hook line","Max 2 lines before spacing","Short paragraphs","CTA at end"]}'),
  ('instagram', 'post',      '{"max_sentences_per_paragraph":1,"prefer_sentence_per_line":false,"enforce_cta_at_end":true,"guidelines":["Hook in first 125 chars","Storytelling blocks","CTA near end"]}'),
  ('x',         'post',      '{"max_sentences_per_paragraph":1,"prefer_sentence_per_line":true,"enforce_cta_at_end":false,"guidelines":["Short punchy lines","Line breaks every thought"]}'),
  ('twitter',   'post',      '{"max_sentences_per_paragraph":1,"prefer_sentence_per_line":true,"enforce_cta_at_end":false,"guidelines":["Short punchy lines","Line breaks every thought"]}'),
  ('tiktok',    'post',      '{"max_sentences_per_paragraph":2,"prefer_sentence_per_line":true,"enforce_cta_at_end":true,"guidelines":["First 5 words must create curiosity","Pattern interrupt after hook","Direct low-friction CTA"]}'),
  ('facebook',  'post',      '{"max_sentences_per_paragraph":3,"prefer_sentence_per_line":false,"enforce_cta_at_end":true,"guidelines":["Warm friendly opening","Short conversational paragraphs","Engagement question at end"]}'),
  ('youtube',   'video',     '{"max_sentences_per_paragraph":2,"prefer_sentence_per_line":false,"enforce_cta_at_end":false,"guidelines":["Keyword-loaded first sentence","Structured description blocks","CTA in description"]}'),
  ('pinterest', 'image',     '{"max_sentences_per_paragraph":2,"prefer_sentence_per_line":false,"enforce_cta_at_end":false,"guidelines":["Lead with searchable keyword phrase","State outcome or benefit clearly"]}'),
  ('reddit',    'post',      '{"max_sentences_per_paragraph":3,"prefer_sentence_per_line":false,"enforce_cta_at_end":true,"guidelines":["Title specific and searchable","No corporate tone","Close with community question","No hashtags"]}')
ON CONFLICT (platform, content_type) DO NOTHING;


-- ─── 4. prediction_config (1) — values verbatim from 20260320_prediction_tables ───
-- Single-row table with no natural unique key. The source's bare ON CONFLICT
-- DO NOTHING has no arbiter (it would insert a duplicate row on every replay),
-- so the row is inserted only when the table is empty.
INSERT INTO public.prediction_config (
  min_confidence_threshold, min_engagement_threshold, max_optimization_rounds,
  weight_hook_strength, weight_platform_fit, weight_readability,
  weight_authority, weight_historical
)
SELECT 0.5, 0.02, 3, 0.25, 0.20, 0.15, 0.15, 0.25
WHERE NOT EXISTS (SELECT 1 FROM public.prediction_config);


-- ─── 5. tone_config (3) — values verbatim from 20260320_admin_config_tables ───
INSERT INTO public.tone_config (tone_name, rules) VALUES
  ('professional', '{"filler_words":["basically","literally","actually","just","very"],"sentence_style":"concise","punctuation":"formal"}'),
  ('conversational', '{"filler_words":["basically","literally"],"sentence_style":"casual","punctuation":"relaxed"}'),
  ('bold', '{"filler_words":["basically","literally","actually","just","very","somewhat","rather"],"sentence_style":"punchy","punctuation":"assertive"}')
ON CONFLICT (tone_name) DO NOTHING;


-- ─── 6. curated_industry_sources (1) — values verbatim from 20260820 ────────
INSERT INTO public.curated_industry_sources (
  source_name,
  source_type,
  source_identifier,
  source_url,
  platform,
  integration_mode,
  industry_tags,
  similar_industry_tags,
  opportunity_types,
  recommendation_reason,
  estimated_signal_quality,
  estimated_volume,
  is_active
) VALUES (
  'Hacker News',
  'hackernews',
  'hackernews:frontpage',
  'https://news.ycombinator.com',
  'hackernews',
  'public_login',
  ARRAY['technology', 'software', 'saas', 'developer tools', 'ai', 'startup'],
  ARRAY['fintech', 'cybersecurity', 'data infrastructure', 'cloud', 'b2b'],
  ARRAY['buying_intent', 'product_research', 'integration_need', 'competitor_dissatisfaction'],
  'Curated for technology and software companies because founders, engineers, and early adopters discuss product needs, tools, launches, and migration pain here.',
  0.72,
  180,
  TRUE
)
ON CONFLICT (source_type, source_identifier) DO NOTHING;


-- ─── 7. creator_render_provider (4) — values verbatim from 20260669 ─────────
-- Non-usable placeholders (health_state=maintenance, empty capability_matrix), as in production.
INSERT INTO public.creator_render_provider (provider_key, health_state)
VALUES ('openai','maintenance'),('runway','maintenance'),
       ('pika','maintenance'),('stability','maintenance')
ON CONFLICT (provider_key) DO NOTHING;


-- ─── 8. decision_engine_config (1) — 20260320_admin_config_tables (INSERT ... DEFAULT VALUES) ───
-- The source inserts DEFAULT VALUES. The literals are exactly that migration's column
-- DEFAULTs (identical in baseline.sql and in the production row, STEP 3AH-16), written
-- out so the restored row does not depend on future default changes. Inserted only
-- when the table is empty (no natural unique key).
INSERT INTO public.decision_engine_config
  (min_engagement_threshold, critical_drop_percent, ad_scale_threshold, ad_test_threshold, accuracy_good_threshold, pause_condition_days, at_risk_windows, critical_runs_for_pause)
SELECT 0.01, 0.40, 0.05, 0.02, 0.70, 2, 2, 2
WHERE NOT EXISTS (SELECT 1 FROM public.decision_engine_config);


-- ─── 9. content_validation_config (1) — 20260320_admin_config_tables (INSERT ... DEFAULT VALUES) ───
-- The source inserts DEFAULT VALUES. The literals are exactly that migration's column
-- DEFAULTs (identical in baseline.sql and in the production row, STEP 3AH-16), written
-- out so the restored row does not depend on future default changes. Inserted only
-- when the table is empty (no natural unique key).
INSERT INTO public.content_validation_config
  (hook_min_score, carousel_max_words, thread_min_count, thread_max_count, tweet_char_limit, hook_min_words, hook_max_words)
SELECT 0.30, 15, 5, 7, 280, 4, 20
WHERE NOT EXISTS (SELECT 1 FROM public.content_validation_config);
