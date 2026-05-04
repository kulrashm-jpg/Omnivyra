-- VIRALITY PLAYBOOKS V1 (PLANNING ONLY)
-- This schema defines planning artifacts only. No execution or automation logic.

CREATE TABLE IF NOT EXISTS virality_playbooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    name TEXT NOT NULL,
    objective TEXT NOT NULL CHECK (objective IN ('awareness', 'growth', 'conversion', 'authority')),
    platforms TEXT[] NOT NULL,
    content_types TEXT[] NOT NULL,
    api_inputs UUID[] NOT NULL DEFAULT '{}'::uuid[],
    tone_guidelines TEXT,
    cadence_guidelines TEXT,
    success_metrics JSONB,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virality_playbooks_company ON virality_playbooks(company_id);
CREATE INDEX IF NOT EXISTS idx_virality_playbooks_status ON virality_playbooks(status);
