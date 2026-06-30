/**
 * Lead Intelligence business-impact configuration (Phase 21C, Phase D).
 *
 * Consumer #2 of the Platform Business Impact Engine. This file owns ONLY the lead-specific
 * relationship graph + module-dimension defaults + dimension labels; the machinery lives in
 * platformIntelligence/businessImpact. No second graph engine is built.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type LeadImpactDimension = Extract<ImpactDimension, 'leads' | 'qualified_leads' | 'pipeline' | 'revenue' | 'conversion' | 'retention' | 'marketing'>;

const MODULE_DIMENSIONS: Record<string, Partial<Record<LeadImpactDimension, number>>> = {
  buying_intent: { pipeline: 70, revenue: 60, conversion: 50 },
  qualification: { qualified_leads: 80, pipeline: 60 },
  identity: { leads: 60, marketing: 40 },
  attribution: { marketing: 70, leads: 40 },
  company: { pipeline: 60, qualified_leads: 50 },
  journey: { conversion: 50, leads: 40 },
  lead_readiness: { leads: 80, pipeline: 60 },
  pipeline: { pipeline: 80, revenue: 60 },
  follow_up: { conversion: 60, retention: 50 },
};

const RELATIONSHIP_GRAPH: Record<string, { dimensions: Partial<Record<LeadImpactDimension, number>>; cascade: string[] }> = {
  low_buying_intent: { dimensions: { pipeline: 60, revenue: 55, conversion: 50 }, cascade: ['Low buying intent', 'Weaker pipeline', 'Fewer qualified opportunities', 'Lower revenue confidence'] },
  missing_contact: { dimensions: { leads: 70, conversion: 50 }, cascade: ['Missing contact details', 'Unreachable lead', 'Lower conversion'] },
  no_owner: { dimensions: { pipeline: 60, conversion: 45 }, cascade: ['No lead owner', 'Slower follow-up', 'Stalled pipeline'] },
  no_follow_up: { dimensions: { conversion: 65, retention: 50, revenue: 45 }, cascade: ['No follow-up', 'Lead decay', 'Lower conversion'] },
  weak_qualification: { dimensions: { qualified_leads: 70, pipeline: 55 }, cascade: ['Weak qualification', 'Unqualified pipeline', 'Wasted sales effort'] },
  no_engagement: { dimensions: { leads: 60, conversion: 45 }, cascade: ['No engagement', 'Cold lead', 'Lower conversion'] },
  no_decision_maker: { dimensions: { qualified_leads: 65, pipeline: 55, revenue: 45 }, cascade: ['No decision maker identified', 'Single-threaded deal', 'Higher close risk'] },
  no_company: { dimensions: { qualified_leads: 50, pipeline: 40 }, cascade: ['No company resolved', 'Weaker account view', 'Harder qualification'] },
  no_opportunity: { dimensions: { pipeline: 70, revenue: 60 }, cascade: ['No opportunity', 'Empty pipeline', 'No revenue path'] },
};

const DIMENSION_TAIL: Record<LeadImpactDimension, string> = {
  leads: 'lead volume', qualified_leads: 'qualified pipeline', pipeline: 'pipeline', revenue: 'revenue confidence',
  conversion: 'conversion', retention: 'retention', marketing: 'marketing intelligence',
};

export const LEAD_IMPACT_CONFIG: ImpactGraphConfig<LeadImpactDimension> = { graph: RELATIONSHIP_GRAPH, moduleDimensions: MODULE_DIMENSIONS, dimensionTail: DIMENSION_TAIL };

export const LEAD_LOW_EFFORT = new Set(['missing_contact', 'no_owner', 'no_follow_up', 'enrich_identity']);
export const LEAD_HIGH_EFFORT = new Set(['no_decision_maker', 'no_opportunity', 'weak_qualification']);
