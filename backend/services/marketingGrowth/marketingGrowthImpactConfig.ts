/**
 * Marketing & Growth business-impact configuration (Phase 22). Config only — the Platform
 * Business Impact Engine owns the machinery. Maps marketing/growth gaps to their downstream
 * dimensions + deterministic cascade.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type MGDimension = Extract<ImpactDimension, 'marketing' | 'traffic' | 'leads' | 'qualified_leads' | 'conversion' | 'pipeline' | 'revenue' | 'content' | 'community' | 'brand' | 'seo' | 'authority'>;

export const MG_IMPACT_CONFIG: ImpactGraphConfig<MGDimension> = {
  graph: {
    improve_website: { dimensions: { marketing: 50, conversion: 40, seo: 40 }, cascade: ['Weak website', 'Lower conversion foundation', 'Lower marketing ROI'] },
    enable_lead_capture: { dimensions: { leads: 80, pipeline: 60, conversion: 50 }, cascade: ['No lead capture', 'No funnel entry', 'Empty pipeline'] },
    connect_analytics: { dimensions: { marketing: 70 }, cascade: ['No analytics', 'Blind spend', 'Lower marketing confidence'] },
    increase_content: { dimensions: { content: 60, traffic: 55, seo: 45 }, cascade: ['Low content output', 'Less organic reach', 'Weaker growth'] },
    grow_community: { dimensions: { community: 60, marketing: 40 }, cascade: ['Weak community', 'Less advocacy', 'Fewer referrals'] },
    improve_qualification: { dimensions: { qualified_leads: 70, conversion: 55, pipeline: 50 }, cascade: ['Low qualification', 'Funnel leak', 'Weaker pipeline'] },
    instrument_revenue: { dimensions: { revenue: 65, marketing: 50 }, cascade: ['Revenue not instrumented', 'No CAC/ROAS', 'Unprovable ROI'] },
    advance_maturity: { dimensions: { marketing: 60, authority: 40 }, cascade: ['Low marketing maturity', 'Fragmented execution', 'Slower growth'] },
    activate_channels: { dimensions: { marketing: 60, traffic: 55, leads: 45 }, cascade: ['Channels not activated', 'Limited reach', 'Fewer leads'] },
  },
  moduleDimensions: {
    website: { marketing: 50, conversion: 40 }, lead_capture: { leads: 80, pipeline: 60 }, content: { content: 70, traffic: 50 },
    campaigns: { marketing: 60 }, engagement: { conversion: 55, marketing: 45 }, community: { community: 60, marketing: 40 },
    analytics: { marketing: 65 }, funnel: { conversion: 65, qualified_leads: 60 }, revenue: { revenue: 70, pipeline: 50 },
    pipeline: { pipeline: 70, revenue: 55 }, maturity: { marketing: 60 }, channel_paid: { marketing: 55, traffic: 50 },
    seo: { seo: 70, traffic: 50 }, brand: { brand: 60, authority: 50 }, competitive: { authority: 55, marketing: 45 },
  },
  dimensionTail: {
    marketing: 'marketing performance', traffic: 'traffic', leads: 'lead generation', qualified_leads: 'qualified pipeline',
    conversion: 'conversion', pipeline: 'pipeline', revenue: 'revenue', content: 'content output', community: 'community',
    brand: 'brand strength', seo: 'search visibility', authority: 'authority',
  },
};

export const MG_LOW_EFFORT = new Set(['connect_analytics', 'enable_lead_capture']);
export const MG_HIGH_EFFORT = new Set(['instrument_revenue', 'advance_maturity', 'activate_channels']);
