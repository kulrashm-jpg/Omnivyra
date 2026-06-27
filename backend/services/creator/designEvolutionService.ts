/**
 * Design Evolution Service — read-only analysis that turns measured performance
 * + diagnostics into structured recommendations. It NEVER mutates templates or
 * collections on its own; "accept" routes through the EXISTING collection
 * versioning (a new version), which the owner approves. Reuses Performance
 * Intelligence + the pure evolution engine. No duplicate analytics.
 */

import type { CreatorTemplate, TemplateAssetFamily } from '../../../lib/creator-templates';
import {
  type EvolutionAnalysis,
  type EvolutionInput,
  type TemplatePerfInput,
  type EvolutionRecommendation,
} from '../../../lib/creator-templates/designEvolution';
import { blueprintCoverage, STORY_BLUEPRINTS } from '../../../lib/creator-templates/storyBlueprint';
import {
  analyzeEvolution,
} from '../../../lib/creator-templates/designEvolution';
import type { PerfRollup } from '../../../lib/creator-templates/designPerformance';
import { getCollection, buildResolver, removeTemplateFromCollection, replaceTemplateInCollection } from './collectionService';
import { getCampaignDesignSystem } from './campaignDesignSystemService';
import { getCampaignDesignPerformance, getCompanyDesignPerformance, type ScoredRollup } from './designPerformanceService';

function visualConsistency(members: CreatorTemplate[]): 'strong' | 'weak' | 'unknown' {
  if (members.length < 2) return 'unknown';
  const typ = new Set(members.map((m) => m.visualLanguage.typographyWeight ?? '∅'));
  const den = new Set(members.map((m) => m.visualLanguage.densityBias ?? '∅'));
  return typ.size === 1 && den.size === 1 ? 'strong' : 'weak';
}

function diagnosticOf(t: CreatorTemplate): TemplatePerfInput['diagnostic'] {
  const report = (t.metadata as Record<string, unknown> | undefined)?.creator_diagnostic_report as
    | { reportVersion?: string; visualValidation?: { passed?: boolean }; scores?: { overallReadiness?: { value?: number } } } | undefined;
  if (!report || !report.reportVersion) return null;
  return { reportVersion: report.reportVersion, visualValidation: report.visualValidation, overallReadiness: report.scores?.overallReadiness?.value };
}

const EMPTY_ROLLUP = (key: string): PerfRollup => ({
  key, assetCount: 0, impressions: 0, reach: 0, engagement: 0, clicks: 0, saves: 0, shares: 0, comments: 0, conversions: 0,
  engagementRate: 0, ctr: 0, saveRate: 0, shareRate: 0, conversionRate: 0, byPlatform: [],
});

/** Map collection members + template rollups → the engine's member inputs. */
function buildMembers(members: CreatorTemplate[], templateRollups: ScoredRollup[]): TemplatePerfInput[] {
  const byId = new Map(templateRollups.map((r) => [r.key, r]));
  return members.map((t) => {
    const r = byId.get(t.id);
    return {
      templateId: t.id,
      family: t.assetFamily,
      rollup: r ?? EMPTY_ROLLUP(t.id),
      score: r?.performance.score ?? 0,
      diagnostic: diagnosticOf(t),
    };
  });
}

async function analyze(collectionId: string, templateRollups: ScoredRollup[], requiredFamilies: TemplateAssetFamily[], targetPlatforms: string[], audience: string | null): Promise<EvolutionAnalysis | null> {
  const collection = await getCollection(collectionId);
  if (!collection) return null;
  const resolve = await buildResolver(collection.templateIds);
  const members = collection.templateIds.map(resolve).filter((t): t is CreatorTemplate => t !== null);
  const presentFamilies = Array.from(new Set(members.map((m) => m.assetFamily)));
  const input: EvolutionInput = {
    collectionId,
    members: buildMembers(members, templateRollups),
    presentFamilies,
    requiredFamilies,
    visualConsistency: visualConsistency(members),
    targetPlatforms,
    audience,
  };
  const analysis = analyzeEvolution(input);

  // Story Blueprint coverage → deterministic communication-pattern guidance
  // (additive recommendations; acceptance still flows through existing versioning).
  const cov = blueprintCoverage(members);
  const blueprintRecs: EvolutionRecommendation[] = [];
  for (const id of cov.missing) {
    const bp = STORY_BLUEPRINTS[id];
    blueprintRecs.push({
      id: `blueprint-add:${id}`, type: 'add_blueprint', title: `Add a ${bp.label} narrative`,
      evidence: [`Collection has no ${bp.label} communication pattern`], impactedMetrics: ['Blueprint coverage'],
      expectedBenefit: `Cover the ${bp.label} story flow (${bp.narrativeFlow.join(' → ')})`,
      confidence: { level: 'medium', value: 0.5 }, family: null,
    });
  }
  for (const id of cov.duplicates) {
    const bp = STORY_BLUEPRINTS[id];
    blueprintRecs.push({
      id: `blueprint-diversify:${id}`, type: 'diversify_blueprint', title: `Diversify duplicate ${bp.label} narratives`,
      evidence: [`Multiple members share the ${bp.label} communication pattern`], impactedMetrics: ['Narrative diversity'],
      expectedBenefit: 'Reduce redundancy; broaden the communication mix',
      confidence: { level: 'low', value: 0.35 }, family: null,
    });
  }
  return { ...analysis, recommendations: [...analysis.recommendations, ...blueprintRecs] };
}

/** Campaign dashboard evolution analysis. */
export async function analyzeCampaignEvolution(campaignId: string): Promise<EvolutionAnalysis | null> {
  const ds = await getCampaignDesignSystem(campaignId);
  if (!ds) return null;
  const perf = await getCampaignDesignPerformance(campaignId);
  return analyze(ds.collectionId, perf.templates, ds.requiredFamilies, [], null);
}

/** Collection editor evolution analysis (company-wide performance). */
export async function analyzeCollectionEvolution(collectionId: string, companyId: string): Promise<EvolutionAnalysis | null> {
  const perf = await getCompanyDesignPerformance(companyId);
  return analyze(collectionId, perf.templates, ['image', 'carousel', 'infographic'], [], null);
}

/**
 * Accept a recommendation — applies ONLY deterministic membership actions
 * (replace / retire) through the EXISTING collection versioning (one new
 * version). Recommendations that need a new template (create/add/variant) are
 * guidance only and return null (the engine never creates templates).
 */
export async function acceptEvolutionRecommendation(collectionId: string, rec: EvolutionRecommendation) {
  if (rec.action?.op === 'remove') return removeTemplateFromCollection(collectionId, rec.action.templateId);
  if (rec.action?.op === 'replace' && rec.action.replacementTemplateId) {
    return replaceTemplateInCollection(collectionId, rec.action.templateId, rec.action.replacementTemplateId);
  }
  return null; // non-membership recommendation — surfaced as guidance, not auto-applied
}
