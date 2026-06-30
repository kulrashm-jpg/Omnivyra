/**
 * Partner & Channel business-impact configuration (Phase 35). Config only — the Platform
 * Business Impact Engine owns the machinery.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type ChannelDimension = Extract<ImpactDimension, 'marketing' | 'leads' | 'qualified_leads' | 'conversion' | 'revenue' | 'pipeline'>;

export const CHANNEL_IMPACT_CONFIG: ImpactGraphConfig<ChannelDimension> = {
  graph: {
    instrument_attribution: { dimensions: { marketing: 70, leads: 50 }, cascade: ['No channel attribution', 'Blind acquisition', 'Misallocated budget'] },
    fix_attribution: { dimensions: { marketing: 60, leads: 45 }, cascade: ['Attribution gaps', 'Untrusted channel data', 'Poor budget decisions'] },
    diversify_channels: { dimensions: { marketing: 60, leads: 55, revenue: 45 }, cascade: ['Single-channel dependency', 'Acquisition risk', 'Fragile growth'] },
    add_acquisition_channels: { dimensions: { leads: 60, marketing: 55 }, cascade: ['Few channels', 'Limited reach', 'Capped lead flow'] },
    instrument_channel_revenue: { dimensions: { revenue: 60, marketing: 45 }, cascade: ['No per-channel ROI', 'Blind spend allocation', 'Suboptimal revenue'] },
    resolve_channel_bottleneck: { dimensions: { conversion: 60, qualified_leads: 50 }, cascade: ['Channel bottleneck', 'Funnel leak', 'Lower conversion'] },
  },
  moduleDimensions: {
    organic_health: { marketing: 55, leads: 50 }, paid_health: { marketing: 55, leads: 50 }, social_health: { marketing: 55, leads: 45 },
    email_health: { marketing: 50, leads: 45 }, referral_health: { leads: 55, marketing: 45 }, direct_health: { marketing: 40 }, community_health: { marketing: 50, leads: 40 },
    partner_health: { leads: 55, revenue: 45 }, campaign_health: { marketing: 60 }, attribution_confidence: { marketing: 55 },
    channel_diversity: { marketing: 50, leads: 50 }, channel_dependency: { leads: 55, revenue: 45 }, acquisition_risk: { leads: 55, marketing: 45 },
    lead_quality_by_channel: { qualified_leads: 60, conversion: 45 }, qualified_lead_rate: { qualified_leads: 65 }, pipeline_contribution: { pipeline: 60, leads: 50 },
    revenue_contribution: { revenue: 70 }, channel_health: { marketing: 55, leads: 50 }, channel_maturity: { marketing: 45, leads: 40 },
  },
  dimensionTail: { marketing: 'channel performance', leads: 'lead acquisition', qualified_leads: 'qualified pipeline', conversion: 'conversion', revenue: 'revenue', pipeline: 'pipeline' },
};

export const CHANNEL_LOW_EFFORT = new Set(['fix_attribution', 'resolve_channel_bottleneck']);
export const CHANNEL_HIGH_EFFORT = new Set(['instrument_attribution', 'add_acquisition_channels', 'instrument_channel_revenue']);
