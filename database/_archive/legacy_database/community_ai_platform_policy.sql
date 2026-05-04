DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'update_policy'
      AND enumtypid = 'super_admin_audit_action'::regtype
  ) THEN
    ALTER TYPE super_admin_audit_action ADD VALUE 'update_policy';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS community_ai_platform_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_rules_enabled BOOLEAN NOT NULL DEFAULT true,
  require_human_approval BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
