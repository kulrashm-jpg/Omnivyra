-- =============================================================================
-- Backfill campaign_versions so existing campaigns show in Content Architect
-- (Multi-tenant: one backfill for all companies)
-- =============================================================================
-- Campaigns are listed per company only if they have a row in campaign_versions
-- with that company_id. This script links "orphan" campaigns (no version row)
-- to the correct company using the campaign creator (campaigns.user_id) and
-- user_company_roles. Safe for multiple companies.
--
-- BEFORE RUNNING:
-- Run the "Preview" block first to see which campaigns will be linked and to
-- which company. Then run the "Backfill" block.
--
-- Campaigns with no user_id, or whose user has no row in user_company_roles,
-- are skipped (no version row is created).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PREVIEW: Orphan campaigns and the company each will be linked to
-- -----------------------------------------------------------------------------
/*
SELECT c.id AS campaign_id,
       c.name,
       c.status,
       c.user_id,
       ucr.company_id::text AS will_link_to_company_id
  FROM campaigns c
  INNER JOIN LATERAL (
    SELECT company_id
      FROM user_company_roles ucr
      WHERE ucr.user_id = c.user_id
      ORDER BY CASE WHEN ucr.status = 'active' THEN 0 ELSE 1 END, ucr.company_id
      LIMIT 1
  ) ucr ON true
  WHERE NOT EXISTS (
    SELECT 1 FROM campaign_versions cv
    WHERE cv.campaign_id = c.id::text
  )
  ORDER BY ucr.company_id, c.created_at DESC;
*/

-- -----------------------------------------------------------------------------
-- BACKFILL: One campaign_version per orphan campaign, company from creator
-- -----------------------------------------------------------------------------
INSERT INTO campaign_versions (
  company_id,
  campaign_id,
  campaign_snapshot,
  status,
  version,
  created_at
)
SELECT
  ucr.company_id::text AS company_id,
  c.id::text AS campaign_id,
  jsonb_build_object(
    'campaign',
    jsonb_build_object(
      'id', c.id,
      'name', COALESCE(c.name, 'Campaign'),
      'description', c.description,
      'status', COALESCE(c.status, 'planning'),
      'current_stage', COALESCE(c.current_stage, 'planning'),
      'start_date', c.start_date,
      'end_date', c.end_date,
      'created_at', c.created_at,
      'updated_at', c.updated_at
    )
  ) AS campaign_snapshot,
  COALESCE(c.status, 'draft') AS status,
  1 AS version,
  COALESCE(c.created_at, now()) AS created_at
FROM campaigns c
INNER JOIN LATERAL (
  SELECT company_id
    FROM user_company_roles ucr
    WHERE ucr.user_id = c.user_id
    ORDER BY CASE WHEN ucr.status = 'active' THEN 0 ELSE 1 END, ucr.company_id
    LIMIT 1
) ucr ON true
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_versions cv
  WHERE cv.campaign_id = c.id::text
);
