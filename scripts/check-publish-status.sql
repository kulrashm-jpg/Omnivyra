-- SCRIPT_CLASSIFICATION: OPERATOR
-- MUTATION_LEVEL: READ_ONLY
-- SAFE_FOR_CI: NO
-- SAFE_FOR_PRODUCTION: CAUTION
-- REQUIRES_EXPLICIT_OPERATOR_INTENT: YES

-- Check Publish Status Script
-- Operator-only diagnostic query. Not schema authority.

-- 1. Check scheduled posts status
SELECT 
  id,
  platform,
  content,
  status,
  platform_post_id,
  post_url,
  scheduled_for,
  published_at,
  error_message
FROM scheduled_posts
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC
LIMIT 10;

-- 2. Check queue jobs status
SELECT 
  id,
  scheduled_post_id,
  job_type,
  status,
  attempts,
  error_message,
  error_code,
  scheduled_for,
  created_at,
  updated_at
FROM queue_jobs
WHERE scheduled_post_id IN (
  SELECT id FROM scheduled_posts 
  WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
)
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check queue job logs
SELECT 
  id,
  job_id,
  log_level,
  message,
  metadata,
  created_at
FROM queue_job_logs
WHERE job_id IN (
  SELECT id FROM queue_jobs
  WHERE scheduled_post_id IN (
    SELECT id FROM scheduled_posts 
    WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
  )
)
ORDER BY created_at DESC
LIMIT 20;

-- 4. Count by status
SELECT 
  status,
  COUNT(*) as count
FROM scheduled_posts
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
GROUP BY status;

