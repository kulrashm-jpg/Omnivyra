-- =====================================================
-- WEEKLY ALIGNMENT EXTENSION (Minimal - No Duplication)
-- =====================================================
-- Extends existing campaign management with weekly alignment tracking
-- Uses existing tables: campaigns, content_plans, notifications, ai_threads

-- Add weekly alignment tracking to existing content_plans table
ALTER TABLE content_plans 
ADD COLUMN week_number INTEGER,
ADD COLUMN theme VARCHAR(255),
ADD COLUMN focus_area TEXT,
ADD COLUMN alignment_status VARCHAR(50) DEFAULT 'pending' CHECK (alignment_status IN ('pending', 'in-review', 'aligned', 'needs-adjustment', 'completed')),
ADD COLUMN alignment_notes TEXT,
ADD COLUMN reviewed_by UUID REFERENCES users(id),
ADD COLUMN reviewed_at TIMESTAMP WITH TIME ZONE;

-- Add weekly performance tracking to existing campaign_performance table
ALTER TABLE campaign_performance
ADD COLUMN week_number INTEGER,
ADD COLUMN theme VARCHAR(255),
ADD COLUMN content_types TEXT[],
ADD COLUMN platforms TEXT[],
ADD COLUMN objectives TEXT[],
ADD COLUMN planned_content_count INTEGER DEFAULT 0,
ADD COLUMN created_content_count INTEGER DEFAULT 0,
ADD COLUMN scheduled_content_count INTEGER DEFAULT 0,
ADD COLUMN published_content_count INTEGER DEFAULT 0;

-- Extend existing notifications table for weekly alignment
ALTER TABLE notifications
ADD COLUMN week_number INTEGER,
ADD COLUMN alignment_type VARCHAR(50) CHECK (alignment_type IN ('alignment_reminder', 'content_review', 'performance_check', 'plan_adjustment')),
ADD COLUMN action_required BOOLEAN DEFAULT true,
ADD COLUMN action_type VARCHAR(50),
ADD COLUMN action_deadline TIMESTAMP WITH TIME ZONE;

-- Add 12-week plan review to existing ai_threads table
ALTER TABLE ai_threads
ADD COLUMN plan_review_data JSONB DEFAULT '{}',
ADD COLUMN weekly_themes JSONB DEFAULT '[]',
ADD COLUMN review_status VARCHAR(50) DEFAULT 'pending' CHECK (review_status IN ('pending', 'in-review', 'approved', 'needs-revision', 'rejected'));

-- Create indexes for performance
CREATE INDEX idx_content_plans_week_number ON content_plans(week_number);
CREATE INDEX idx_content_plans_alignment_status ON content_plans(alignment_status);
CREATE INDEX idx_campaign_performance_week_number ON campaign_performance(week_number);
CREATE INDEX idx_notifications_week_number ON notifications(week_number);
CREATE INDEX idx_notifications_alignment_type ON notifications(alignment_type);

-- Create view for weekly alignment summary
CREATE VIEW weekly_alignment_summary AS
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
    COUNT(CASE WHEN cp.alignment_status = 'needs-adjustment' THEN 1 END) as needs_adjustment_content
FROM campaigns c
LEFT JOIN content_plans cp ON c.id = cp.campaign_id
WHERE cp.week_number IS NOT NULL
GROUP BY c.id, c.name, cp.week_number, cp.theme, cp.focus_area, cp.alignment_status;

-- Create function to generate weekly alignment notifications
CREATE OR REPLACE FUNCTION generate_weekly_alignment_notification(
    campaign_uuid UUID,
    week_num INTEGER,
    notification_type VARCHAR(50) DEFAULT 'alignment_reminder'
)
RETURNS UUID AS $$
DECLARE
    notification_id UUID;
    campaign_name VARCHAR(255);
    week_theme VARCHAR(255);
    week_focus TEXT;
BEGIN
    -- Get campaign and week details
    SELECT c.name, cp.theme, cp.focus_area
    INTO campaign_name, week_theme, week_focus
    FROM campaigns c
    LEFT JOIN content_plans cp ON c.id = cp.campaign_id
    WHERE c.id = campaign_uuid AND cp.week_number = week_num
    LIMIT 1;
    
    -- Create notification
    INSERT INTO notifications (
        user_id,
        type,
        title,
        message,
        week_number,
        alignment_type,
        action_required,
        action_type,
        action_deadline,
        data
    ) VALUES (
        (SELECT user_id FROM campaigns WHERE id = campaign_uuid),
        'weekly_alignment',
        'Week ' || week_num || ' Alignment Required',
        'Please review and align content for Week ' || week_num || ': ' || COALESCE(week_theme, 'Theme TBD') || ' - ' || COALESCE(week_focus, 'Focus TBD'),
        week_num,
        notification_type,
        true,
        'review_content',
        NOW() + INTERVAL '3 days',
        jsonb_build_object(
            'campaign_id', campaign_uuid,
            'campaign_name', campaign_name,
            'week_number', week_num,
            'theme', week_theme,
            'focus_area', week_focus
        )
    ) RETURNING id INTO notification_id;
    
    RETURN notification_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to update weekly alignment status
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
    UPDATE campaign_performance 
    SET 
        week_number = week_num,
        updated_at = NOW()
    WHERE campaign_id = campaign_uuid AND week_number = week_num;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create function to get 12-week plan overview
CREATE OR REPLACE FUNCTION get_12_week_plan_overview(campaign_uuid UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    week_data JSONB;
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

-- Success message
SELECT 'Weekly alignment extension added successfully! Uses existing tables with minimal additions.' as message;
