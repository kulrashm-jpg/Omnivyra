-- =====================================================
-- STEP-BY-STEP TABLE CREATION
-- =====================================================
-- Run each section one by one to see what's missing
-- =====================================================

-- Step 1: Check what tables exist
SELECT 'CURRENT TABLES:' as step;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Step 2: Create campaign_goals table
SELECT 'CREATING CAMPAIGN_GOALS...' as step;
CREATE TABLE IF NOT EXISTS campaign_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    content_type VARCHAR(100) NOT NULL,
    platform VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    frequency VARCHAR(100),
    target_audience TEXT,
    objectives TEXT[],
    metrics JSONB DEFAULT '{"engagement": 0, "reach": 0, "conversions": 0}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 3: Create market_analyses table
SELECT 'CREATING MARKET_ANALYSES...' as step;
CREATE TABLE IF NOT EXISTS market_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    trends JSONB DEFAULT '[]',
    competitors JSONB DEFAULT '[]',
    opportunities TEXT[],
    insights TEXT[],
    recommendations TEXT[],
    analysis_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 4: Create content_plans table
SELECT 'CREATING CONTENT_PLANS...' as step;
CREATE TABLE IF NOT EXISTS content_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    day_of_week VARCHAR(20),
    date DATE,
    platform VARCHAR(100) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    topic TEXT,
    content TEXT,
    status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'created', 'reviewed', 'scheduled', 'published', 'failed')),
    ai_generated BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    scheduled_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE
);

-- Step 5: Create schedule_reviews table
SELECT 'CREATING SCHEDULE_REVIEWS...' as step;
CREATE TABLE IF NOT EXISTS schedule_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    review_data JSONB DEFAULT '{}',
    optimizations TEXT[],
    final_schedule JSONB DEFAULT '[]',
    approved BOOLEAN DEFAULT false,
    reviewed_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 6: Create AI tables
SELECT 'CREATING AI TABLES...' as step;
CREATE TABLE IF NOT EXISTS ai_threads (
    id VARCHAR(255) PRIMARY KEY,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    messages JSONB DEFAULT '[]',
    context JSONB DEFAULT '{}',
    stage VARCHAR(50) DEFAULT 'planning',
    provider VARCHAR(50) DEFAULT 'demo' CHECK (provider IN ('demo', 'gpt', 'claude')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    thread_id VARCHAR(255) REFERENCES ai_threads(id) ON DELETE CASCADE,
    feedback_type VARCHAR(100) NOT NULL CHECK (feedback_type IN ('suggestion', 'improvement', 'warning', 'error', 'success')),
    content TEXT NOT NULL,
    context JSONB DEFAULT '{}',
    confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    provider VARCHAR(50) DEFAULT 'demo',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 7: Check final table count
SELECT 'FINAL TABLE COUNT:' as step;
SELECT COUNT(*) as total_tables FROM information_schema.tables 
WHERE table_schema = 'public';

SELECT 'ALL TABLES:' as step;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
