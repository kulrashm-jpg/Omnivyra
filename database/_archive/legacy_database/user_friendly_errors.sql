-- =====================================================
-- USER FRIENDLY ERROR MAPPINGS
-- Maps technical errors → plain-language messages for users
-- Add new rows as new problems/errors are discovered
-- =====================================================

CREATE TABLE IF NOT EXISTS user_friendly_error_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_type TEXT NOT NULL CHECK (match_type IN ('code', 'contains', 'regex', 'fallback')),
  match_value TEXT DEFAULT '',
  context TEXT NOT NULL DEFAULT 'generic' CHECK (context IN (
    'login', 'company', 'campaign', 'strategic_themes', 'recommendations', 'publish', 'external_api', 'generic'
  )),
  user_message TEXT NOT NULL,
  suggest_retry BOOLEAN DEFAULT true,
  guidance TEXT,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (match_type, match_value, context)
);

CREATE INDEX IF NOT EXISTS idx_ufem_active_priority
  ON user_friendly_error_mappings (is_active, priority)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ufem_context
  ON user_friendly_error_mappings (context)
  WHERE is_active = true;

-- Seed: Connection / network errors (code)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, guidance, priority) VALUES
('code', 'ECONNREFUSED', 'login', 'We''re facing technical difficulties. Please try again in a few minutes.', true, 'Try again in a few minutes.', 10),
('code', 'ECONNREFUSED', 'campaign', 'Your campaign plan was disrupted due to a technical glitch. Please try again.', true, 'If the problem persists, we will get back to you.', 10),
('code', 'ECONNREFUSED', 'strategic_themes', 'We could not generate strategic themes due to a temporary issue. Please try again.', true, NULL, 10),
('code', 'ECONNREFUSED', 'recommendations', 'Recommendation generation was interrupted. Please try again.', true, NULL, 10),
('code', 'ECONNREFUSED', 'company', 'We could not complete that action due to a temporary issue. Please try again.', true, NULL, 10),
('code', 'ECONNREFUSED', 'external_api', 'An external service is temporarily unavailable. Please try again later.', true, NULL, 10),
('code', 'ECONNREFUSED', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, NULL, 10),
('code', 'ECONNRESET', 'login', 'We''re facing technical difficulties. Please try again in a few minutes.', true, NULL, 10),
('code', 'ECONNRESET', 'campaign', 'Your campaign plan was disrupted due to a technical glitch. Please try again.', true, NULL, 10),
('code', 'ECONNRESET', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, NULL, 10),
('code', 'ETIMEDOUT', 'campaign', 'The request took too long. Please try again.', true, NULL, 10),
('code', 'ETIMEDOUT', 'generic', 'The request took too long. Please try again.', true, NULL, 10),
('code', 'ENOTFOUND', 'campaign', 'A required service could not be reached. Please try again later.', true, NULL, 10),
('code', 'ENOTFOUND', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, NULL, 10)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: Connection / network errors (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, guidance, priority) VALUES
('contains', 'connection refused', 'login', 'We''re facing technical difficulties. Please try again in a few minutes.', true, NULL, 15),
('contains', 'connection refused', 'campaign', 'Your campaign plan was disrupted due to a technical glitch. Please try again.', true, NULL, 15),
('contains', 'fetch failed', 'campaign', 'Your campaign plan was disrupted due to a technical glitch. Please try again.', true, NULL, 15),
('contains', 'fetch failed', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, NULL, 15),
('contains', 'econnrefused', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, NULL, 15),
('contains', 'econnreset', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, NULL, 15)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: Rate limit / quota (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, guidance, priority) VALUES
('contains', 'rate limit', 'login', 'Too many requests. Please wait a moment and try again.', true, 'Try again in a minute.', 20),
('contains', 'rate limit', 'campaign', 'We are temporarily at capacity. Please try again in a few minutes.', true, NULL, 20),
('contains', 'rate limit', 'external_api', 'The service is rate-limited. Please try again in a few minutes.', true, NULL, 20),
('contains', 'rate limit', 'generic', 'We are temporarily at capacity. Please try again in a few minutes.', true, NULL, 20),
('contains', '429', 'campaign', 'We are temporarily at capacity. Please try again in a few minutes.', true, NULL, 20),
('contains', '429', 'generic', 'We are temporarily at capacity. Please try again in a few minutes.', true, NULL, 20),
('contains', 'too many requests', 'generic', 'We are temporarily at capacity. Please try again in a few minutes.', true, NULL, 20),
('contains', 'quota', 'campaign', 'We have reached our processing limit. Please try again later.', true, NULL, 20),
('contains', 'quota', 'generic', 'We have reached our processing limit. Please try again later.', true, NULL, 20)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: Timeout (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, priority) VALUES
('contains', 'timeout', 'campaign', 'The request took too long. Please try again.', true, 25),
('contains', 'timeout', 'strategic_themes', 'Theme generation is taking longer than expected. Please try again.', true, 25),
('contains', 'timeout', 'generic', 'The request took too long. Please try again.', true, 25),
('contains', 'timed out', 'campaign', 'The request took too long. Please try again.', true, 25),
('contains', 'timed out', 'generic', 'The request took too long. Please try again.', true, 25)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: Permission / auth (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, priority) VALUES
('contains', 'unauthorized', 'login', 'Sign-in could not be completed. Please check your credentials and try again.', false, 30),
('contains', 'unauthorized', 'campaign', 'You don''t have permission to perform this action.', false, 30),
('contains', 'unauthorized', 'generic', 'You don''t have permission to perform this action.', false, 30),
('contains', '403', 'login', 'Sign-in could not be completed. Please check your credentials and try again.', false, 30),
('contains', '403', 'campaign', 'You don''t have permission to perform this action.', false, 30),
('contains', 'forbidden', 'campaign', 'You don''t have permission to perform this action.', false, 30),
('contains', 'access denied', 'campaign', 'You don''t have permission to perform this action.', false, 30),
('contains', 'permission', 'campaign', 'You don''t have permission to perform this action.', false, 30)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: Validation / missing fields (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, priority) VALUES
('contains', 'missing', 'campaign', 'Please complete all required fields before continuing.', false, 40),
('contains', 'missing', 'recommendations', 'Please complete all required fields (audience, start date, goal) to continue.', false, 40),
('contains', 'required', 'campaign', 'Please complete all required fields before continuing.', false, 40),
('contains', 'invalid', 'campaign', 'Please check your input and try again.', false, 40),
('contains', 'validation', 'campaign', 'Please complete all required fields before continuing.', false, 40),
('contains', 'complete the execution bar', 'campaign', 'Please complete all required fields before continuing.', false, 40)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: AggregateError / multi-error (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, priority) VALUES
('contains', 'aggregateerror', 'campaign', 'Your campaign plan was disrupted due to a technical glitch. Please try again.', true, 35),
('contains', 'aggregate error', 'campaign', 'Your campaign plan was disrupted due to a technical glitch. Please try again.', true, 35)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: OpenAI / API key (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, priority) VALUES
('contains', 'openai_api_key', 'campaign', 'AI service configuration is missing. Please contact support.', false, 45),
('contains', 'api key', 'campaign', 'Service configuration is incomplete. Please try again or contact support.', true, 45),
('contains', 'invalid api key', 'campaign', 'Service configuration needs to be updated. Please contact support.', false, 45)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: 500 / server error (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, priority) VALUES
('contains', '500', 'generic', 'We encountered an unexpected issue. Please try again in a few minutes.', true, 50),
('contains', 'internal server error', 'generic', 'We encountered an unexpected issue. Please try again in a few minutes.', true, 50),
('contains', '503', 'generic', 'The service is temporarily unavailable. Please try again later.', true, 50),
('contains', 'service unavailable', 'generic', 'The service is temporarily unavailable. Please try again later.', true, 50)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: Redis / queue (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, priority) VALUES
('contains', 'redis', 'campaign', 'Background processing is temporarily unavailable. Please try again in a few minutes.', true, 55),
('contains', 'enqueue', 'campaign', 'We could not start the process. Please try again.', true, 55),
('contains', 'queue', 'campaign', 'Background processing is temporarily unavailable. Please try again in a few minutes.', true, 55)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Seed: Supabase / database (message contains)
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, priority) VALUES
('contains', 'supabase', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, 60),
('contains', 'postgres', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, 60),
('contains', 'database', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, 60)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Context fallbacks (when no pattern matches) - match_type='fallback', match_value=context
INSERT INTO user_friendly_error_mappings (match_type, match_value, context, user_message, suggest_retry, guidance, priority) VALUES
('fallback', 'login', 'login', 'We''re having trouble signing you in. Please try again in a few minutes.', true, NULL, 1000),
('fallback', 'company', 'company', 'We could not complete that action. Please try again.', true, NULL, 1000),
('fallback', 'campaign', 'campaign', 'Your campaign plan was disrupted due to a technical glitch. Please try again.', true, 'If the problem persists, try again later or reach out for support.', 1000),
('fallback', 'strategic_themes', 'strategic_themes', 'We could not generate themes. Please try again.', true, NULL, 1000),
('fallback', 'recommendations', 'recommendations', 'Recommendation generation was interrupted. Please try again.', true, NULL, 1000),
('fallback', 'publish', 'publish', 'Publishing was interrupted. Please try again.', true, NULL, 1000),
('fallback', 'external_api', 'external_api', 'An external service is temporarily unavailable. Please try again later.', true, NULL, 1000),
('fallback', 'generic', 'generic', 'We''re facing technical difficulties. Please try again in a few minutes.', true, NULL, 1000)
ON CONFLICT (match_type, match_value, context) DO UPDATE SET
  user_message = EXCLUDED.user_message,
  suggest_retry = EXCLUDED.suggest_retry,
  guidance = EXCLUDED.guidance,
  priority = EXCLUDED.priority,
  updated_at = now();
