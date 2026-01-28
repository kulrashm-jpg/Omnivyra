-- =====================================================
-- SUPER ADMIN SECURITY SYSTEM
-- =====================================================
-- This script creates a role-based access control system
-- where only super admins can delete campaign data
-- =====================================================

-- 1. CREATE USER ROLES TABLE
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'admin', 'super_admin')),
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, role)
);

-- 2. CREATE AUDIT LOG TABLE FOR DELETIONS
CREATE TABLE IF NOT EXISTS deletion_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    user_role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL, -- 'delete_campaign', 'delete_weekly_plan', etc.
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    record_data JSONB, -- Store the data that was deleted
    reason TEXT,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. CREATE SUPER ADMIN FUNCTIONS
CREATE OR REPLACE FUNCTION is_super_admin(check_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_id = check_user_id 
        AND role = 'super_admin' 
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. CREATE SAFE DELETE FUNCTIONS WITH SUPER ADMIN CHECK
CREATE OR REPLACE FUNCTION safe_delete_campaign(
    p_campaign_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    user_role VARCHAR(50);
    campaign_data JSONB;
    result JSONB;
BEGIN
    -- Check if user is super admin
    IF NOT is_super_admin(p_user_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Access denied. Only super admins can delete campaigns.',
            'code', 'INSUFFICIENT_PRIVILEGES'
        );
    END IF;
    
    -- Get user role for audit
    SELECT role INTO user_role FROM user_roles 
    WHERE user_id = p_user_id AND is_active = true;
    
    -- Get campaign data before deletion for audit
    SELECT to_jsonb(c.*) INTO campaign_data FROM campaigns c WHERE id = p_campaign_id;
    
    IF campaign_data IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Campaign not found',
            'code', 'NOT_FOUND'
        );
    END IF;
    
    -- Log the deletion attempt
    INSERT INTO deletion_audit_log (
        user_id, user_role, action, table_name, record_id, 
        record_data, reason, ip_address, user_agent
    ) VALUES (
        p_user_id, user_role, 'delete_campaign', 'campaigns', 
        p_campaign_id, campaign_data, p_reason, p_ip_address, p_user_agent
    );
    
    -- Delete in dependency order
    DELETE FROM daily_content_plans WHERE campaign_id = p_campaign_id;
    DELETE FROM weekly_content_refinements WHERE campaign_id = p_campaign_id;
    DELETE FROM campaign_performance WHERE campaign_id = p_campaign_id;
    DELETE FROM campaign_goals WHERE campaign_id = p_campaign_id;
    DELETE FROM campaigns WHERE id = p_campaign_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Campaign deleted successfully',
        'campaign_id', p_campaign_id,
        'deleted_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. CREATE SAFE DELETE WEEKLY PLAN FUNCTION
CREATE OR REPLACE FUNCTION safe_delete_weekly_plan(
    p_plan_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    user_role VARCHAR(50);
    plan_data JSONB;
    result JSONB;
BEGIN
    -- Check if user is super admin
    IF NOT is_super_admin(p_user_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Access denied. Only super admins can delete weekly plans.',
            'code', 'INSUFFICIENT_PRIVILEGES'
        );
    END IF;
    
    -- Get user role for audit
    SELECT role INTO user_role FROM user_roles 
    WHERE user_id = p_user_id AND is_active = true;
    
    -- Get plan data before deletion for audit
    SELECT to_jsonb(w.*) INTO plan_data FROM weekly_content_refinements w WHERE id = p_plan_id;
    
    IF plan_data IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Weekly plan not found',
            'code', 'NOT_FOUND'
        );
    END IF;
    
    -- Log the deletion attempt
    INSERT INTO deletion_audit_log (
        user_id, user_role, action, table_name, record_id, 
        record_data, reason, ip_address, user_agent
    ) VALUES (
        p_user_id, user_role, 'delete_weekly_plan', 'weekly_content_refinements', 
        p_plan_id, plan_data, p_reason, p_ip_address, p_user_agent
    );
    
    -- Delete related daily plans first
    DELETE FROM daily_content_plans WHERE weekly_refinement_id = p_plan_id;
    
    -- Delete the weekly plan
    DELETE FROM weekly_content_refinements WHERE id = p_plan_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Weekly plan deleted successfully',
        'plan_id', p_plan_id,
        'deleted_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. CREATE SUPER ADMIN MANAGEMENT FUNCTIONS
CREATE OR REPLACE FUNCTION grant_super_admin(
    p_target_user_id UUID,
    p_granted_by UUID,
    p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    -- Only existing super admins can grant super admin role
    IF NOT is_super_admin(p_granted_by) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Access denied. Only super admins can grant super admin role.',
            'code', 'INSUFFICIENT_PRIVILEGES'
        );
    END IF;
    
    -- Grant super admin role
    INSERT INTO user_roles (user_id, role, granted_by, expires_at)
    VALUES (p_target_user_id, 'super_admin', p_granted_by, p_expires_at)
    ON CONFLICT (user_id, role) 
    DO UPDATE SET 
        granted_by = EXCLUDED.granted_by,
        expires_at = EXCLUDED.expires_at,
        is_active = true,
        updated_at = NOW();
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Super admin role granted successfully',
        'user_id', p_target_user_id,
        'granted_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. CREATE INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(is_active);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_user ON deletion_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_action ON deletion_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_created ON deletion_audit_log(created_at);

-- 8. CREATE ROW LEVEL SECURITY POLICIES
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_audit_log ENABLE ROW LEVEL SECURITY;

-- Users can only see their own roles
CREATE POLICY "Users can view own roles" ON user_roles
    FOR SELECT USING (auth.uid() = user_id);

-- Only super admins can view audit logs
CREATE POLICY "Super admins can view audit logs" ON deletion_audit_log
    FOR SELECT USING (is_super_admin(auth.uid()));

-- 9. CREATE INITIAL SUPER ADMIN (if users table exists)
-- This creates the first super admin - replace with actual user ID
DO $$
DECLARE
    first_user_id UUID;
BEGIN
    -- Get the first user from the users table
    SELECT id INTO first_user_id FROM users ORDER BY created_at LIMIT 1;
    
    IF first_user_id IS NOT NULL THEN
        -- Grant super admin role to first user
        INSERT INTO user_roles (user_id, role, granted_by)
        VALUES (first_user_id, 'super_admin', first_user_id)
        ON CONFLICT (user_id, role) DO NOTHING;
        
        RAISE NOTICE 'Initial super admin created for user: %', first_user_id;
    END IF;
END $$;

-- 10. ADD COMMENTS FOR DOCUMENTATION
COMMENT ON TABLE user_roles IS 'Role-based access control for users';
COMMENT ON TABLE deletion_audit_log IS 'Audit trail for all deletion operations';
COMMENT ON FUNCTION is_super_admin(UUID) IS 'Check if user has super admin privileges';
COMMENT ON FUNCTION safe_delete_campaign(UUID, UUID, TEXT, INET, TEXT) IS 'Safely delete campaign with super admin check and audit logging';
COMMENT ON FUNCTION safe_delete_weekly_plan(UUID, UUID, TEXT, INET, TEXT) IS 'Safely delete weekly plan with super admin check and audit logging';
COMMENT ON FUNCTION grant_super_admin(UUID, UUID, TIMESTAMP WITH TIME ZONE) IS 'Grant super admin role to a user';

-- 11. SUCCESS MESSAGE
SELECT 'Super Admin Security System created successfully!' as message;
SELECT 'Key Features:' as info;
SELECT '- Only super admins can delete campaigns and weekly plans' as feature;
SELECT '- All deletions are logged with full audit trail' as feature;
SELECT '- Role-based access control with expiration support' as feature;
SELECT '- Row Level Security policies implemented' as feature;
SELECT '- Safe delete functions with proper error handling' as feature;






