-- =====================================================
-- SIMPLE DATABASE CHECK AND SETUP
-- =====================================================
-- Run this first to check what's happening
-- =====================================================

-- Step 1: Check current tables
SELECT 'CURRENT TABLES:' as info;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Step 2: Try to create just the campaigns table
SELECT 'CREATING CAMPAIGNS TABLE...' as info;

CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'planning',
    current_stage VARCHAR(50) DEFAULT 'planning',
    timeframe VARCHAR(50) DEFAULT 'quarter',
    start_date DATE,
    end_date DATE,
    thread_id VARCHAR(255) UNIQUE NOT NULL DEFAULT 'thread_' || gen_random_uuid()::text,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    launched_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Step 3: Check if campaigns table was created
SELECT 'TABLES AFTER CREATING CAMPAIGNS:' as info;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Step 4: Insert test data
SELECT 'INSERTING TEST DATA...' as info;
INSERT INTO campaigns (id, user_id, name, description, status) VALUES 
('550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440000', 'Test Campaign', 'Test campaign description', 'planning');

-- Step 5: Verify data
SELECT 'VERIFYING DATA:' as info;
SELECT COUNT(*) as campaign_count FROM campaigns;
SELECT id, name, status FROM campaigns;
