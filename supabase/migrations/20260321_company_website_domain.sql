-- Store normalized website domain (e.g. "drishiq.com" from "www.drishiq.com")
-- directly on companies for fast indexed lookup during new-user onboarding.
-- Also backfill existing rows where possible.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS website_domain TEXT;

-- Backfill: extract domain from existing website values that look like real URLs
-- (skip UUID placeholders — they contain hyphens and no dots typical of domains)
UPDATE companies
SET website_domain = lower(
  regexp_replace(
    regexp_replace(
      regexp_replace(website, '^https?://(www\.)?', ''),
      '/.*$', ''
    ),
    '^www\.', ''
  )
)
WHERE website IS NOT NULL
  AND website ~ '\.'             -- must contain a dot (real domain)
  AND website !~ '^[0-9a-f-]{36}$';  -- skip UUID placeholders

CREATE INDEX IF NOT EXISTS idx_companies_website_domain
  ON companies(website_domain)
  WHERE website_domain IS NOT NULL;
