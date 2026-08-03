/**
 * INT-001 Phase 2 — Lead Intelligence Engine: shared contracts.
 *
 * Every engine in this module is pure and deterministic: it consumes an
 * already-captured snapshot (lead row + stored tracking rows, normalized by the
 * snapshot assembler) and an explicit `now` timestamp. No engine reads the
 * database, the clock, or any Phase 0/1 capture code.
 */

/** Page taxonomy used by intent, segmentation and recommendations. */
export type PageCategory =
  | 'home'
  | 'pricing'
  | 'enterprise'
  | 'comparison'
  | 'documentation'
  | 'security'
  | 'demo'
  | 'blog'
  | 'case_study'
  | 'careers'
  | 'partners'
  | 'investors'
  | 'contact'
  | 'download'
  | 'other';

/** Normalized captured behavioural event (mirrors a `tracking_events` row). */
export interface CapturedEvent {
  /** Stable identity for dedupe (row id or dedupe_key when present). */
  id: string | null;
  eventName: string;
  pageUrl: string | null;
  sessionId: string | null;
  occurredAt: string; // ISO-8601
  metadata: Record<string, unknown>;
}

/** Normalized visitor session (mirrors a `visitor_sessions` row). */
export interface CapturedSession {
  id: string | null;
  startedAt: string | null;
  lastSeenAt: string | null;
  firstLandingPage: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

/** Normalized campaign touchpoint (mirrors a `campaign_touchpoints` row). */
export interface CapturedTouchpoint {
  id: string | null;
  touchpointType: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  pageUrl: string | null;
  touchedAt: string | null;
}

/** Normalized lead profile (mirrors a `leads` row + its metadata JSONB). */
export interface CapturedLeadProfile {
  id: string | null;
  email: string | null;
  name: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companySize: string | null;
  industry: string | null;
  country: string | null;
  primaryInterest: string | null;
  message: string | null;
  source: string | null;
  createdAt: string | null;
}

/** The complete engine input. Assembled once, consumed by every engine. */
export interface LeadCaptureSnapshot {
  lead: CapturedLeadProfile;
  events: CapturedEvent[];
  sessions: CapturedSession[];
  touchpoints: CapturedTouchpoint[];
  /** Injected evaluation time (ISO-8601). Engines never read the clock. */
  now: string;
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

/** One explainable contribution toward the intent score. */
export interface IntentContribution {
  signal: string;
  label: string;
  points: number;
  evidence: string;
}

export type IntentBand = 'high' | 'medium' | 'low' | 'none';

export interface IntentIntelligence {
  score: number; // 0..100
  band: IntentBand;
  contributions: IntentContribution[];
}

// ---------------------------------------------------------------------------
// Persona
// ---------------------------------------------------------------------------

export type Persona =
  | 'Founder'
  | 'CEO'
  | 'CTO'
  | 'Marketing'
  | 'Sales'
  | 'Developer'
  | 'Procurement'
  | 'Agency'
  | 'Consultant'
  | 'Student'
  | 'Partner'
  | 'Investor'
  | 'Recruiter'
  | 'Unknown';

export interface PersonaIntelligence {
  persona: Persona;
  confidence: number; // 0..1
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

export type QualificationSectionKey = 'intent' | 'persona' | 'companyFit' | 'behavior' | 'urgency';

export interface QualificationSection {
  key: QualificationSectionKey;
  score: number; // 0..100
  weight: number; // 0..1, all sections sum to 1
  weightedScore: number; // score * weight, rounded to 2 decimals
  reason: string;
}

export interface QualificationIntelligence {
  totalScore: number; // 0..100, always round(sum of weightedScore)
  band: 'hot' | 'warm' | 'cool' | 'cold';
  sections: QualificationSection[];
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

export type LeadSegment =
  | 'Researchers'
  | 'Enterprise Buyers'
  | 'Technical Evaluators'
  | 'Price Shoppers'
  | 'Decision Makers'
  | 'Champions'
  | 'Procurement'
  | 'Partners'
  | 'Investors'
  | 'Job Seekers'
  | 'Existing Customers'
  | 'Competitor Evaluators'
  | 'Cold Visitors'
  | 'High Intent Buyers';

export interface SegmentAssignment {
  segment: LeadSegment;
  confidence: number; // 0..1
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export interface RecommendationItem<T = string> {
  value: T;
  confidence: number; // 0..1
  explanation: string;
}

export interface LeadRecommendations {
  whyValuable: RecommendationItem;
  likelyProductInterest: RecommendationItem;
  likelyObjections: RecommendationItem<string[]>;
  recommendedContent: RecommendationItem<string[]>;
  recommendedOwner: RecommendationItem;
  bestChannel: RecommendationItem;
  bestContactTime: RecommendationItem;
  meetingProbability: RecommendationItem<number>; // 0..1
  closeProbability: RecommendationItem<number>; // 0..1
  nextBestAction: RecommendationItem;
}

/**
 * INT-001A (Finding 4) — the CANONICAL recommendation key list, owned by the
 * engine next to the type it describes. Read layers must consume this instead
 * of hand-listing keys. Order is part of the stable presentation contract.
 * The compile-time assertions below fail the build if this list ever drifts
 * from `LeadRecommendations` in either direction.
 */
export const LEAD_RECOMMENDATION_KEYS = [
  { key: 'whyValuable', label: 'Why valuable' },
  { key: 'likelyProductInterest', label: 'Likely product interest' },
  { key: 'likelyObjections', label: 'Likely objections' },
  { key: 'recommendedContent', label: 'Recommended content' },
  { key: 'recommendedOwner', label: 'Recommended owner' },
  { key: 'bestChannel', label: 'Best channel' },
  { key: 'bestContactTime', label: 'Best contact time' },
  { key: 'meetingProbability', label: 'Meeting probability' },
  { key: 'closeProbability', label: 'Close probability' },
  { key: 'nextBestAction', label: 'Next best action' },
] as const;

export type LeadRecommendationKey = (typeof LEAD_RECOMMENDATION_KEYS)[number]['key'];

// Exhaustiveness, both directions — a key added to the interface but not the
// list (or vice versa) makes one of these `never` and the assignment fails.
type MissingFromKeyList = Exclude<keyof LeadRecommendations, LeadRecommendationKey>;
type ExtraInKeyList = Exclude<LeadRecommendationKey, keyof LeadRecommendations>;
const assertNoMissingRecommendationKeys: MissingFromKeyList extends never ? true : never = true;
const assertNoExtraRecommendationKeys: ExtraInKeyList extends never ? true : never = true;
void assertNoMissingRecommendationKeys;
void assertNoExtraRecommendationKeys;

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineStageType =
  | 'page_view'
  | 'engagement'
  | 'conversion'
  | 'lead_submitted'
  | 'qualified'
  | 'recommendation_generated';

export interface LeadTimelineEntry {
  type: TimelineStageType;
  label: string;
  occurredAt: string; // ISO-8601
  pageUrl: string | null;
  category: PageCategory | null;
  source: 'tracking' | 'capture' | 'intelligence';
}

// ---------------------------------------------------------------------------
// Consolidated summary
// ---------------------------------------------------------------------------

export interface LeadIntelligenceSummary {
  leadId: string | null;
  intent: IntentIntelligence;
  persona: PersonaIntelligence;
  qualification: QualificationIntelligence;
  segments: SegmentAssignment[];
  recommendations: LeadRecommendations;
  timeline: LeadTimelineEntry[];
  /** Overall confidence in this intelligence object (data completeness driven). */
  confidence: number; // 0..1
  generatedAt: string; // === snapshot.now
}
