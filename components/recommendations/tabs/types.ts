export type OpportunityTabProps = {
  companyId: string | null;
  regions?: string[] | null;
  onPromote: (opportunityId: string) => Promise<void>;
  onAction: (
    opportunityId: string,
    action: string,
    opts?: { scheduled_for?: string }
  ) => Promise<void>;
  fetchWithAuth: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

/** Raw opportunity from API; payload holds type-specific fields. */
export type OpportunityWithPayload = {
  id: string;
  title: string;
  summary: string | null;
  problem_domain: string | null;
  region_tags: string[] | null;
  conversion_score: number | null;
  status: string;
  scheduled_for: string | null;
  first_seen_at: string;
  last_seen_at: string;
  payload?: Record<string, unknown> | null;
};

function getPayloadString(p: Record<string, unknown> | null | undefined, key: string): string {
  if (!p || typeof p[key] !== 'string') return '';
  return String(p[key]);
}
function getPayloadNumber(p: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!p || typeof p[key] !== 'number') return null;
  return Number(p[key]);
}
function getPayloadStringArray(p: Record<string, unknown> | null | undefined, key: string): string[] {
  if (!p || !Array.isArray(p[key])) return [];
  return (p[key] as unknown[]).map((x) => (typeof x === 'string' ? x : String(x)));
}

export const payloadHelpers = {
  expectedReach: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'expected_reach') || getPayloadString(p, 'expected_reach_label') || '—',
  suggestedFormats: (p: Record<string, unknown> | null | undefined) =>
    getPayloadStringArray(p, 'suggested_formats').length
      ? getPayloadStringArray(p, 'suggested_formats')
      : [getPayloadString(p, 'suggested_format')].filter(Boolean),
  platform: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'platform') || '—',
  publicSnippet: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'public_snippet') || getPayloadString(p, 'snippet') || '—',
  icpMatch: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'icp_match') || getPayloadString(p, 'icp_match_score') || '—',
  urgency: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'urgency') || '—',
  spikeReason: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'spike_reason') || getPayloadString(p, 'reason') || '—',
  shelfLife: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'shelf_life') || getPayloadString(p, 'shelf_life_days') || '—',
  eventName: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'event_name') || getPayloadString(p, 'name') || '—',
  region: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'region') || '—',
  suggestedAngle: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'suggested_angle') || getPayloadString(p, 'angle') || '—',
  offerIdea: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'offer_idea') || getPayloadString(p, 'offer') || '—',
  eventDate: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'event_date') || getPayloadString(p, 'date') || null,
  influencerName: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'influencer_name') || getPayloadString(p, 'name') || '—',
  audienceOverlap: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'audience_overlap') || getPayloadString(p, 'overlap') || '—',
  engagementQuality: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'engagement_quality') || getPayloadString(p, 'engagement') || '—',
  whyToday: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'why_today') || getPayloadString(p, 'reason') || '—',
  expectedImpact: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'expected_impact') || getPayloadString(p, 'impact') || '—',
  actionType: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'action_type') || getPayloadString(p, 'action') || null,
};
