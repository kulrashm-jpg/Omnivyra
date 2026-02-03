export type TenantScoped = {
  tenant_id: string;
  organization_id: string;
};

export type ConnectedPlatform = TenantScoped & {
  platform_name: string;
  profile_name: string;
  profile_url: string;
  status: string;
};

export type BrandProfile = TenantScoped & {
  account_name: string;
  industry: string;
  description: string;
  target_audience: string;
  brand_voice: string;
};

export type ContentItem = TenantScoped & {
  platform: string;
  post_id: string;
  post_url: string;
  content_text: string;
  content_type: string;
  posted_at: string;
};

export type EngagementMetric = TenantScoped & {
  post_id: string;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  sentiment_score: number;
  captured_at: string;
};

export type GoalExpectation = TenantScoped & {
  post_id: string;
  goal_type: string;
  expected_likes: number;
  expected_comments: number;
  expected_shares: number;
  expected_views: number;
};

export type NetworkOpportunity = TenantScoped & {
  platform: string;
  user_handle: string;
  topic: string;
  priority_score: number;
};

export type InfluencerCandidate = TenantScoped & {
  platform: string;
  profile_url: string;
  follower_count: number;
  engagement_rate: number;
  topic_match_score: number;
  status: string;
};

export type PendingAction = TenantScoped & {
  action_id: string;
  action_type: string;
  platform: string;
  target_url?: string;
  target_id?: string;
  suggested_text?: string | null;
  risk_level: string;
  requires_approval?: boolean;
  requires_human_approval?: boolean;
  status: string;
  execution_result?: any;
  scheduled_at?: string | null;
  last_event?: {
    event_type: string;
    created_at: string;
  } | null;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  message: string;
  timestamp: string;
};

