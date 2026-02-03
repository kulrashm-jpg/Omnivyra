CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL UNIQUE,
  company_id UUID NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL CHECK (
    role IN (
      'SUPER_ADMINa',
      'COMPANY_ADMIN',
      'CONTENT_CREATOR',
      'CONTENT_REVIEWER',
      'CONTENT_PUBLISHER',
      'VIEW_ONLY'
    )
  ),
  created_at TIMESTAMPTZ DEFAULT now()
);
