-- =====================================================
-- WEEKLY ALIGNMENT SYSTEM (Works with Existing Tables)
-- =====================================================
-- Extends your existing database structure for weekly alignment
-- Uses: campaigns, content_plans, campaign_performance, ai_threads

-- Add weekly tracking columns to existing content_plans table
ALTER TABLE content_plans 
ADD COLUMN IF NOT EXISTS week_number INTEGER,
ADD COLUMN IF NOT EXISTS theme VARCHAR(255),
ADD COLUMN IF NOT EXISTS focus_area TEXT,
ADD COLUMN IF NOT EXISTS alignment_status VARCHAR(50) DEFAULT 'pending' CHECK (alignment_status IN ('pending', 'in-review', 'aligned', 'needs-adjustment', 'completed')),
ADD COLUMN IF NOT EXISTS alignment_notes TEXT,
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE;

-- Add weekly tracking to existing campaign_performance table
ALTER TABLE campaign_performance
ADD COLUMN IF NOT EXISTS week_number INTEGER,
ADD COLUMN IF NOT EXISTS theme VARCHAR(255),
ADD COLUMN IF NOT EXISTS content_types TEXT[],
ADD COLUMN IF NOT EXISTS platforms TEXT[],
ADD COLUMN IF NOT EXISTS objectives TEXT[],
ADD COLUMN IF NOT EXISTS planned_content_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS created_content_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS scheduled_content_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS published_content_count INTEGER DEFAULT 0;

-- Extend existing ai_threads table for 12-week plan review
ALTER TABLE ai_threads
ADD COLUMN IF NOT EXISTS plan_review_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS weekly_themes JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'pending' CHECK (review_status IN ('pending', 'in-review', 'approved', 'needs-revision', 'rejected'));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_content_plans_week_number ON content_plans(week_number);
CREATE INDEX IF NOT EXISTS idx_content_plans_alignment_status ON content_plans(alignment_status);
CREATE INDEX IF NOT EXISTS idx_campaign_performance_week_number ON campaign_performance(week_number);

-- Create view for weekly alignment summary
CREATE OR REPLACE VIEW weekly_alignment_summary AS
SELECT 
    c.id as campaign_id,
    c.name as campaign_name,
    cp.week_number,
    cp.theme,
    cp.focus_area,
    cp.alignment_status,
    COUNT(cp.id) as total_content_items,
    COUNT(CASE WHEN cp.status = 'published' THEN 1 END) as published_content,
    COUNT(CASE WHEN cp.alignment_status = 'aligned' THEN 1 END) as aligned_content,
    COUNT(CASE WHEN cp.alignment_status = 'needs-adjustment' THEN 1 END) as needs_adjustment_content,
    array_agg(DISTINCT cp.platform) as platforms,
    array_agg(DISTINCT cp.content_type) as content_types
FROM campaigns c
LEFT JOIN content_plans cp ON c.id = cp.campaign_id
WHERE cp.week_number IS NOT NULL
GROUP BY c.id, c.name, cp.week_number, cp.theme, cp.focus_area, cp.alignment_status
ORDER BY cp.week_number;

-- Function to update weekly alignment status
CREATE OR REPLACE FUNCTION update_weekly_alignment(
    campaign_uuid UUID,
    week_num INTEGER,
    new_status VARCHAR(50),
    notes TEXT DEFAULT NULL,
    reviewer_uuid UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Update content plans for the week
    UPDATE content_plans 
    SET 
        alignment_status = new_status,
        alignment_notes = COALESCE(notes, alignment_notes),
        reviewed_by = COALESCE(reviewer_uuid, reviewed_by),
        reviewed_at = CASE WHEN new_status IN ('aligned', 'completed') THEN NOW() ELSE reviewed_at END,
        updated_at = NOW()
    WHERE campaign_id = campaign_uuid AND week_number = week_num;
    
    -- Update campaign performance tracking
    INSERT INTO campaign_performance (
        campaign_id,
        performance_date,
        week_number,
        updated_at
    ) VALUES (
        campaign_uuid,
        CURRENT_DATE,
        week_num,
        NOW()
    ) ON CONFLICT (campaign_id, performance_date) 
    DO UPDATE SET 
        week_number = week_num,
        updated_at = NOW();
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to get 12-week plan overview
CREATE OR REPLACE FUNCTION get_12_week_plan_overview(campaign_uuid UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'campaign_id', c.id,
        'campaign_name', c.name,
        'start_date', c.start_date,
        'end_date', c.end_date,
        'weeks', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'week_number', cp.week_number,
                    'theme', cp.theme,
                    'focus_area', cp.focus_area,
                    'alignment_status', cp.alignment_status,
                    'content_count', COUNT(cp.id),
                    'published_count', COUNT(CASE WHEN cp.status = 'published' THEN 1 END),
                    'platforms', array_agg(DISTINCT cp.platform),
                    'content_types', array_agg(DISTINCT cp.content_type)
                )
            )
            FROM content_plans cp
            WHERE cp.campaign_id = campaign_uuid AND cp.week_number IS NOT NULL
            GROUP BY cp.week_number, cp.theme, cp.focus_area, cp.alignment_status
            ORDER BY cp.week_number
        )
    ) INTO result
    FROM campaigns c
    WHERE c.id = campaign_uuid;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Function to populate weekly content from AI plan
CREATE OR REPLACE FUNCTION populate_weekly_content_from_ai_plan(
    campaign_uuid UUID,
    ai_plan_data JSONB
)
RETURNS INTEGER AS $$
DECLARE
    week_data JSONB;
    content_item JSONB;
    inserted_count INTEGER := 0;
    week_num INTEGER;
    start_date DATE;
BEGIN
    -- Get campaign start date
    SELECT start_date INTO start_date FROM campaigns WHERE id = campaign_uuid;
    
    -- Loop through weeks in AI plan
    FOR week_data IN SELECT * FROM jsonb_array_elements(ai_plan_data->'weeks')
    LOOP
        week_num := (week_data->>'week_number')::INTEGER;
        
        -- Insert content items for this week
        FOR content_item IN SELECT * FROM jsonb_array_elements(week_data->'content')
        LOOP
            INSERT INTO content_plans (
                campaign_id,
                week_number,
                theme,
                focus_area,
                platform,
                content_type,
                topic,
                content,
                status,
                ai_generated,
                alignment_status,
                day_of_week,
                date,
                created_at,
                updated_at
            ) VALUES (
                campaign_uuid,
                week_num,
                week_data->>'theme',
                week_data->>'focus_area',
                content_item->>'platform',
                content_item->>'type',
                content_item->>'topic',
                content_item->>'description',
                'planned',
                true,
                'pending',
                content_item->>'day',
                start_date + INTERVAL '1 week' * (week_num - 1) + INTERVAL '1 day' * (
                    CASE content_item->>'day'
                        WHEN 'Monday' THEN 0
                        WHEN 'Tuesday' THEN 1
                        WHEN 'Wednesday' THEN 2
                        WHEN 'Thursday' THEN 3
                        WHEN 'Friday' THEN 4
                        WHEN 'Saturday' THEN 5
                        WHEN 'Sunday' THEN 6
                        ELSE 0
                    END
                ),
                NOW(),
                NOW()
            );
            
            inserted_count := inserted_count + 1;
        END LOOP;
    END LOOP;
    
    RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

-- Success message
SELECT 'Weekly alignment system added successfully! Uses existing tables with minimal additions.' as message;
