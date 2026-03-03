export type OpportunityTabProps = {
  companyId: string | null;
  regions?: string[] | null;
  /** Optional enriched recommendation cards from recommendation engine (`trends_used`). */
  engineRecommendations?: Array<Record<string, unknown>>;
  onPromote: (opportunityId: string) => Promise<void>;
  onAction: (
    opportunityId: string,
    action: string,
    opts?: { scheduled_for?: string }
  ) => Promise<void>;
  fetchWithAuth: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  /** Strategic direction override text (local state, not persisted). */
  overrideText?: string;
  onOverrideChange?: (value: string) => void;
  /** For Daily Focus "Act Now" OPEN_TAB: switch to this opportunity tab (e.g. TREND, PULSE). */
  onSwitchTab?: (tab: string) => void;
  /** For Daily Focus "Act Now" OPEN_GENERATOR: open quick-content generator modal with this target. */
  onOpenGenerator?: (targetType: string) => void;
  /** Trend tab: optional legacy; campaign focus is now hierarchical (primary + supporting goals) in tab state. */
  strategicIntents?: string[];
  onStrategicIntentsChange?: (intents: string[]) => void;
  /** FULL = full strategic card (Content Architect, Super Admin); MINIMAL = decision-focused (company users). */
  viewMode?: 'FULL' | 'MINIMAL';
};

/**
 * opportunity_items.payload schema by type.
 * Each tab uses only its own fields; unknown keys are ignored.
 */
export type OpportunityPayloadTREND = {
  formats?: string[];
  reach_estimate?: number | string;
};
export type OpportunityPayloadLEAD = {
  platform?: string;
  snippet?: string;
  icp_match?: string;
  urgency_score?: number | string;
};
export type OpportunityPayloadPULSE = {
  spike_reason?: string;
  shelf_life_hours?: number;
};
export type OpportunityPayloadSEASONAL = {
  event_date?: string;
  suggested_offer?: string;
};
export type OpportunityPayloadINFLUENCER = {
  platform?: string;
  audience_overlap_score?: number | string;
  engagement_rate?: number | string;
};
export type OpportunityPayloadDAILY_FOCUS = {
  action_type?: 'OPEN_TAB' | 'CREATE_CAMPAIGN' | 'OPEN_GENERATOR';
  target_type?: string;
};

export type OpportunityPayload =
  | OpportunityPayloadTREND
  | OpportunityPayloadLEAD
  | OpportunityPayloadPULSE
  | OpportunityPayloadSEASONAL
  | OpportunityPayloadINFLUENCER
  | OpportunityPayloadDAILY_FOCUS;

/** Raw opportunity from API; payload holds type-specific fields per schema above. */
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

/** Read payload using canonical field names only. */
export const payloadHelpers = {
  // TREND: formats[], reach_estimate
  formats: (p: Record<string, unknown> | null | undefined) =>
    getPayloadStringArray(p, 'formats'),
  reachEstimate: (p: Record<string, unknown> | null | undefined) => {
    const v = p?.['reach_estimate'];
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    return '—';
  },
  // LEAD: platform, snippet, icp_match, urgency_score
  platform: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'platform') || '—',
  snippet: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'snippet') || '—',
  icpMatch: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'icp_match') || '—',
  urgencyScore: (p: Record<string, unknown> | null | undefined) => {
    const v = p?.['urgency_score'];
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    return '—';
  },
  // PULSE: spike_reason, shelf_life_hours
  spikeReason: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'spike_reason') || '—',
  shelfLifeHours: (p: Record<string, unknown> | null | undefined) => {
    const n = getPayloadNumber(p, 'shelf_life_hours');
    return n != null ? `${n} hours` : '—';
  },
  // SEASONAL: event_date, suggested_offer (title/region/angle from core fields or legacy keys)
  eventDate: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'event_date') || null,
  suggestedOffer: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'suggested_offer') || '',
  // INFLUENCER: platform, audience_overlap_score, engagement_rate (name from title)
  audienceOverlapScore: (p: Record<string, unknown> | null | undefined) => {
    const v = p?.['audience_overlap_score'];
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    return '—';
  },
  engagementRate: (p: Record<string, unknown> | null | undefined) => {
    const v = p?.['engagement_rate'];
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    return '—';
  },
  // DAILY_FOCUS: action_type, target_type
  actionType: (p: Record<string, unknown> | null | undefined) =>
    (getPayloadString(p, 'action_type') || null) as 'OPEN_TAB' | 'CREATE_CAMPAIGN' | 'OPEN_GENERATOR' | null,
  targetType: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'target_type') || null,
  // Shared/fallback for display (e.g. region from region_tags, event name from title)
  whyToday: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'why_today') || '',
  expectedImpact: (p: Record<string, unknown> | null | undefined) =>
    getPayloadString(p, 'expected_impact') || '',
};
