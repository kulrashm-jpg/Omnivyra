-- Campaign Collaboration Layer: activity_messages, calendar_messages, campaign_messages
-- Chats aligned with campaign structure: Campaign → Day → Activity

-- activity_messages: messages tied to a specific activity (execution_id)
CREATE TABLE IF NOT EXISTS activity_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id TEXT NOT NULL,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  parent_message_id UUID REFERENCES activity_messages(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_messages_activity_id ON activity_messages(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_messages_campaign_id ON activity_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_activity_messages_parent ON activity_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_activity_messages_created_at ON activity_messages(created_at);

COMMENT ON TABLE activity_messages IS 'Team messages/comments on a campaign activity';

-- calendar_messages: messages tied to a campaign day (date)
CREATE TABLE IF NOT EXISTS calendar_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  message_date DATE NOT NULL,
  parent_message_id UUID REFERENCES calendar_messages(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_messages_campaign_date ON calendar_messages(campaign_id, message_date);
CREATE INDEX IF NOT EXISTS idx_calendar_messages_parent ON calendar_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_calendar_messages_created_at ON calendar_messages(created_at);

COMMENT ON TABLE calendar_messages IS 'Team messages for a specific campaign day';

-- campaign_messages: campaign-level messages (no date)
CREATE TABLE IF NOT EXISTS campaign_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  parent_message_id UUID REFERENCES campaign_messages(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_parent ON campaign_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_created_at ON campaign_messages(created_at);

COMMENT ON TABLE campaign_messages IS 'Campaign-level team discussion';
