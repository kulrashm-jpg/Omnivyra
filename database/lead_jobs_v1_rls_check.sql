-- Run in Supabase SQL Editor to diagnose lead_jobs_v1 RLS and policies.
-- If relrowsecurity = true AND no policy allows UPDATE → update affects 0 rows with anon key.

-- 1. Check if RLS is enabled on lead_jobs_v1
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'lead_jobs_v1';

-- 2. List all policies on lead_jobs_v1
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'lead_jobs_v1'
ORDER BY policyname;
