import type { BlogGenerationOutput } from '../../../lib/blog/blogGenerationEngine';
import type { CompanyContext } from '../../../lib/blog/blogRunnerTypes';
import { detectGenericContent, type GenericContentDetectionResult } from './genericContentDetector';
import { validateContentDuplication, type ContentDuplicationValidationResult } from './contentDuplicationValidator';
import { validateEditorialBodyStructure, type EditorialBodyStructureValidationResult } from './editorialBodyStructureValidator';
import { validateExecutiveAudience, type ExecutiveAudienceValidationResult } from './executiveAudienceValidator';
import { validateFinalBlogOutcome, type FinalBlogOutcomeValidationResult } from './finalBlogOutcomeValidator';
import {
  buildOrganizationPerspective,
  type OrganizationPerspective,
} from './organizationPerspectiveEngine';
import { validateRebrandResistance, type RebrandResistanceValidationResult } from './rebrandResistanceValidator';
import {
  getQualityProfile,
  duplicationFailsProfile,
  type SeverityMode,
} from './qualityProfiles';
import type { Phase1GateTrigger } from './phase1QualityGates';

export interface FrameworkPresenceResult {
  passed: boolean;
  score: number;
  matchedSignals: string[];
}

export interface ThoughtLeadershipQualityReport {
  companyPovScore: number;
  strategicValueScore: number;
  executiveRelevanceScore: number;
  rebrandResistanceScore: number;
  frameworkPresence: FrameworkPresenceResult;
  genericityScore: number;
  editorialBodyScore: number;
  duplicationScore: number;
  finalOutcomeScore: number;
  passed: boolean;
  /**
   * How the CALLER should treat a failure: 'hard' → throw / block (default,
   * article / blog / guide / whitepaper); 'soft' → warn and ship, routing
   * residual issues through the content type's own quality layer (newsletter).
   */
  severityMode: SeverityMode;
  failures: string[];
  organizationPerspective: OrganizationPerspective;
  rebrandResistance: RebrandResistanceValidationResult;
  genericContent: GenericContentDetectionResult;
  executiveAudience: ExecutiveAudienceValidationResult;
  editorialBody: EditorialBodyStructureValidationResult;
  contentDuplication: ContentDuplicationValidationResult;
  finalOutcome: FinalBlogOutcomeValidationResult;
  /** Phase 1 false-positive prevention gates that fired (empty for clean articles). */
  phase1Gates: Phase1GateTrigger[];
}

export class ThoughtLeadershipQualityGateError extends Error {
  report: ThoughtLeadershipQualityReport;

  constructor(report: ThoughtLeadershipQualityReport) {
    super(`Long-form thought leadership quality gate failed: ${report.failures.join('; ')}`);
    this.name = 'ThoughtLeadershipQualityGateError';
    this.report = report;
  }
}

const FRAMEWORK_SIGNALS = [
  'framework',
  'methodology',
  'maturity model',
  'diagnostic model',
  'evaluation framework',
  'decision framework',
  'model',
  'matrix',
  'scorecard',
  'operating system',
];

const STRATEGIC_TERMS = [
  'strategy',
  'recommend',
  'recommendation',
  'decision',
  'decide',
  'tradeoff',
  'risk',
  'measure',
  'measurable',
  'priority',
  'priorities',
  'sequence',
  'operating model',
  'investment',
  'budget',
  'governance',
  'outcome',
  'resource allocation',
  'pipeline',
  'execution',
];

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function scorePerspectiveCoverage(text: string, perspective: OrganizationPerspective): number {
  const fragments = [
    perspective.companyViewpoint,
    perspective.marketObservation,
    perspective.strategicRecommendation,
    perspective.tradeoffAnalysis,
    perspective.proprietaryInsight,
  ];
  const covered = fragments.filter((fragment) => {
    const terms = fragment.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((term) => term.length > 5).slice(0, 7);
    if (terms.length === 0) return false;
    return terms.filter((term) => text.includes(term)).length >= Math.min(3, terms.length);
  }).length;
  return Math.min(100, covered * 20);
}

function scoreStrategicValue(text: string): number {
  const matched = STRATEGIC_TERMS.filter((term) => text.includes(term));
  const sectionCount = Math.max(1, (text.match(/\b(section|step|phase|model|framework|decision)\b/g) ?? []).length);
  const termScore = Math.min(65, matched.length * 5);
  const actionMatches = text.match(/\b(should|must|avoid|stop|prioritize|sequence|measure|decide|allocate|govern|compare|choose)\b/g) ?? [];
  const actionScore = Math.min(20, actionMatches.length * 4);
  const structureScore = sectionCount >= 4 ? 10 : sectionCount >= 2 ? 5 : 0;
  const executiveOutcomeScore = /\b(revenue|pipeline|margin|budget|cost|risk|retention|conversion|resource allocation|operating model|governance)\b/.test(text) ? 10 : 0;
  return Math.min(100, termScore + actionScore + structureScore + executiveOutcomeScore);
}

function validateFrameworkPresence(contentHtml: string): FrameworkPresenceResult {
  const text = stripHtml(contentHtml).toLowerCase();
  const matchedSignals = FRAMEWORK_SIGNALS.filter((signal) => text.includes(signal));
  const namedPattern = /\b[A-Z][A-Za-z0-9&-]+(?:\s+[A-Z][A-Za-z0-9&-]+){1,5}\s+(Framework|Methodology|Model|Matrix|Scorecard|System)\b/;
  const named = namedPattern.test(stripHtml(contentHtml));
  const score = Math.min(100, matchedSignals.length * 15 + (named ? 40 : 0));
  return {
    passed: named || matchedSignals.some((signal) => signal !== 'model'),
    score,
    matchedSignals,
  };
}

export function evaluateThoughtLeadershipQuality(input: {
  output: BlogGenerationOutput;
  companyContext?: CompanyContext;
  organizationPerspective?: OrganizationPerspective;
  /**
   * Content type used to resolve the quality profile. Omitted / unknown →
   * default profile, which reproduces the original gate behavior verbatim
   * (article / blog / guide are byte-identical to before profiles existed).
   */
  contentType?: string;
}): ThoughtLeadershipQualityReport {
  const profile = getQualityProfile(input.contentType);
  const perspective = input.organizationPerspective ?? buildOrganizationPerspective({
    topic: input.output.title,
    companyContext: input.companyContext,
  });
  const text = stripHtml(input.output.content_html).toLowerCase();
  let frameworkPresence = validateFrameworkPresence(input.output.content_html);
  const genericContent = detectGenericContent(input.output.content_html);
  const editorialBody = validateEditorialBodyStructure(input.output.content_html);
  const contentDuplication = validateContentDuplication(input.output.content_html);
  const finalOutcome = validateFinalBlogOutcome({
    output: input.output,
    organizationPerspective: perspective,
    profile,
  });
  // Framework Delivery Gate (Phase 1): a framework claimed but not delivered
  // caps the framework subscore and fails the framework subcheck. The overall
  // score cap is already applied inside validateFinalBlogOutcome.
  if (finalOutcome.frameworkScoreCap !== null) {
    frameworkPresence = {
      ...frameworkPresence,
      passed: false,
      score: Math.min(frameworkPresence.score, finalOutcome.frameworkScoreCap),
    };
  }
  const executiveAudience = validateExecutiveAudience({
    contentHtml: input.output.content_html,
    primaryAudience: perspective.primaryAudience,
  });
  const rebrandResistance = validateRebrandResistance({
    contentHtml: input.output.content_html,
    companyName: input.companyContext?.companyName,
    uniqueValue: input.companyContext?.uniqueValue,
    competitiveAdvantages: input.companyContext?.competitiveAdvantages,
    coreProblem: input.companyContext?.coreProblemStatement,
    perspective,
  });
  const companyPovScore = scorePerspectiveCoverage(text, perspective);
  const strategicValueScore = scoreStrategicValue(text);
  const enabledSubchecks = profile.enabledSubchecks;
  const thresholds = profile.thresholds;
  const finalOutcomeAggregateThreshold = profile.thresholds.finalOutcomeAggregate;
  const failures: string[] = [];
  // Each subcheck is gated by the profile. The default profile enables ALL of
  // them at the original thresholds, so article / blog / guide are unchanged.
  if (enabledSubchecks.has('companyPov') && companyPovScore < thresholds.companyPov) failures.push(`POV ${companyPovScore} < ${thresholds.companyPov}`);
  if (enabledSubchecks.has('strategicValue') && strategicValueScore < thresholds.strategicValue) failures.push(`Strategic ${strategicValueScore} < ${thresholds.strategicValue}`);
  if (enabledSubchecks.has('executiveAudience') && !executiveAudience.passed) failures.push(`Executive ${executiveAudience.score} < 75`);
  if (enabledSubchecks.has('rebrandResistance') && !rebrandResistance.passed) failures.push(`Rebrand ${rebrandResistance.score} < 70`);
  if (enabledSubchecks.has('frameworkPresence') && !frameworkPresence.passed) failures.push('Framework presence FAIL');
  if (enabledSubchecks.has('genericContent') && !genericContent.passed) failures.push(`Genericity ${genericContent.score} > 30`);
  if (enabledSubchecks.has('editorialBody') && !editorialBody.passed) failures.push(`Editorial body ${editorialBody.score} < 75`);
  if (enabledSubchecks.has('contentDuplication') && duplicationFailsProfile(contentDuplication, profile)) failures.push(`Duplication ${contentDuplication.score} > ${thresholds.duplicationMaxScore}`);
  if (enabledSubchecks.has('finalOutcome') && !finalOutcome.passed) {
    failures.push(
      finalOutcome.score < finalOutcomeAggregateThreshold
        ? `Final outcome ${finalOutcome.score} < ${finalOutcomeAggregateThreshold}: ${finalOutcome.issues.join(', ')}`
        : `Final outcome subchecks failed at aggregate ${finalOutcome.score}: ${finalOutcome.issues.join(', ')}`,
    );
  }

  // Phase 1 gate telemetry — explains exactly which gate fired, the triggering
  // text, and the resulting score cap. Emitted once per evaluation when any
  // gate is active so editors/observability can see WHY a score was capped.
  if (finalOutcome.gates.length > 0) {
    console.warn('[phase1-quality-gate]', JSON.stringify({
      event: 'PHASE1_GATE_TRIGGERED',
      title: input.output.title,
      score_cap: Math.min(...finalOutcome.gates.map((g) => g.scoreCap)),
      capped_score: finalOutcome.score,
      gates: finalOutcome.gates.map((g) => ({
        gate: g.gate,
        detector: g.detector,
        severity: g.severity,
        score_cap: g.scoreCap,
        triggering_text: g.triggeringText,
      })),
    }));
  }

  return {
    severityMode: profile.severityMode,
    companyPovScore,
    strategicValueScore,
    executiveRelevanceScore: executiveAudience.score,
    rebrandResistanceScore: rebrandResistance.score,
    frameworkPresence,
    genericityScore: genericContent.score,
    editorialBodyScore: editorialBody.score,
    duplicationScore: contentDuplication.score,
    finalOutcomeScore: finalOutcome.score,
    passed: failures.length === 0,
    failures,
    organizationPerspective: perspective,
    rebrandResistance,
    genericContent,
    executiveAudience,
    editorialBody,
    contentDuplication,
    finalOutcome,
    phase1Gates: finalOutcome.gates,
  };
}

export function assertThoughtLeadershipQuality(input: {
  output: BlogGenerationOutput;
  companyContext?: CompanyContext;
  organizationPerspective?: OrganizationPerspective;
}): ThoughtLeadershipQualityReport {
  const report = evaluateThoughtLeadershipQuality(input);
  if (!report.passed) {
    throw new ThoughtLeadershipQualityGateError(report);
  }
  return report;
}
