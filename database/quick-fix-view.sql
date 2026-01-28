-- =====================================================
-- QUICK FIX FOR CAMPAIGN SUMMARY VIEW
-- =====================================================
-- Run this in Supabase SQL Editor to fix the error
-- =====================================================

-- Drop the existing view if it exists
DROP VIEW IF EXISTS campaign_summary;

-- Recreate the view with correct column reference
CREATE VIEW campaign_summary AS
SELECT 
    c.id,
    c.name,
    c.status,
    c.current_stage,
    c.timeframe,
    c.start_date,
    c.end_date,
    c.created_at,
    c.launched_at,
    COUNT(cg.id) as total_goals,
    COUNT(cp.id) as total_content_plans,
    COUNT(CASE WHEN cp.status = 'published' THEN 1 END) as published_content,
    COALESCE(SUM(cg.quantity), 0) as total_content_quantity
FROM campaigns c
LEFT JOIN campaign_goals cg ON c.id = cg.campaign_id
LEFT JOIN content_plans cp ON c.id = cp.campaign_id
GROUP BY c.id, c.name, c.status, c.current_stage, c.timeframe, c.start_date, c.end_date, c.created_at, c.launched_at;

-- Test the view
SELECT * FROM campaign_summary;
