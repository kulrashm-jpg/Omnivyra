-- ─────────────────────────────────────────────────────────────────────────────
-- Test Users for Activity Cost Tracking
-- ─────────────────────────────────────────────────────────────────────────────
-- Create minimal test users to support foreign key constraints in campaigns table
--

-- Test User 1 for Campaign 1
INSERT INTO users (
  id, email, created_at
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'campaign1@test.local',
  '2026-02-28 10:00:00+00'::timestamptz
) ON CONFLICT DO NOTHING;

-- Test User 2 for Campaign 2
INSERT INTO users (
  id, email, created_at
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'campaign2@test.local',
  '2026-03-05 14:00:00+00'::timestamptz
) ON CONFLICT DO NOTHING;
