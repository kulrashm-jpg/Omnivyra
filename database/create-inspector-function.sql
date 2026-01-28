-- =====================================================
-- CREATE HELPER FUNCTION FOR DB INSPECTOR
-- =====================================================
-- Run this in Supabase to create a function that returns all table names
-- =====================================================

-- Create function to get all table names
CREATE OR REPLACE FUNCTION get_all_tables()
RETURNS TABLE(table_name text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT table_name::text 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  ORDER BY table_name;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_all_tables() TO authenticated;

-- Test the function
SELECT 'Testing get_all_tables function:' as info;
SELECT * FROM get_all_tables() LIMIT 10;
