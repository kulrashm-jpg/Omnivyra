-- Campaign Virality Assessments Cache
CREATE TABLE campaign_virality_assessments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES campaigns(id),
    snapshot_hash varchar(64) NOT NULL,
    diagnostics jsonb NOT NULL,
    model_version varchar(20) NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE (campaign_id, snapshot_hash)
);
