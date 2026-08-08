/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 1 — canonical Contact Understanding contracts.
 *
 * Contact Understanding is the 8th canonical Understanding entity (with Lead/Company/Offering/Visitor/
 * Journey/Intent/Qualification) on the SHARED Product-Intelligence spine (`intelligence/canonical`). It
 * REUSES Program 1's Facet<T>, EvidenceRef, ReasoningTrace, GraphNodeRef and the dimension-generic
 * scoring contract — no forked primitive, no new inference framework.
 *
 * ─── WHAT IT OWNS ──────────────────────────────────────────────────────────────────────────────────
 * ONLY the canonical understanding of a PLATFORM PERSON: who this person is on a platform, how they
 * present themselves, how reachable they are, and how strong the evidence for all of that is. It owns
 * NO company semantics, NO lead semantics, NO journey/intent/qualification semantics, NO chronology
 * (it READS `observedAt`), and NO prediction — every facet is a description of observed evidence.
 *
 * ─── THE IDENTITY DECISION THIS ENCODES (WS-5E, frozen) ────────────────────────────────────────────
 * `ContactIdentityKey` is `{ companyId, contactId }` — TENANT-SCOPED, and deliberately so. Platform
 * person identity is tenant-scoped in this repository: `contacts` is UNIQUE per
 * (organization_id, platform, platform_user_id) and `unified_persons.company_id` is NOT NULL. Every
 * sibling Understanding is keyed the same way. A key without `companyId` could not express which
 * tenant's understanding this is, and every facet and score below would become cross-tenant by
 * construction. The tenant is therefore part of the identity, not a filter applied afterwards.
 *
 * Contact is SUBORDINATE to `unified_persons` (the Canonical Person). `identity.unifiedPersonId` is the
 * reference upward; this module never claims to own person identity, only the platform-person view of
 * it. `engagement_authors` is a projection and appears nowhere in these contracts.
 *
 * Abstains when evidence is insufficient — an empty facet is honest; a fabricated one is not.
 */

import type { Facet, EvidenceRef, ReasoningTrace, ContradictionRef, GraphNodeRef, GraphEdge, ISOTimestamp } from '../intelligence/canonical';
import type { ScoreContribution, DimensionScore, CanonicalScore } from '../intelligence/canonical';

export type { EvidenceRef, ReasoningTrace, ContradictionRef, ISOTimestamp };

// ── Contact score dimensions (shared generic scoring specialized to a platform person) ─────────────
// DESCRIPTIVE, never predictive. `reachability` is how many distinct ways this person can be reached;
// `identityStrength` is how well corroborated the identity itself is; `engagementDepth` is how much
// interaction has been observed; `recency` is how fresh the freshest evidence is. None of these is a
// propensity — Contact describes what was observed, and Intent/Qualification interpret it.
export type ContactScoreDimension = 'identity_strength' | 'reachability' | 'engagement_depth' | 'recency';
export const CONTACT_SCORE_DIMENSIONS: readonly ContactScoreDimension[] = ['identity_strength', 'reachability', 'engagement_depth', 'recency'];
export type ContactContribution = ScoreContribution<ContactScoreDimension>;
export type ContactDimensionScore = DimensionScore<ContactScoreDimension>;
export type ContactScore = CanonicalScore<ContactScoreDimension>;

/** Open, extensible platform name — matches how `contacts.platform` is stored (normalized, lowercase). */
export type ContactPlatform = 'x' | 'linkedin' | 'instagram' | 'facebook' | 'youtube' | 'reddit' | 'tiktok' | (string & {});

/** How a contact can be reached. Open union — a channel this platform does not support simply abstains. */
export type ContactChannelType = 'dm' | 'mention' | 'comment' | 'email' | 'phone' | 'profile_link' | (string & {});

// ── Contact facet value shapes (every field abstains when unevidenced) ─────────────────────────────
/**
 * `platformUserId` is the platform's own stable id and `handle` is the display handle. They are
 * separate because a handle is renameable and an id is not — collapsing them would make a rename look
 * like a different person. `unifiedPersonId` is the upward reference to the Canonical Person.
 */
export interface ContactIdentityValue {
  canonical_id?: string;
  platform?: ContactPlatform;
  platformUserId?: string;
  handle?: string;
  unifiedPersonId?: string | null;
  contactKey?: string;
}
export interface ContactProfileValue { displayName?: string; username?: string; profileUrl?: string; avatarUrl?: string; bio?: string; }
export interface ContactAffiliationValue { companyRef?: string | null; role?: string; seniority?: string; department?: string; }
export interface ContactChannelEntry { channel: ContactChannelType; value?: string; verified?: boolean; }
export interface ContactChannelsValue { channels?: ContactChannelEntry[]; preferred?: ContactChannelType; }
export interface ContactEngagementValue { totalMessages?: number; totalThreads?: number; lastInteractionAt?: ISOTimestamp; firstInteractionAt?: ISOTimestamp; }
export interface ContactReachabilityValue { reachable?: boolean; distinctChannels?: number; blockedChannels?: string[]; }
export interface ContactAttributionValue { sourceRefs?: string[]; firstSeenSource?: string; }
export interface ContactEvidenceSummaryValue { totalEvidence?: number; freshestAt?: ISOTimestamp; distinctSources?: number; }

export interface ContactFacets {
  identity: Facet<ContactIdentityValue>;
  profile: Facet<ContactProfileValue>;
  affiliation: Facet<ContactAffiliationValue>;
  channels: Facet<ContactChannelsValue>;
  engagement: Facet<ContactEngagementValue>;
  reachability: Facet<ContactReachabilityValue>;
  attribution: Facet<ContactAttributionValue>;
  evidenceSummary: Facet<ContactEvidenceSummaryValue>;
}
export type ContactFacetName = keyof ContactFacets;
export const CONTACT_FACET_NAMES: ContactFacetName[] = [
  'identity', 'profile', 'affiliation', 'channels', 'engagement', 'reachability', 'attribution', 'evidenceSummary',
];

/** TENANT-SCOPED by design — see the identity note in this file's header. */
export interface ContactIdentityKey { companyId: string; contactId: string; }

export interface ContactUnderstanding {
  key: ContactIdentityKey;
  facets: ContactFacets;
  score: ContactScore;
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  graph: { root: GraphNodeRef; edges: GraphEdge[] };
  version: number;
  builtAt: ISOTimestamp;      // passed in (deterministic — never Date.now)
}

export interface ContactProjection {
  key: ContactIdentityKey;
  version: number;
  identity: ContactIdentityValue | null;
  profile: ContactProfileValue | null;
  /** Upward reference to the Canonical Person. `null` when this contact is not yet resolved to one. */
  unifiedPersonId: string | null;
  reachable: boolean;
  channels: ContactChannelType[];
  scores: Record<ContactScoreDimension, number | null>;
  overallScore: number | null;
  confidence: number;
  facetConfidence: Record<ContactFacetName, number>;
  topContradictions: ContradictionRef[];
  projectedAt: ISOTimestamp;
}

// ── Persistence contract (shadow) ──────────────────────────────────────────────────────────────────
export interface ContactUnderstandingShadowRecord {
  company_id: string;
  contact_id: string;
  version: number;
  understanding: ContactUnderstanding;
  projection: ContactProjection;
  parity: number | null;
  built_at: ISOTimestamp;
}

export type ContactEvidence = EvidenceRef;
