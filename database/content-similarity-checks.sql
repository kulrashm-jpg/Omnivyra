CREATE TABLE IF NOT EXISTS content_similarity_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  new_content JSONB NOT NULL,
  similarity_score FLOAT NOT NULL,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_similarity_company
  ON content_similarity_checks(company_id);
