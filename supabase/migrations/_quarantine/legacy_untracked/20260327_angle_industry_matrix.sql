-- Angle × Industry Matrix
-- Stores aggregated angle performance by industry, updated as blogs are generated
-- and analytics data accumulates. Pre-seeded with editorial research as a warm start.

CREATE TABLE IF NOT EXISTS angle_industry_matrix (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  industry    TEXT        NOT NULL,
  angle_type  TEXT        NOT NULL CHECK (angle_type IN ('analytical', 'contrarian', 'strategic')),

  -- Running aggregates (updated via upsert after each new data point)
  post_count  INTEGER     NOT NULL DEFAULT 0,
  score_sum   NUMERIC     NOT NULL DEFAULT 0,
  avg_score   NUMERIC     GENERATED ALWAYS AS (
                CASE WHEN post_count > 0 THEN ROUND(score_sum / post_count, 1) ELSE 0 END
              ) STORED,

  -- Qualitative signal from editorial research (warm-start prior)
  prior_rank  SMALLINT    NOT NULL DEFAULT 2
                CHECK (prior_rank BETWEEN 1 AND 3),   -- 1=best, 3=worst for this industry
  prior_note  TEXT,

  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (industry, angle_type)
);

CREATE INDEX IF NOT EXISTS aim_industry_idx ON angle_industry_matrix (industry);

-- ── Editorial seed data (warm-start priors from industry research) ─────────────
-- These are informed defaults. Real data will override them as scores accumulate.

INSERT INTO angle_industry_matrix (industry, angle_type, prior_rank, prior_note) VALUES
  -- SaaS: contrarian punches through noise; analytical resonates with technical buyers
  ('saas',         'contrarian', 1, 'Challenges conventional wisdom — cuts through SaaS content noise'),
  ('saas',         'analytical', 2, 'Data-driven arguments appeal to technical / product-led buyers'),
  ('saas',         'strategic',  3, 'Works but saturated — most SaaS content is already "strategic"'),

  -- Enterprise: strategic maps to executive decision-making; contrarian too risky
  ('enterprise',   'strategic',  1, 'Connects directly to business outcomes and board-level priorities'),
  ('enterprise',   'analytical', 2, 'Evidence-based arguments lower purchase risk for large deals'),
  ('enterprise',   'contrarian', 3, 'Can alienate conservative buyers — use sparingly'),

  -- FinTech: regulatory environment rewards analytical depth
  ('fintech',      'analytical', 1, 'Compliance and risk audiences demand evidence-backed claims'),
  ('fintech',      'strategic',  2, 'Business case framing resonates with CFO-level buyers'),
  ('fintech',      'contrarian', 3, 'Risky in regulated markets — requires careful positioning'),

  -- Marketing / AdTech: all three work; contrarian wins for thought leadership
  ('marketing',    'contrarian', 1, 'Marketing audience loves hot takes that challenge best practices'),
  ('marketing',    'strategic',  2, 'ROI-framing works well for budget-holding CMOs'),
  ('marketing',    'analytical', 3, 'Data works but feels generic — market is saturated'),

  -- HR / People Ops: human stories over data
  ('hr',           'strategic',  1, 'People-strategy framing aligns with CHRO priorities'),
  ('hr',           'contrarian', 2, 'Challenges like "performance reviews are broken" resonate widely'),
  ('hr',           'analytical', 3, 'Data alone feels cold for HR audiences'),

  -- Healthcare / MedTech
  ('healthcare',   'analytical', 1, 'Clinical evidence and outcome data are mandatory for credibility'),
  ('healthcare',   'strategic',  2, 'Operational efficiency framing works for admin buyers'),
  ('healthcare',   'contrarian', 3, 'Regulatory environment discourages provocative positioning'),

  -- E-commerce / Retail
  ('ecommerce',    'contrarian', 1, 'Practical myth-busting around conversion rates resonates strongly'),
  ('ecommerce',    'analytical', 2, 'A/B test results and benchmark data are highly shareable'),
  ('ecommerce',    'strategic',  3, 'Works for brand strategy, less for practitioner audience'),

  -- Cybersecurity
  ('cybersecurity','analytical', 1, 'Threat data and incident statistics are the currency of credibility'),
  ('cybersecurity','strategic',  2, 'Risk framing maps directly to CISO budget conversations'),
  ('cybersecurity','contrarian', 3, 'Contrarian security takes can backfire — trust is everything'),

  -- Education / EdTech
  ('edtech',       'strategic',  1, 'Outcome and impact framing speaks to institutional buyers'),
  ('edtech',       'contrarian', 2, 'Challenging traditional pedagogy generates strong engagement'),
  ('edtech',       'analytical', 3, 'Works for research audiences; too dry for practitioners')

ON CONFLICT (industry, angle_type) DO NOTHING;
