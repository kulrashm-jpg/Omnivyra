-- ─────────────────────────────────────────────────────────────────────────────
-- Missing DB Objects — apply all pending migrations in one shot.
-- Safe to re-run: all statements use IF NOT EXISTS / CREATE OR REPLACE.
--
-- Run this in Supabase Dashboard → SQL Editor (as service role).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. angle_type column on blogs (20260326_blog_angle_type.sql) ──────────────

ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS angle_type TEXT
    CHECK (angle_type IN ('analytical', 'contrarian', 'strategic'));

CREATE INDEX IF NOT EXISTS blogs_angle_type_company_idx
  ON blogs (company_id, angle_type)
  WHERE angle_type IS NOT NULL;

-- ── 2. likes_count column on blogs (20260330_blogs_likes_count.sql) ───────────

ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS blogs_likes_count_company_idx
  ON blogs (company_id)
  WHERE likes_count > 0;

-- ── 3. Company Blog Intelligence tables (20260330_company_blog_intelligence.sql) ─

CREATE TABLE IF NOT EXISTS company_blog_series (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  slug        TEXT    NOT NULL,
  description TEXT,
  cover_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_company_blog_series_company
  ON company_blog_series(company_id);

CREATE TABLE IF NOT EXISTS company_blog_series_posts (
  series_id UUID    NOT NULL REFERENCES company_blog_series(id) ON DELETE CASCADE,
  blog_id   UUID    NOT NULL REFERENCES blogs(id)               ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (series_id, blog_id)
);

CREATE INDEX IF NOT EXISTS idx_company_blog_series_posts_series
  ON company_blog_series_posts(series_id, position);

CREATE INDEX IF NOT EXISTS idx_company_blog_series_posts_blog
  ON company_blog_series_posts(blog_id);

CREATE TABLE IF NOT EXISTS company_blog_relationships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_blog_id    UUID NOT NULL REFERENCES blogs(id)     ON DELETE CASCADE,
  target_blog_id    UUID NOT NULL REFERENCES blogs(id)     ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'related'
                    CHECK (relationship_type IN ('related', 'prerequisite', 'continuation')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_company_blog_rel_different CHECK (source_blog_id <> target_blog_id),
  UNIQUE (source_blog_id, target_blog_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_company_blog_rel_company
  ON company_blog_relationships(company_id);

CREATE INDEX IF NOT EXISTS idx_company_blog_rel_source
  ON company_blog_relationships(source_blog_id);

CREATE INDEX IF NOT EXISTS idx_company_blog_rel_target
  ON company_blog_relationships(target_blog_id);

ALTER TABLE company_blog_series           ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_blog_series_posts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_blog_relationships    ENABLE ROW LEVEL SECURITY;

-- ── 4. Company Blog Performance (20260330_company_blog_performance.sql) ───────

CREATE TABLE IF NOT EXISTS company_blog_read_sessions (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id      UUID    NOT NULL REFERENCES blogs(id)     ON DELETE CASCADE,
  company_id   UUID    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  session_key  TEXT    NOT NULL,
  time_seconds INTEGER NOT NULL DEFAULT 0,
  scroll_depth INTEGER NOT NULL DEFAULT 0,
  completed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_blog_sessions_key
  ON company_blog_read_sessions(session_key);

CREATE INDEX IF NOT EXISTS idx_company_blog_sessions_blog
  ON company_blog_read_sessions(blog_id);

CREATE INDEX IF NOT EXISTS idx_company_blog_sessions_company
  ON company_blog_read_sessions(company_id);

CREATE OR REPLACE VIEW company_blog_performance_summary AS
SELECT
  blog_id,
  company_id,
  COUNT(*)                                                       AS session_count,
  ROUND(AVG(time_seconds))                                       AS avg_time_seconds,
  ROUND(AVG(scroll_depth))                                       AS avg_scroll_depth,
  ROUND(AVG(CASE WHEN completed THEN 100.0 ELSE 0.0 END))       AS completion_rate,
  COUNT(*) FILTER (WHERE completed)                              AS completed_count,
  MAX(updated_at)                                                AS last_session_at
FROM company_blog_read_sessions
GROUP BY blog_id, company_id;

ALTER TABLE company_blog_read_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'company_blog_read_sessions' AND policyname = 'anyone can insert company blog session'
  ) THEN
    CREATE POLICY "anyone can insert company blog session"
      ON company_blog_read_sessions FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'company_blog_read_sessions' AND policyname = 'anyone can update company blog session'
  ) THEN
    CREATE POLICY "anyone can update company blog session"
      ON company_blog_read_sessions FOR UPDATE USING (true);
  END IF;
END $$;

-- ── 5. company_blog_comments table (no prior migration existed) ───────────────
--    Referenced by the Blog Intelligence endpoint for comment counts per post.

CREATE TABLE IF NOT EXISTS company_blog_comments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id    UUID        NOT NULL REFERENCES blogs(id)     ON DELETE CASCADE,
  company_id UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id  UUID        REFERENCES users(id)              ON DELETE SET NULL,
  body       TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_blog_comments_blog
  ON company_blog_comments(blog_id);

CREATE INDEX IF NOT EXISTS idx_company_blog_comments_company
  ON company_blog_comments(company_id);

ALTER TABLE company_blog_comments ENABLE ROW LEVEL SECURITY;

-- ── 6. report_automation_configs (20260505_report_automation_notifications.sql) ─
--    NOTE: this migration references public.users(id) — ensure users table exists first.

CREATE TABLE IF NOT EXISTS public.report_automation_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  change_detection_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_triggered_report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  last_change_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_automation_configs_user_company_domain_unique
    UNIQUE (user_id, company_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_report_automation_configs_company_active
  ON public.report_automation_configs(company_id, is_active, next_run_at ASC);

CREATE INDEX IF NOT EXISTS idx_report_automation_configs_user_active
  ON public.report_automation_configs(user_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS public.report_automation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_config_id UUID REFERENCES public.report_automation_configs(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('scheduled', 'content_change', 'traffic_change')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_automation_events_company_triggered
  ON public.report_automation_events(company_id, triggered_at DESC);

-- ── 7. Ensure user_preferences FK is satisfied ────────────────────────────────
--    user_preferences.user_id FK → users(id)
--    If a Supabase Auth user logs in before being inserted into users, the upsert fails.
--    This inserts the missing user row if it doesn't already exist.
--
--    NOTE: Replace the INSERT below with a trigger or use the post-login hook instead
--    for a permanent fix. This one-time backfill handles the current dev user.
--
-- INSERT INTO public.users (id, email, created_at, updated_at)
-- SELECT au.id, au.email, au.created_at, now()
-- FROM auth.users au
-- LEFT JOIN public.users u ON u.id = au.id
-- WHERE u.id IS NULL;

COMMIT;
