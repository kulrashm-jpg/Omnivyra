-- Campaign Readiness Leads (landing page / guest readiness flow)
-- Stores company name, website, optional email, score, optional user_id when logged in
CREATE TABLE IF NOT EXISTS campaign_readiness_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    website_url TEXT NOT NULL,
    email TEXT,
    score INT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_readiness_leads_user_id
    ON campaign_readiness_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_readiness_leads_created_at
    ON campaign_readiness_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_campaign_readiness_leads_email
    ON campaign_readiness_leads(email) WHERE email IS NOT NULL;

COMMENT ON TABLE campaign_readiness_leads IS 'Leads from landing page readiness check; email nullable for logged-in users.';
