export type EngagementPlaybook = {
  id?: string;
  tenant_id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  scope: {
    platforms: string[];
    content_types: string[];
    intents: string[];
  };
  tone: {
    style: 'professional' | 'friendly' | 'empathetic';
    emoji_allowed: boolean;
    max_length: number;
  };
  user_rules: {
    first_time_user: 'must_reply' | 'optional' | 'ignore';
    influencer_user: 'require_approval' | 'reply';
    negative_sentiment: 'escalate' | 'reply_with_template' | 'ignore';
    spam_user: 'ignore';
  };
  action_rules: {
    allow_reply: boolean;
    allow_like: boolean;
    allow_follow: boolean;
    allow_share: boolean;
    allow_dm: boolean;
  };
  automation_rules: {
    auto_execute_low_risk: boolean;
    require_human_approval_medium_risk: boolean;
    block_high_risk: boolean;
  };
  automation_levels?: {
    network_expansion?: 'observe' | 'assist' | 'automate';
  };
  limits: {
    max_replies_per_hour: number;
    max_follows_per_day: number;
    max_actions_per_day: number;
    network_expansion?: {
      max_actions_per_day?: number;
      allowed_hours?: number[];
    };
  };
  execution_modes: {
    api_allowed: boolean;
    rpa_allowed: boolean;
    manual_only: boolean;
  };
  conflict_policy: {
    primary_wins: boolean;
    max_secondary_playbooks: number;
  };
  safety: {
    block_urls: boolean;
    block_sensitive_topics: boolean;
    prohibited_words: string[];
  };
  network_eligibility?: {
    enabled: boolean;
    allowed_classifications: Array<'influencer' | 'peer' | 'prospect' | 'unknown'>;
    excluded_classifications?: Array<'spam_risk'>;
    allowed_discovery_sources?: Array<'post' | 'comment' | 'thread' | 'search'>;
    max_new_users_per_day: number;
  };
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
};
