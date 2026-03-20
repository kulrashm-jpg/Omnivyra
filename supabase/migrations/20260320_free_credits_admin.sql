-- ─────────────────────────────────────────────────────────────────────────────
-- Free Credits Admin Tables
-- Extends the free credits system with manual grant tracking + reporting views.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. manual_credit_grants — super admin manually giving credits to any user/org
CREATE TABLE IF NOT EXISTS manual_credit_grants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  user_id         uuid,                          -- target user (optional, informational)
  granted_by      uuid        NOT NULL,          -- super admin who granted
  credits_amount  int         NOT NULL CHECK (credits_amount > 0),
  reason          text        NOT NULL,
  category        text        NOT NULL DEFAULT 'manual'
    CHECK (category IN ('manual','recommendation','first_campaign','referral','feedback','setup','connect_social','invite_friend','promotion','compensation')),
  reference_id    text,                          -- e.g. campaign_id, request_id
  note            text,                          -- internal note
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_credit_grants_org_idx ON manual_credit_grants(organization_id);
CREATE INDEX IF NOT EXISTS manual_credit_grants_created_idx ON manual_credit_grants(created_at DESC);

ALTER TABLE manual_credit_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON manual_credit_grants FOR ALL USING (auth.role() = 'service_role');

-- 2. Patch access_requests to match service code expectations (idempotent)
ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS job_title            text,
  ADD COLUMN IF NOT EXISTS website_url          text,
  ADD COLUMN IF NOT EXISTS domain_status        text,
  ADD COLUMN IF NOT EXISTS organization_id      uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS admin_note           text,
  ADD COLUMN IF NOT EXISTS rejection_reason     text,
  ADD COLUMN IF NOT EXISTS credits_granted_amount int;

-- 3. Patch domain_eligibility_cache
ALTER TABLE domain_eligibility_cache
  ADD COLUMN IF NOT EXISTS checked_at timestamptz NOT NULL DEFAULT now();

-- 4. Patch domain_whitelist
ALTER TABLE domain_whitelist
  ADD COLUMN IF NOT EXISTS added_by uuid,
  ADD COLUMN IF NOT EXISTS reason   text;

-- 5. Patch user_override
ALTER TABLE user_override
  ADD COLUMN IF NOT EXISTS is_eligible boolean NOT NULL DEFAULT true;

-- ── Reporting view: all free credit activity across the platform ───────────────

CREATE OR REPLACE VIEW free_credits_activity AS
SELECT
  'claim'                  AS source,
  fc.id,
  fc.user_id,
  fc.organization_id,
  u.email,
  fc.category,
  fc.credits_granted       AS credits_amount,
  NULL::text               AS reason,
  NULL::text               AS granted_by_email,
  fc.claimed_at            AS created_at
FROM free_credit_claims fc
LEFT JOIN auth.users u ON u.id = fc.user_id

UNION ALL

SELECT
  'manual'                 AS source,
  mg.id,
  mg.user_id,
  mg.organization_id,
  u.email,
  mg.category,
  mg.credits_amount,
  mg.reason,
  ga.email                 AS granted_by_email,
  mg.created_at
FROM manual_credit_grants mg
LEFT JOIN auth.users u  ON u.id  = mg.user_id
LEFT JOIN auth.users ga ON ga.id = mg.granted_by

UNION ALL

SELECT
  'access_request'         AS source,
  ar.id,
  ar.user_id,
  ar.organization_id,
  ar.email,
  'domain_approval'        AS category,
  COALESCE(ar.credits_granted_amount, 0) AS credits_amount,
  ar.admin_note            AS reason,
  NULL::text               AS granted_by_email,
  ar.reviewed_at           AS created_at
FROM access_requests ar
WHERE ar.status = 'approved'
  AND COALESCE(ar.credits_granted_amount, 0) > 0;

-- ── Fix legacy 'ADMIN' role rows → 'COMPANY_ADMIN' ──────────────────────────
-- Rows created by setup-company.ts before this patch used role='ADMIN'.
-- 'ADMIN' is not a valid RBAC role — normalise to 'COMPANY_ADMIN'.
UPDATE user_company_roles
SET role = 'COMPANY_ADMIN'
WHERE role = 'ADMIN';

-- Safety: no regular user should have SUPER_ADMIN via the free-credit/onboarding path.
-- Super admin rows are only created manually by the platform team.
-- (This does NOT touch rows created by the platform team intentionally.)

-- ── Summary stats function ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION free_credits_summary()
RETURNS TABLE (
  total_credits_given     bigint,
  total_recipients        bigint,
  pending_requests        bigint,
  approved_this_month     bigint,
  manual_grants_total     bigint,
  claims_total            bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    (SELECT COALESCE(SUM(credits_granted),0) FROM free_credit_claims)
      + (SELECT COALESCE(SUM(credits_amount),0) FROM manual_credit_grants)
      + (SELECT COALESCE(SUM(COALESCE(credits_granted_amount,0)),0) FROM access_requests WHERE status='approved')
    AS total_credits_given,

    (SELECT COUNT(DISTINCT user_id) FROM free_credit_profiles)
    AS total_recipients,

    (SELECT COUNT(*) FROM access_requests WHERE status='pending')
    AS pending_requests,

    (SELECT COUNT(*) FROM access_requests
     WHERE status='approved' AND reviewed_at >= date_trunc('month', now()))
    AS approved_this_month,

    (SELECT COUNT(*) FROM manual_credit_grants)
    AS manual_grants_total,

    (SELECT COUNT(*) FROM free_credit_claims)
    AS claims_total;
$$;
