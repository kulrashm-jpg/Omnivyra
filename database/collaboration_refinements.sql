-- Campaign Collaboration Refinements
-- 1. message_reads - track when users read messages (unread indicator)
-- 2. message_mentions - track @mentions for notifications

-- message_reads: polymorphic across activity_messages, calendar_messages, campaign_messages
-- message_source: 'activity' | 'calendar' | 'campaign'
CREATE TABLE IF NOT EXISTS message_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  message_source TEXT NOT NULL CHECK (message_source IN ('activity', 'calendar', 'campaign')),
  user_id UUID NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (message_id, message_source, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reads_user_source ON message_reads(user_id, message_source);
CREATE INDEX IF NOT EXISTS idx_message_reads_message ON message_reads(message_id, message_source);

COMMENT ON TABLE message_reads IS 'Tracks when users read collaboration messages for unread indicators';

-- message_mentions: @mentions in message text
CREATE TABLE IF NOT EXISTS message_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  message_source TEXT NOT NULL CHECK (message_source IN ('activity', 'calendar', 'campaign')),
  mentioned_user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (message_id, message_source, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_mentions_mentioned ON message_mentions(mentioned_user_id);
CREATE INDEX IF NOT EXISTS idx_message_mentions_message ON message_mentions(message_id, message_source);

COMMENT ON TABLE message_mentions IS '@mentions extracted from message text for notifications';
