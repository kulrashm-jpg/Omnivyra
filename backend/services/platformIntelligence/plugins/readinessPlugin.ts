/**
 * Readiness Intelligence plugin (Phase 21E). Activation readiness owns only domain scoring
 * (the cms/analytics/leads checks) — it has NO generic executive/recommendation/roadmap/
 * impact builders, so it migrates cleanly: this plugin READS buildActivationReadiness and
 * emits modules + raw inputs; the registry composes everything via the platform engines.
 */
import { buildActivationReadiness } from '../../activationReadinessService';
import { registerPlugin, type IntelligencePlugin, type PluginData, type PluginModule } from '../registry';
import type { ImpactGraphConfig, ImpactDimension } from '../businessImpact';
import type { RawRecommendationInput } from '../recommendations';

type RD = Extract<ImpactDimension, 'marketing' | 'leads' | 'conversion' | 'pipeline'>;

const READINESS_IMPACT_CONFIG: ImpactGraphConfig<RD> = {
  graph: {
    readiness_cms: { dimensions: { marketing: 55, conversion: 40 }, cascade: ['CMS not connected', 'No publishing path', 'Weaker distribution'] },
    readiness_analytics: { dimensions: { marketing: 65 }, cascade: ['Analytics not connected', 'Blind measurement', 'Lower marketing confidence'] },
    readiness_leads: { dimensions: { leads: 75, pipeline: 55, conversion: 45 }, cascade: ['Lead capture not configured', 'No inbound leads', 'Empty pipeline'] },
  },
  moduleDimensions: { cms: { marketing: 50 }, analytics: { marketing: 60 }, leads: { leads: 80, pipeline: 60 } },
  dimensionTail: { marketing: 'marketing readiness', leads: 'lead generation', conversion: 'conversion', pipeline: 'pipeline' },
};

export const readinessPlugin: IntelligencePlugin<RD> = {
  id: 'readiness',
  displayName: 'Activation Readiness',
  domain: 'readiness',
  entityLabel: 'Activation',
  supportedReports: ['snapshot', 'growth'],
  supportedDashboards: ['command-center', 'website-health'],
  impactConfig: READINESS_IMPACT_CONFIG,
  highEffortKeys: new Set(['readiness_cms']),
  async provide({ companyId }): Promise<PluginData> {
    const readiness = await buildActivationReadiness(companyId).catch(() => null as any);
    const checks: any[] = readiness?.checks ?? [];
    const updatedAt = readiness?.generatedAt ?? null;
    const modules: PluginModule[] = checks.map((c) => ({
      key: c.id, label: c.label, source: 'activationReadinessService', score: c.done ? 100 : 0,
      status: (c.done ? 'ready' : 'partial') as PluginModule['status'], available: true, findings: [c.detail || (c.done ? 'Ready' : 'Not configured')], lastUpdated: updatedAt,
    }));
    const inputs: RawRecommendationInput[] = checks.filter((c) => !c.done).map((c) => ({
      key: `readiness_${c.id}`, text: c.nextActionLabel ?? `Complete ${c.label}`, source: 'activationReadinessService', module: c.id, impactLevel: 'high', confidence: 0.9,
    }));
    const done = checks.filter((c) => c.done).length;
    const score = checks.length ? Math.round((done / checks.length) * 100) : 0;
    return { modules, recommendationInputs: inputs, score, lastUpdated: updatedAt };
  },
};

registerPlugin(readinessPlugin);
