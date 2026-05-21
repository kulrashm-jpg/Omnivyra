import type { AssimilatedEditorialPrimitives } from './companyAssimilationMiddleware';
import type { AudienceMaturityIntelligence } from './audienceMaturityIntelligence';
import type { EditorialAuthorityIntelligence } from './editorialAuthorityIntelligence';
import type { EditorialDepthIntelligence } from './editorialDepthIntelligence';
import type { GenerationGuidanceContract } from './generationGuidanceContracts';
import type { NarrativePlanningOutput } from './narrativePlanningEngine';
import type { OmnivyraDoctrineGenerationContext } from './omnivyraEditorialDoctrine';
import { serializeUnifiedEditorialBrief, type UnifiedEditorialBrief } from './unifiedEditorialBriefAssembler';

export interface RuntimePriorityEntry {
  layer: string;
  priority: 'canonical' | 'primary' | 'secondary' | 'compatibility' | 'debug';
  retention: 'full-compact' | 'summary' | 'debug-only';
}

export interface EditorialRuntimeContext {
  version: 'editorial-runtime-context-prioritizer-v1';
  canonicalGenerationContext: string;
  primaryEditorialSignals: readonly string[];
  secondaryEditorialSignals: readonly string[];
  compatibilitySignals: readonly string[];
  debugSignals: readonly string[];
  runtimePriorityMap: readonly RuntimePriorityEntry[];
  signalCompressionSummary: readonly string[];
  layerRetentionPolicy: readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(values: readonly string[], limit = 8): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = clean(raw);
    if (!value) continue;
    const key = normalizeKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

export function prioritizeEditorialRuntimeContext(input: {
  unifiedEditorialBrief: UnifiedEditorialBrief;
  doctrine: OmnivyraDoctrineGenerationContext;
  assimilation: AssimilatedEditorialPrimitives;
  narrativePlanning: NarrativePlanningOutput;
  generationGuidance: GenerationGuidanceContract;
  editorialDepth: EditorialDepthIntelligence;
  editorialAuthority: EditorialAuthorityIntelligence;
  audienceMaturity: AudienceMaturityIntelligence;
}): EditorialRuntimeContext {
  const {
    unifiedEditorialBrief,
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
    editorialAuthority,
    audienceMaturity,
  } = input;

  const primaryEditorialSignals = compact([
    `Canonical section briefs: ${unifiedEditorialBrief.sections.length}`,
    `Progression stages: ${unifiedEditorialBrief.progressionStages.join(' -> ')}`,
    `Reader-state targets: ${unifiedEditorialBrief.sections[0]?.sectionReaderStateTarget || 'none'} ... ${unifiedEditorialBrief.sections[unifiedEditorialBrief.sections.length - 1]?.sectionReaderStateTarget || 'none'}`,
    `Authority calibration: ${editorialAuthority.maturityStage}`,
    `Audience sophistication: ${audienceMaturity.audienceSophisticationLevel}`,
    `Differentiation anchor: ${assimilation.differentiatorLogic.primary}`,
  ], 8);

  const secondaryEditorialSignals = compact([
    `Worldview: ${doctrine.worldview.thesis}`,
    `Buyer tension: ${assimilation.buyerTension.statement}`,
    `Operating pain: ${assimilation.operatingPain.primary}`,
    `Anti-repetition rules: ${narrativePlanning.antiRepetitionRules.join('; ')}`,
    `Global forbidden moves: ${generationGuidance.globalForbiddenNarrativeMoves.slice(0, 4).join('; ')}`,
  ], 8);

  const compatibilitySignals = compact([
    `## OMNIVYRA EDITORIAL DOCTRINE :: Worldview: ${doctrine.worldview.thesis}; Strategic beliefs: ${doctrine.strategicBeliefs.slice(0, 3).join('; ')}; Forbidden framing: ${doctrine.forbiddenGenericFraming.slice(0, 3).join('; ')}; Approved POV patterns: ${doctrine.approvedPovArchetypes.slice(0, 3).map((pov) => pov.label).join('; ')}`,
    `## COMPANY ASSIMILATION PRIMITIVES :: Buyer tension: ${assimilation.buyerTension.statement}; Authority claim: ${assimilation.authorityClaim.claim}; Approved company POV angles: ${assimilation.approvedPovAngles.slice(0, 3).map((angle) => angle.angle).join('; ')}`,
    `## NARRATIVE PLANNING PRIMITIVES :: Progression stages: ${narrativePlanning.progressionStages.join(' -> ')}; Section roles: ${narrativePlanning.sections.map((section) => `${section.progressionStage}:${section.narrativeRole}`).join('; ')}`,
    `## GENERATOR GUIDANCE CONTRACT :: sections=${generationGuidance.sections.length}; Global forbidden moves: ${generationGuidance.globalForbiddenNarrativeMoves.slice(0, 2).join('; ')}; Section contracts: retained as unified brief`,
    `## EDITORIAL DEPTH INTELLIGENCE :: maturity=${editorialDepth.maturityStage}; Global depth expectations: ${editorialDepth.globalDepthExpectations[0]}; Section depth primitives: retained as unified brief`,
    `## EDITORIAL AUTHORITY INTELLIGENCE :: maturity=${editorialAuthority.maturityStage}; Global authority expectations: ${editorialAuthority.globalAuthorityExpectations[0]}; Section authority primitives: retained as unified brief`,
    `## AUDIENCE MATURITY INTELLIGENCE :: level=${audienceMaturity.audienceSophisticationLevel}; Global maturity expectations: ${audienceMaturity.globalMaturityExpectations[0]}; Section maturity primitives: retained as unified brief`,
  ], 10);

  const debugSignals = compact([
    `Doctrine beliefs retained: ${doctrine.strategicBeliefs.length}`,
    `Assimilation completeness: ${assimilation.completeness.level}`,
    `Narrative plan version: ${narrativePlanning.version}`,
    `Guidance contract version: ${generationGuidance.version}`,
    `Depth version: ${editorialDepth.version}`,
    `Authority version: ${editorialAuthority.version}`,
    `Audience maturity version: ${audienceMaturity.version}`,
    `Unified brief version: ${unifiedEditorialBrief.version}`,
  ], 10);

  return deepFreeze({
    version: 'editorial-runtime-context-prioritizer-v1',
    canonicalGenerationContext: serializeUnifiedEditorialBrief(unifiedEditorialBrief),
    primaryEditorialSignals,
    secondaryEditorialSignals,
    compatibilitySignals,
    debugSignals,
    runtimePriorityMap: [
      { layer: 'unifiedEditorialBrief', priority: 'canonical', retention: 'full-compact' },
      { layer: 'doctrine', priority: 'secondary', retention: 'summary' },
      { layer: 'assimilation', priority: 'secondary', retention: 'summary' },
      { layer: 'narrativePlanning', priority: 'secondary', retention: 'summary' },
      { layer: 'generationGuidance', priority: 'compatibility', retention: 'summary' },
      { layer: 'editorialDepth', priority: 'compatibility', retention: 'summary' },
      { layer: 'editorialAuthority', priority: 'compatibility', retention: 'summary' },
      { layer: 'audienceMaturity', priority: 'compatibility', retention: 'summary' },
    ],
    signalCompressionSummary: [
      'Unified editorial brief is retained as the canonical runtime context.',
      'Lower-priority layers are summarized to reduce duplicated guidance and prompt dilution.',
      'Compatibility signals preserve stable layer visibility for future generators and validators.',
      'Debug signals preserve layer versions and completeness without full raw prompt expansion.',
    ],
    layerRetentionPolicy: [
      'canonical: full compact unified brief',
      'primary: runtime signals required for generation emphasis',
      'secondary: doctrine, company, and planning summaries',
      'compatibility: compact source-layer visibility',
      'debug: versions, counts, and completeness only',
    ],
  });
}

export function serializeEditorialRuntimeContext(context: EditorialRuntimeContext): string {
  return [
    '## PRIMARY EDITORIAL RUNTIME CONTEXT',
    `Version: ${context.version}`,
    'Canonical generation context:',
    context.canonicalGenerationContext,
    '## EDITORIAL RUNTIME PRIORITIES',
    `Primary editorial signals: ${context.primaryEditorialSignals.join('; ')}`,
    `Secondary editorial signals: ${context.secondaryEditorialSignals.join('; ')}`,
    `Signal compression summary: ${context.signalCompressionSummary.join('; ')}`,
    `Layer retention policy: ${context.layerRetentionPolicy.join('; ')}`,
    `Runtime priority map: ${context.runtimePriorityMap.map((entry) => `${entry.layer}:${entry.priority}/${entry.retention}`).join('; ')}`,
    '## EDITORIAL COMPATIBILITY SIGNALS',
    context.compatibilitySignals.join('\n'),
    '## EDITORIAL DEBUG SIGNALS',
    context.debugSignals.join('\n'),
  ].join('\n');
}
