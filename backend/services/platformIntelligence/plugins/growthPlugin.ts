/**
 * Growth Intelligence plugin (Phase 21D). Consumer #3 of the Platform Intelligence
 * Framework. READS the existing growthIntelligenceService summary and emits modules + raw
 * recommendation inputs; the registry composes everything via the platform engines. No
 * generic intelligence here — only the growth impact config + a data provider.
 */
import { supabase } from '../../../db/supabaseClient';
import { getGrowthIntelligenceSummary } from '../../growthIntelligence/growthIntelligenceService';
import { registerPlugin, type IntelligencePlugin, type PluginData, type PluginModule } from '../registry';
import type { ImpactGraphConfig, ImpactDimension } from '../businessImpact';
import type { RawRecommendationInput } from '../recommendations';

type GD = Extract<ImpactDimension, 'marketing' | 'conversion' | 'traffic' | 'revenue' | 'content' | 'leads'>;

const GROWTH_IMPACT_CONFIG: ImpactGraphConfig<GD> = {
  graph: {
    weak_content_velocity: { dimensions: { content: 60, traffic: 50, marketing: 40 }, cascade: ['Low content velocity', 'Less organic reach', 'Weaker growth momentum'] },
    low_publishing_reliability: { dimensions: { marketing: 60, traffic: 40 }, cascade: ['Publishing failures', 'Missed distribution', 'Lower reach'] },
    low_engagement: { dimensions: { conversion: 65, marketing: 50 }, cascade: ['Low engagement', 'Weaker audience signal', 'Lower conversion'] },
    weak_community: { dimensions: { marketing: 55, leads: 40 }, cascade: ['Weak community activity', 'Less advocacy', 'Fewer inbound leads'] },
    low_opportunity_activation: { dimensions: { leads: 65, revenue: 55, conversion: 45 }, cascade: ['Few activated opportunities', 'Thinner pipeline', 'Lower revenue'] },
  },
  moduleDimensions: {
    content_velocity: { content: 70, traffic: 50 }, publishing: { marketing: 50, traffic: 40 },
    engagement: { conversion: 60, marketing: 50 }, community: { marketing: 50, leads: 40 }, opportunity: { leads: 60, revenue: 50 },
  },
  dimensionTail: { marketing: 'marketing momentum', conversion: 'conversion', traffic: 'traffic', revenue: 'revenue', content: 'content output', leads: 'lead generation' },
};

const norm = (v: number, max: number): number => Math.max(0, Math.min(100, Math.round((v / max) * 100)));
const statusFromScore = (s: number | null): 'ready' | 'partial' | 'unavailable' => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');

export const growthPlugin: IntelligencePlugin<GD> = {
  id: 'growth',
  displayName: 'Growth Intelligence',
  domain: 'growth',
  entityLabel: 'Growth',
  supportedReports: ['growth', 'snapshot'],
  supportedDashboards: ['growth-intelligence'],
  impactConfig: GROWTH_IMPACT_CONFIG,
  lowEffortKeys: new Set(['low_publishing_reliability']),
  highEffortKeys: new Set(['low_opportunity_activation', 'weak_content_velocity']),
  async provide({ companyId }): Promise<PluginData> {
    const summary = await getGrowthIntelligenceSummary(supabase, companyId).catch(() => null);
    if (!summary) {
      const modules: PluginModule[] = ['content_velocity', 'publishing', 'engagement', 'community', 'opportunity'].map((k) => ({ key: k, label: k.replace('_', ' '), source: 'growthIntelligenceService', score: null, status: 'unavailable' as const, available: false, findings: ['No growth data'], lastUpdated: null }));
      return { modules, recommendationInputs: [], score: 0, lastUpdated: null };
    }
    const b = summary.scoreBreakdown;
    const defs: Array<[string, string, number, number]> = [
      ['content_velocity', 'Content Velocity', b.contentVelocity, 20],
      ['publishing', 'Publishing Reliability', b.publishing, 25],
      ['engagement', 'Engagement', b.engagement, 30],
      ['community', 'Community', b.community, 15],
      ['opportunity', 'Opportunity Activation', b.opportunity, 10],
    ];
    const modules: PluginModule[] = defs.map(([key, label, v, max]) => {
      const score = norm(v, max);
      return { key, label, source: 'growthIntelligenceService', score, status: statusFromScore(score), available: true, findings: [`${label} contributes ${v}`], lastUpdated: null };
    });
    const inputs: RawRecommendationInput[] = [];
    const recMap: Record<string, [string, string]> = {
      content_velocity: ['weak_content_velocity', 'Increase content velocity to build growth momentum.'],
      publishing: ['low_publishing_reliability', 'Fix publishing failures to protect distribution.'],
      engagement: ['low_engagement', 'Improve content engagement to lift conversion.'],
      community: ['weak_community', 'Grow community activity to drive advocacy.'],
      opportunity: ['low_opportunity_activation', 'Activate more opportunities into the pipeline.'],
    };
    for (const m of modules) if (m.score != null && m.score < 50) { const [key, text] = recMap[m.key]!; inputs.push({ key, text, source: 'growthIntelligenceService', module: m.key, impactLevel: 'medium', confidence: 0.85 }); }
    return { modules, recommendationInputs: inputs, score: summary.growthScore ?? 0, lastUpdated: null };
  },
};

registerPlugin(growthPlugin);
