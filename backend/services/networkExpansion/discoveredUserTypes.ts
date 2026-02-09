export type DiscoveredUser = {
  id: string;
  tenant_id: string;
  organization_id: string;
  platform: string;
  external_user_id?: string;
  external_username?: string;
  profile_url: string;
  discovered_via: 'api' | 'rpa';
  discovery_source?: string;
  source_url?: string;
  classification?: 'influencer' | 'peer' | 'prospect' | 'spam_risk' | 'unknown';
  confidence_score?: number;
  eligible_for_engagement: boolean;
  blocked_reason?: string;
  metadata?: Record<string, any>;
  first_seen_at: string;
  last_seen_at: string;
};
