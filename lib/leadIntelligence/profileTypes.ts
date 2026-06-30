/**
 * Lead profile shape (pure, type-only) — the fully-hydrated profile the workspace
 * renders. Defined here (not in the backend read service) so both the server
 * (which builds it) and the client (which renders it) import the same contract
 * without the client pulling in any server/DB code.
 */

import type { CanonicalLeadView } from './types';
import type { TimelineEvent } from './timeline';
import type {
  IdentityProjection,
  CampaignProjection,
  JourneyStep,
  ActivityProjection,
  OpportunityProjection,
  MarketPulseProjection,
  CrmProjection,
  EngagementProjection,
  AnalyticsProjection,
} from './projections';
import type { ContentIntelligence } from './contentIntelligence';

export interface LeadProfile {
  leadKey: string;
  view: CanonicalLeadView;
  identity: IdentityProjection;
  campaign: CampaignProjection;
  journey: JourneyStep[];
  content: ContentIntelligence;
  activity: ActivityProjection;
  opportunity: OpportunityProjection;
  marketPulse: MarketPulseProjection;
  crm: CrmProjection;
  engagement: EngagementProjection;
  analytics: AnalyticsProjection;
  timeline: TimelineEvent[];
  summary: string;
  recommendedNextAction: string;
}
