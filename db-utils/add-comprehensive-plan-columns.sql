-- Add missing columns to weekly_content_refinements table for comprehensive plan editor
-- Run this in Supabase SQL Editor

-- Add marketing_channels column (array of platforms)
ALTER TABLE weekly_content_refinements 
ADD COLUMN IF NOT EXISTS marketing_channels TEXT[];

-- Add existing_content column (text for existing content that needs to be adjusted)
ALTER TABLE weekly_content_refinements 
ADD COLUMN IF NOT EXISTS existing_content TEXT;

-- Add content_notes column (notes about existing content)
ALTER TABLE weekly_content_refinements 
ADD COLUMN IF NOT EXISTS content_notes TEXT;

-- Add key_messages and success_metrics to campaigns table if they don't exist
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS key_messages TEXT[];

ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS success_metrics TEXT[];

-- Success message
SELECT 'Columns added successfully to support comprehensive plan editor!' as message;


