CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID,
  action TEXT,
  target_user_id UUID,
  company_id UUID,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);
