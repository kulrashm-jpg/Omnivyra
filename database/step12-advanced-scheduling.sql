-- STEP 12: CREATE ADVANCED SCHEDULING FEATURES TABLES
-- Run this after step 11 is complete

-- User Timezones Table
CREATE TABLE user_timezones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    timezone VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scheduling Rules Table
CREATE TABLE scheduling_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    rule_name VARCHAR(255) NOT NULL,
    rule_type VARCHAR(50) NOT NULL, -- 'time_restriction', 'content_filter', 'frequency_limit', 'audience_targeting'
    rule_config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Bulk Operations Table
CREATE TABLE bulk_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_type VARCHAR(50) NOT NULL, -- 'bulk_schedule', 'bulk_delete', 'bulk_update', 'bulk_duplicate'
    operation_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
    total_items INTEGER NOT NULL,
    processed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    operation_config JSONB,
    error_log TEXT,
    progress_percentage DECIMAL(5,2) DEFAULT 0.00,
    estimated_completion_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Bulk Operation Items Table
CREATE TABLE bulk_operation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bulk_operation_id UUID NOT NULL REFERENCES bulk_operations(id) ON DELETE CASCADE,
    scheduled_post_id UUID REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    item_data JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    error_message TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Post Templates Table (for reusable content)
CREATE TABLE post_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_name VARCHAR(255) NOT NULL,
    description TEXT,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    content_template TEXT NOT NULL,
    variables JSONB, -- Template variables like {company_name}, {product_name}
    hashtags TEXT[],
    media_template JSONB,
    is_public BOOLEAN DEFAULT FALSE,
    usage_count INTEGER DEFAULT 0,
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Post Series Table (for multi-part content)
CREATE TABLE post_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    series_name VARCHAR(255) NOT NULL,
    description TEXT,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    total_parts INTEGER NOT NULL,
    current_part INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    series_config JSONB, -- Publishing schedule, intervals, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Post Series Items Table
CREATE TABLE post_series_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id UUID NOT NULL REFERENCES post_series(id) ON DELETE CASCADE,
    scheduled_post_id UUID REFERENCES scheduled_posts(id) ON DELETE SET NULL,
    part_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    media_urls TEXT[],
    scheduled_for TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'scheduled', 'published', 'skipped'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (series_id, part_number)
);

-- Content Calendar Table
CREATE TABLE content_calendar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    calendar_name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(7), -- Hex color code
    is_public BOOLEAN DEFAULT FALSE,
    view_settings JSONB, -- Calendar view preferences
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Calendar Events Table
CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id UUID NOT NULL REFERENCES content_calendar(id) ON DELETE CASCADE,
    scheduled_post_id UUID REFERENCES scheduled_posts(id) ON DELETE SET NULL,
    event_title VARCHAR(255) NOT NULL,
    event_description TEXT,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    event_type VARCHAR(50) NOT NULL, -- 'post', 'campaign', 'milestone', 'reminder'
    is_all_day BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scheduling Conflicts Table
CREATE TABLE scheduling_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conflict_type VARCHAR(50) NOT NULL, -- 'time_overlap', 'frequency_limit', 'content_similarity'
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    conflicting_post_id UUID REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    conflict_details JSONB,
    severity VARCHAR(20) DEFAULT 'warning', -- 'info', 'warning', 'error'
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Success message
SELECT 'Advanced scheduling features tables created successfully! Now run step 13.' as message;
