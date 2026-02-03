DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'super_admin_audit_action') THEN
    CREATE TYPE super_admin_audit_action AS ENUM ('login', 'logout', 'failed_login');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS super_admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  action super_admin_audit_action NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_audit_logs_created_at
  ON super_admin_audit_logs(created_at DESC);
