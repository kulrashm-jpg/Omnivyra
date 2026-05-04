-- =====================================================
-- WEEKLY CONTENT REFINEMENT & DAILY PLAN SYSTEM
-- =====================================================
-- Extends existing structure for weekly refinement and daily population

-- Add refinement tracking to content_plans
ALTER TABLE content_plans 
ADD COLUMN IF NOT EXISTS refinement_status VARCHAR(50) DEFAULT 'draft' CHECK (refinement_status IN ('draft', 'ai-enhanced', 'manually-edited', 'finalized', 'daily-populated')),
ADD COLUMN IF NOT EXISTS ai_suggestions JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS manual_edits JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS finalization_notes TEXT,
ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS daily_plan_generated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS daily_plan_generated_at TIMESTAMP WITH TIME ZONE;

-- Create weekly content refinement table
CREATE TABLE IF NOT EXISTS weekly_content_refinements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    theme VARCHAR(255) NOT NULL,
    focus_area TEXT NOT NULL,
    
    -- Refinement Data
    original_content JSONB NOT NULL,
    ai_enhanced_content JSONB DEFAULT '{}',
    manually_edited_content JSONB DEFAULT '{}',
    finalized_content JSONB NOT NULL,
    
    -- Status Tracking
    refinement_status VARCHAR(50) DEFAULT 'draft' CHECK (refinement_status IN ('draft', 'ai-enhanced', 'manually-edited', 'finalized', 'daily-populated')),
    ai_enhancement_applied BOOLEAN DEFAULT false,
    manual_edits_applied BOOLEAN DEFAULT false,
    finalized BOOLEAN DEFAULT false,
    daily_plan_populated BOOLEAN DEFAULT false,
    
    -- Metadata
    ai_enhancement_notes TEXT,
    manual_edit_notes TEXT,
    finalization_notes TEXT,
    enhanced_by UUID REFERENCES users(id),
    edited_by UUID REFERENCES users(id),
    finalized_by UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE (campaign_id, week_number)
);

-- Create daily content plans table (separate from content_plans for detailed daily planning)
CREATE TABLE IF NOT EXISTS daily_content_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    day_of_week VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    
    -- Content Details
    platform VARCHAR(100) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    title VARCHAR(500),
    content TEXT NOT NULL,
    hashtags TEXT[],
    mentions TEXT[],
    
    -- Media & Resources
    media_urls TEXT[],
    media_types VARCHAR(20)[],
    required_resources TEXT[],
    
    -- Scheduling
    scheduled_time TIME,
    timezone VARCHAR(50) DEFAULT 'UTC',
    posting_strategy TEXT,
    
    -- Status & Tracking
    status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'content-created', 'media-ready', 'scheduled', 'published', 'failed')),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    
    -- Source Tracking
    source_week_content_id UUID REFERENCES content_plans(id),
    source_refinement_id UUID REFERENCES weekly_content_refinements(id),
    ai_generated BOOLEAN DEFAULT false,
    
    -- Performance Tracking
    expected_engagement INTEGER DEFAULT 0,
    target_audience TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_campaign_week ON weekly_content_refinements(campaign_id, week_number);
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_status ON weekly_content_refinements(refinement_status);
CREATE INDEX IF NOT EXISTS idx_daily_plans_campaign_week ON daily_content_plans(campaign_id, week_number);
CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_content_plans(date);
CREATE INDEX IF NOT EXISTS idx_daily_plans_status ON daily_content_plans(status);

-- Function to enhance weekly content with AI
CREATE OR REPLACE FUNCTION enhance_weekly_content_with_ai(
    campaign_uuid UUID,
    week_num INTEGER,
    enhancement_prompt TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    week_content JSONB;
    enhanced_content JSONB;
    refinement_id UUID;
BEGIN
    -- Get current week content
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', id,
            'platform', platform,
            'content_type', content_type,
            'topic', topic,
            'content', content,
            'hashtags', hashtags,
            'day_of_week', day_of_week
        )
    ) INTO week_content
    FROM content_plans
    WHERE campaign_id = campaign_uuid AND week_number = week_num;
    
    -- Create or update refinement record
    INSERT INTO weekly_content_refinements (
        campaign_id,
        week_number,
        theme,
        focus_area,
        original_content,
        ai_enhanced_content,
        finalized_content,
        refinement_status,
        ai_enhancement_applied,
        ai_enhancement_notes,
        enhanced_by
    ) VALUES (
        campaign_uuid,
        week_num,
        (SELECT theme FROM content_plans WHERE campaign_id = campaign_uuid AND week_number = week_num LIMIT 1),
        (SELECT focus_area FROM content_plans WHERE campaign_id = campaign_uuid AND week_number = week_num LIMIT 1),
        week_content,
        '{}',
        week_content,
        'ai-enhanced',
        true,
        COALESCE(enhancement_prompt, 'AI enhancement applied'),
        (SELECT user_id FROM campaigns WHERE id = campaign_uuid)
    ) ON CONFLICT (campaign_id, week_number) 
    DO UPDATE SET
        ai_enhanced_content = EXCLUDED.ai_enhanced_content,
        refinement_status = 'ai-enhanced',
        ai_enhancement_applied = true,
        ai_enhancement_notes = EXCLUDED.ai_enhancement_notes,
        enhanced_by = EXCLUDED.enhanced_by,
        updated_at = NOW()
    RETURNING id INTO refinement_id;
    
    -- Update content_plans with AI enhancement status
    UPDATE content_plans 
    SET 
        refinement_status = 'ai-enhanced',
        ai_suggestions = jsonb_build_object(
            'enhancement_applied', true,
            'enhancement_notes', COALESCE(enhancement_prompt, 'AI enhancement applied'),
            'enhanced_at', NOW()
        ),
        updated_at = NOW()
    WHERE campaign_id = campaign_uuid AND week_number = week_num;
    
    RETURN jsonb_build_object(
        'refinement_id', refinement_id,
        'status', 'ai-enhanced',
        'message', 'Weekly content enhanced with AI suggestions'
    );
END;
$$ LANGUAGE plpgsql;

-- Function to finalize weekly content
CREATE OR REPLACE FUNCTION finalize_weekly_content(
    campaign_uuid UUID,
    week_num INTEGER,
    finalization_notes TEXT DEFAULT NULL,
    finalized_by_uuid UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    refinement_id UUID;
BEGIN
    -- Update refinement record
    UPDATE weekly_content_refinements 
    SET 
        refinement_status = 'finalized',
        finalized = true,
        finalization_notes = COALESCE(finalization_notes, 'Weekly content finalized'),
        finalized_by = COALESCE(finalized_by_uuid, (SELECT user_id FROM campaigns WHERE id = campaign_uuid)),
        finalized_at = NOW(),
        updated_at = NOW()
    WHERE campaign_id = campaign_uuid AND week_number = week_num
    RETURNING id INTO refinement_id;
    
    -- Update content_plans
    UPDATE content_plans 
    SET 
        refinement_status = 'finalized',
        finalization_notes = COALESCE(finalization_notes, 'Weekly content finalized'),
        finalized_at = NOW(),
        updated_at = NOW()
    WHERE campaign_id = campaign_uuid AND week_number = week_num;
    
    RETURN jsonb_build_object(
        'refinement_id', refinement_id,
        'status', 'finalized',
        'message', 'Weekly content finalized and ready for daily planning'
    );
END;
$$ LANGUAGE plpgsql;

-- Function to populate daily plans from finalized weekly content
CREATE OR REPLACE FUNCTION populate_daily_plans_from_weekly(
    campaign_uuid UUID,
    week_num INTEGER
)
RETURNS INTEGER AS $$
DECLARE
    week_content RECORD;
    daily_plan_id UUID;
    inserted_count INTEGER := 0;
    start_date DATE;
    day_offset INTEGER;
BEGIN
    -- Get campaign start date
    SELECT start_date INTO start_date FROM campaigns WHERE id = campaign_uuid;
    
    -- Calculate week start date
    start_date := start_date + INTERVAL '1 week' * (week_num - 1);
    
    -- Loop through weekly content and create daily plans
    FOR week_content IN 
        SELECT * FROM content_plans 
        WHERE campaign_id = campaign_uuid 
        AND week_number = week_num 
        AND refinement_status = 'finalized'
    LOOP
        -- Calculate day offset
        day_offset := CASE week_content.day_of_week
            WHEN 'Monday' THEN 0
            WHEN 'Tuesday' THEN 1
            WHEN 'Wednesday' THEN 2
            WHEN 'Thursday' THEN 3
            WHEN 'Friday' THEN 4
            WHEN 'Saturday' THEN 5
            WHEN 'Sunday' THEN 6
            ELSE 0
        END;
        
        -- Insert daily plan
        INSERT INTO daily_content_plans (
            campaign_id,
            week_number,
            day_of_week,
            date,
            platform,
            content_type,
            title,
            content,
            hashtags,
            scheduled_time,
            source_week_content_id,
            ai_generated,
            status,
            priority
        ) VALUES (
            campaign_uuid,
            week_num,
            week_content.day_of_week,
            start_date + INTERVAL '1 day' * day_offset,
            week_content.platform,
            week_content.content_type,
            week_content.topic,
            week_content.content,
            week_content.hashtags,
            '09:00', -- Default time
            week_content.id,
            week_content.ai_generated,
            'planned',
            'medium'
        ) RETURNING id INTO daily_plan_id;
        
        inserted_count := inserted_count + 1;
    END LOOP;
    
    -- Update refinement record
    UPDATE weekly_content_refinements 
    SET 
        refinement_status = 'daily-populated',
        daily_plan_populated = true,
        updated_at = NOW()
    WHERE campaign_id = campaign_uuid AND week_number = week_num;
    
    -- Update content_plans
    UPDATE content_plans 
    SET 
        refinement_status = 'daily-populated',
        daily_plan_generated = true,
        daily_plan_generated_at = NOW(),
        updated_at = NOW()
    WHERE campaign_id = campaign_uuid AND week_number = week_num;
    
    RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

-- Create view for weekly refinement status
CREATE OR REPLACE VIEW weekly_refinement_status AS
SELECT 
    c.id as campaign_id,
    c.name as campaign_name,
    wcr.week_number,
    wcr.theme,
    wcr.focus_area,
    wcr.refinement_status,
    wcr.ai_enhancement_applied,
    wcr.manual_edits_applied,
    wcr.finalized,
    wcr.daily_plan_populated,
    COUNT(cp.id) as total_content_items,
    COUNT(dcp.id) as daily_plans_generated,
    wcr.created_at,
    wcr.finalized_at
FROM campaigns c
LEFT JOIN weekly_content_refinements wcr ON c.id = wcr.campaign_id
LEFT JOIN content_plans cp ON c.id = cp.campaign_id AND cp.week_number = wcr.week_number
LEFT JOIN daily_content_plans dcp ON c.id = dcp.campaign_id AND dcp.week_number = wcr.week_number
GROUP BY c.id, c.name, wcr.week_number, wcr.theme, wcr.focus_area, wcr.refinement_status, 
         wcr.ai_enhancement_applied, wcr.manual_edits_applied, wcr.finalized, wcr.daily_plan_populated,
         wcr.created_at, wcr.finalized_at
ORDER BY wcr.week_number;

-- Success message
SELECT 'Weekly content refinement and daily plan system added successfully!' as message;
