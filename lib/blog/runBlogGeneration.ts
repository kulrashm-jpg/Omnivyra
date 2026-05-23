/**
 * runBlogGeneration
 *
 * COMPATIBILITY CORE:
 * Public long-form callers should use lib/content/unifiedLongFormEngine.ts.
 * This module remains as the existing generation core while architecture is
 * consolidated behind the unified facade.
 *
 * Single source of truth for all blog generation logic.
 * Called by:
 *   - /api/admin/blog/generate  (Super Admin — public_blogs)
 *   - /api/blogs/generate       (Company Admin — blogs)
 *
 * API routes are responsible ONLY for:
 *   1. Auth / role enforcement
 *   2. Company context injection (placeholder per route)
 *   3. Calling runBlogGeneration(input)
 *   4. Returning res.status(200).json(result)
 *
 * No generation logic lives inside any API route file.
 *
 * PURE FUNCTION DESIGN
 * ─────────────────────
 * runBlogGeneration does NOT access req, res, cookies, headers, or session.
 * All external data access is injected via BlogGenerationRequest:
 *   - fetchAngleData   — overrideable for testing / mocking
 *   - fetchSeriesData  — overrideable for testing / mocking
 * Default implementations are module-level functions that use supabase.
 * Injectable overrides let callers eliminate all DB coupling in unit tests.
 */

import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { htmlToBlocks } from './htmlToBlocks';
import type { ContentBlock } from './blockTypes';
import {
  generateClarificationQuestions,
  type ThemeInput,
} from './blogClarificationEngine';
import {
  buildAnglesSystemPrompt,
  buildAnglesUserPrompt,
  validateAnglesOutput,
  buildFallbackAngles,
  buildGenerationFallback,
  type BlogAngle,
  type AngleType,
  type BlogGenerationInput,
  type SeriesSummary,
} from './blogGenerationEngine';
import { extractPrimaryKeyword } from './seoIntelligenceEngine';
import {
  buildGenerationContext,
  buildUnifiedPromptContext,
  type OrchestratorResult,
} from '../content/contentGenerationOrchestrator';
import { assimilateCompanyEditorialPrimitives } from '../content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../content/audienceMaturityIntelligence';
import { buildEditorialAuthorityIntelligence } from '../content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../content/editorialDepthIntelligence';
import { buildGenerationGuidanceContract } from '../content/generationGuidanceContracts';
import { buildNarrativePlanningPrimitives } from '../content/narrativePlanningEngine';
import { resolveOmnivyraDoctrineGenerationContext } from '../content/omnivyraEditorialDoctrine';
import { observeBehavioralAdherenceDiagnostics } from '../content/behavioralAdherenceDiagnostics';
import { observeEditorialDiagnostics } from '../content/editorialDiagnosticObserver';
import { buildEditorialQualityReadiness } from '../content/editorialQualityReadiness';
import { buildEditorialQualitySignals } from '../content/editorialQualitySignals';
import { buildEditorialRemediationHints } from '../content/editorialRemediationHints';
import { assembleEditorialRemediationPlan } from '../content/editorialRemediationPlanAssembler';
import { selectRegenerationCandidates } from '../content/regenerationCandidateSelector';
import { buildRegenerationExecutionManifest } from '../content/regenerationExecutionManifest';
import { buildRegenerationReadinessContract } from '../content/regenerationReadinessContracts';
import { planRecoveryExecutionDryRun } from '../content/recoveryExecutionDryRunPlanner';
import { buildRecoveryExecutorContracts } from '../content/recoveryExecutorContracts';
import { buildExecutorVerificationContracts } from '../content/executorVerificationContracts';
import { observeVerificationReadiness } from '../content/verificationReadinessObserver';
import { buildAcceptanceReadinessContracts } from '../content/acceptanceReadinessContracts';
import { assembleAcceptanceReviewPackage } from '../content/acceptanceReviewPackageAssembler';
import { observeValidatorReadiness } from '../content/validatorReadinessObserver';
import { buildValidatorExecutionManifest } from '../content/validatorExecutionManifest';
import { sequenceValidatorReview } from '../content/validatorReviewSequencer';
import { buildValidatorResultContracts } from '../content/validatorResultContracts';
import { prepareValidatorDecision } from '../content/validatorDecisionPreparation';
import { simulateValidatorAcceptance } from '../content/validatorAcceptanceSimulation';
import { sequenceValidatorRecoveryDecision } from '../content/validatorRecoveryDecisionSequencer';
import { buildValidatorAuditTrail } from '../content/validatorAuditTrail';
import { assembleValidatorReviewSnapshot } from '../content/validatorReviewSnapshotAssembler';
import { buildValidatorCoverageLedger } from '../content/validatorCoverageLedger';
import { buildValidatorDecisionTrace } from '../content/validatorDecisionTrace';
import { buildValidatorHandoffReadiness } from '../content/validatorHandoffReadiness';
import { buildValidatorHandoffManifest } from '../content/validatorHandoffManifest';
import { prepareValidatorExecution } from '../content/validatorExecutionPreparation';
import { observeValidatorOperationalReadiness } from '../content/validatorOperationalReadiness';
import { evaluateValidatorPreflightReadiness } from '../content/validatorPreflightReadinessGate';
import { buildValidatorExecutionAdapterContract } from '../content/validatorExecutionAdapterContract';
import { planValidatorInvocationDryRun } from '../content/validatorInvocationDryRunPlanner';
import { buildValidatorInvocationResultContract } from '../content/validatorInvocationResultContract';
import { buildValidatorOutputNormalizationContract } from '../content/validatorOutputNormalizationContract';
import { buildNormalizedValidatorOutputEnvelope } from '../content/normalizedValidatorOutputEnvelope';
import { buildValidatorExecutionEligibilityPolicy } from '../content/validatorExecutionEligibilityPolicy';
import { interpretValidatorRuntimeEligibility } from '../content/validatorRuntimeEligibilityInterpreter';
import { buildValidatorRuntimeReadinessEnvelope } from '../content/validatorRuntimeReadinessEnvelope';
import { buildValidatorRuntimeGovernanceEnvelope } from '../content/validatorRuntimeGovernanceEnvelope';
import { buildValidatorRuntimeStabilizationEnvelope } from '../content/validatorRuntimeStabilizationEnvelope';
import { buildValidatorRuntimeActivationReadinessGate } from '../content/validatorRuntimeActivationReadinessGate';
import { buildValidatorRuntimeRolloutClosureEnvelope } from '../content/validatorRuntimeRolloutClosureEnvelope';
import { assembleUnifiedEditorialBrief } from '../content/unifiedEditorialBriefAssembler';
import { prioritizeEditorialRuntimeContext } from '../content/editorialRuntimeContextPrioritizer';
import { buildGeneratorRuntimeAlignment } from '../content/generatorRuntimeAlignment';
import { buildGeneratorBehavioralSteering } from '../content/generatorBehavioralSteering';
import { getDefaultBlogTemplates, instantiateBlogTemplate } from './defaultBlogTemplates';
import { deriveTemplateDepthGuidance } from './runBlogGenerationPureHelpers';
import { type CompanyIdentity } from '../content/companyContextBlock';
import {
  defaultFetchAngleData,
  defaultFetchSeriesData,
  injectInternalLinks,
} from './runBlogGenerationDataAccess';
import type { CompanyContext, BlogGenerationRequest, BlogGenerationResult } from './blogRunnerTypes';
// Re-export types for callers that import them from this module
export type { CompanyContext, BlogGenerationRequest, BlogGenerationResult } from './blogRunnerTypes';
import { runStandardHtmlBlogGeneration } from './runStandardBlogGeneration';
import { runTemplateBlogGenerationPath } from './runTemplateBlogGeneration';

type FullBlogGenerationResult = Extract<
  BlogGenerationResult,
  { needs_clarification: false; mode: 'full' }
>;

function isFullBlogGenerationResult(
  result: BlogGenerationResult,
): result is FullBlogGenerationResult {
  return result.needs_clarification === false && result.mode === 'full';
}

function attachEditorialDiagnostics(
  result: BlogGenerationResult,
  ctx: OrchestratorResult | null,
): BlogGenerationResult {
  if (!isFullBlogGenerationResult(result) || !ctx) return result;
  try {
    const editorialDiagnostics = observeEditorialDiagnostics({
      generatedContent: result.result,
      doctrine: ctx.doctrine,
      assimilation: ctx.assimilation,
      narrativePlanning: ctx.narrativePlanning,
      generationGuidance: ctx.generationGuidance,
    });
    const behavioralAdherence = observeBehavioralAdherenceDiagnostics({
      generatedContent: result.result,
      generatorBehavioralSteering: ctx.generatorBehavioralSteering,
      generatorRuntimeAlignment: ctx.generatorRuntimeAlignment,
      unifiedEditorialBrief: ctx.unifiedEditorialBrief,
      editorialRuntimeContext: ctx.editorialRuntimeContext,
    });
    const qualitySignals = buildEditorialQualitySignals({
      editorialDiagnostics,
      behavioralAdherenceDiagnostics: behavioralAdherence,
      generatorBehavioralSteering: ctx.generatorBehavioralSteering,
      generatorRuntimeAlignment: ctx.generatorRuntimeAlignment,
    });
    const qualityReadiness = buildEditorialQualityReadiness({
      editorialQualitySignals: qualitySignals,
      behavioralAdherenceDiagnostics: behavioralAdherence,
      editorialDiagnostics,
      generatorRuntimeAlignment: ctx.generatorRuntimeAlignment,
    });
    const remediationHints = buildEditorialRemediationHints({
      editorialQualityReadiness: qualityReadiness,
      editorialQualitySignals: qualitySignals,
      behavioralAdherenceDiagnostics: behavioralAdherence,
      editorialDiagnostics,
    });
    const remediationPlan = assembleEditorialRemediationPlan({
      editorialRemediationHints: remediationHints,
      editorialQualityReadiness: qualityReadiness,
      editorialQualitySignals: qualitySignals,
      behavioralAdherenceDiagnostics: behavioralAdherence,
    });
    const regenerationReadinessContract = buildRegenerationReadinessContract({
      editorialRemediationPlan: remediationPlan,
      editorialRemediationHints: remediationHints,
      editorialQualityReadiness: qualityReadiness,
      behavioralAdherenceDiagnostics: behavioralAdherence,
    });
    const regenerationCandidateSelection = selectRegenerationCandidates({
      regenerationReadinessContract,
      editorialRemediationPlan: remediationPlan,
      editorialQualityReadiness: qualityReadiness,
      behavioralAdherenceDiagnostics: behavioralAdherence,
    });
    const regenerationExecutionManifest = buildRegenerationExecutionManifest({
      regenerationCandidateSelection,
      regenerationReadinessContract,
      editorialRemediationPlan: remediationPlan,
      editorialQualityReadiness: qualityReadiness,
    });
    const recoveryExecutionDryRun = planRecoveryExecutionDryRun({
      regenerationExecutionManifest,
      regenerationCandidateSelection,
      regenerationReadinessContract,
      editorialRemediationPlan: remediationPlan,
    });
    const recoveryExecutorContracts = buildRecoveryExecutorContracts({
      recoveryExecutionDryRun,
      regenerationExecutionManifest,
      regenerationCandidateSelection,
      regenerationReadinessContract,
    });
    const executorVerificationContracts = buildExecutorVerificationContracts({
      recoveryExecutorContracts,
      recoveryExecutionDryRun,
      regenerationExecutionManifest,
      regenerationReadinessContract,
    });
    const verificationReadinessObservation = observeVerificationReadiness({
      executorVerificationContracts,
      recoveryExecutorContracts,
      recoveryExecutionDryRun,
      regenerationExecutionManifest,
    });
    const acceptanceReadinessContracts = buildAcceptanceReadinessContracts({
      verificationReadinessObservation,
      executorVerificationContracts,
      recoveryExecutorContracts,
      recoveryExecutionDryRun,
    });
    const acceptanceReviewPackage = assembleAcceptanceReviewPackage({
      acceptanceReadinessContracts,
      verificationReadinessObservation,
      executorVerificationContracts,
      recoveryExecutorContracts,
      recoveryExecutionDryRun,
    });
    const validatorReadinessObservation = observeValidatorReadiness({
      acceptanceReviewPackage,
      acceptanceReadinessContracts,
      verificationReadinessObservation,
      executorVerificationContracts,
      recoveryExecutorContracts,
      recoveryExecutionDryRun,
    });
    const validatorExecutionManifest = buildValidatorExecutionManifest({
      acceptanceReviewPackage,
      validatorReadinessObservation,
      acceptanceReadinessContracts,
      verificationReadinessObservation,
      executorVerificationContracts,
      recoveryExecutorContracts,
      recoveryExecutionDryRun,
    });
    const validatorReviewSequence = sequenceValidatorReview({
      validatorExecutionManifest,
      validatorReadinessObservation,
      acceptanceReviewPackage,
      acceptanceReadinessContracts,
      recoveryExecutionDryRun,
    });
    const validatorResultContracts = buildValidatorResultContracts({
      validatorReviewSequence,
      validatorExecutionManifest,
      validatorReadinessObservation,
      acceptanceReviewPackage,
      executorVerificationContracts,
    });
    const validatorDecisionPreparation = prepareValidatorDecision({
      validatorResultContracts,
      validatorReviewSequence,
      validatorExecutionManifest,
      validatorReadinessObservation,
      acceptanceReviewPackage,
    });
    const validatorAcceptanceSimulation = simulateValidatorAcceptance({
      validatorDecisionPreparation,
      validatorResultContracts,
      validatorReviewSequence,
    });
    const validatorRecoveryDecisionSequence = sequenceValidatorRecoveryDecision({
      validatorAcceptanceSimulation,
      validatorDecisionPreparation,
      validatorResultContracts,
      validatorReviewSequence,
      validatorExecutionManifest,
    });
    const validatorAuditTrail = buildValidatorAuditTrail({
      validatorRecoveryDecisionSequence,
      validatorAcceptanceSimulation,
      validatorDecisionPreparation,
      validatorResultContracts,
      validatorReviewSequence,
    });
    const validatorReviewSnapshot = assembleValidatorReviewSnapshot({
      validatorAuditTrail,
      validatorRecoveryDecisionSequence,
      validatorAcceptanceSimulation,
      validatorDecisionPreparation,
      validatorResultContracts,
    });
    const validatorCoverageLedger = buildValidatorCoverageLedger({
      validatorReviewSnapshot,
      validatorAuditTrail,
      validatorRecoveryDecisionSequence,
      validatorResultContracts,
    });
    const validatorDecisionTrace = buildValidatorDecisionTrace({
      validatorCoverageLedger,
      validatorReviewSnapshot,
      validatorAuditTrail,
      validatorRecoveryDecisionSequence,
      validatorDecisionPreparation,
    });
    const validatorHandoffReadiness = buildValidatorHandoffReadiness({
      validatorDecisionTrace,
      validatorCoverageLedger,
      validatorReviewSnapshot,
      validatorAuditTrail,
      validatorRecoveryDecisionSequence,
    });
    const validatorHandoffManifest = buildValidatorHandoffManifest({
      validatorHandoffReadiness,
      validatorDecisionTrace,
      validatorCoverageLedger,
      validatorReviewSnapshot,
      validatorAuditTrail,
    });
    const validatorExecutionPreparation = prepareValidatorExecution({
      validatorHandoffManifest,
      validatorHandoffReadiness,
      validatorDecisionTrace,
      validatorCoverageLedger,
      validatorAuditTrail,
      validatorRecoveryDecisionSequence,
    });
    const validatorOperationalReadiness = observeValidatorOperationalReadiness({
      validatorExecutionPreparation,
      validatorHandoffManifest,
      validatorHandoffReadiness,
      validatorCoverageLedger,
      validatorReviewSnapshot,
    });
    const validatorPreflightReadinessGate = evaluateValidatorPreflightReadiness({
      validatorOperationalReadiness,
      validatorExecutionPreparation,
      validatorHandoffManifest,
      validatorDecisionTrace,
      validatorCoverageLedger,
    });
    const validatorExecutionAdapterContract = buildValidatorExecutionAdapterContract({
      validatorPreflightReadinessGate,
      validatorOperationalReadiness,
      validatorExecutionPreparation,
      validatorHandoffManifest,
      validatorDecisionTrace,
    });
    const validatorInvocationDryRunPlan = planValidatorInvocationDryRun({
      validatorExecutionAdapterContract,
      validatorPreflightReadinessGate,
      validatorOperationalReadiness,
      validatorExecutionPreparation,
      validatorDecisionTrace,
    });
    const validatorInvocationResultContract = buildValidatorInvocationResultContract({
      validatorInvocationDryRunPlan,
      validatorExecutionAdapterContract,
      validatorPreflightReadinessGate,
      validatorOperationalReadiness,
      validatorDecisionTrace,
    });
    const validatorOutputNormalizationContract = buildValidatorOutputNormalizationContract({
      validatorInvocationResultContract,
      validatorInvocationDryRunPlan,
      validatorExecutionAdapterContract,
      validatorPreflightReadinessGate,
      validatorDecisionTrace,
    });
    const normalizedValidatorOutputEnvelope = buildNormalizedValidatorOutputEnvelope({
      validatorOutputNormalizationContract,
      validatorInvocationResultContract,
      validatorInvocationDryRunPlan,
      validatorExecutionAdapterContract,
      validatorDecisionTrace,
    });
    const validatorExecutionEligibilityPolicy = buildValidatorExecutionEligibilityPolicy({
      normalizedValidatorOutputEnvelope,
      validatorOutputNormalizationContract,
      validatorInvocationResultContract,
      validatorPreflightReadinessGate,
      validatorDecisionTrace,
    });
    const validatorRuntimeEligibilityInterpretation = interpretValidatorRuntimeEligibility({
      validatorExecutionEligibilityPolicy,
      normalizedValidatorOutputEnvelope,
      validatorOutputNormalizationContract,
      validatorPreflightReadinessGate,
      validatorDecisionTrace,
    });
    const validatorRuntimeReadinessEnvelope = buildValidatorRuntimeReadinessEnvelope({
      validatorRuntimeEligibilityInterpretation,
      normalizedValidatorOutputEnvelope,
      validatorOutputNormalizationContract,
      validatorPreflightReadinessGate,
      validatorDecisionTrace,
    });
    const validatorRuntimeGovernanceEnvelope = buildValidatorRuntimeGovernanceEnvelope({
      validatorRuntimeReadinessEnvelope,
      validatorRuntimeEligibilityInterpretation,
      normalizedValidatorOutputEnvelope,
      validatorPreflightReadinessGate,
      validatorDecisionTrace,
    });
    const validatorRuntimeStabilizationEnvelope = buildValidatorRuntimeStabilizationEnvelope({
      validatorRuntimeGovernanceEnvelope,
      validatorRuntimeReadinessEnvelope,
      validatorRuntimeEligibilityInterpretation,
      normalizedValidatorOutputEnvelope,
      validatorDecisionTrace,
    });
    const validatorRuntimeActivationReadinessGate = buildValidatorRuntimeActivationReadinessGate({
      validatorRuntimeStabilizationEnvelope,
      validatorRuntimeGovernanceEnvelope,
      validatorRuntimeReadinessEnvelope,
      validatorRuntimeEligibilityInterpretation,
      normalizedValidatorOutputEnvelope,
      validatorDecisionTrace,
    });
    const validatorRuntimeRolloutClosureEnvelope = buildValidatorRuntimeRolloutClosureEnvelope({
      validatorRuntimeStabilizationEnvelope,
      validatorRuntimeGovernanceEnvelope,
      validatorRuntimeReadinessEnvelope,
      validatorRuntimeEligibilityInterpretation,
      normalizedValidatorOutputEnvelope,
      validatorPreflightReadinessGate,
      validatorDecisionTrace,
    });
    return {
      ...result,
      editorial_diagnostics: {
        ...editorialDiagnostics,
        behavioralAdherence,
        qualitySignals,
        qualityReadiness,
        remediationHints,
        remediationPlan,
        regenerationReadinessContract,
        regenerationCandidateSelection,
        regenerationExecutionManifest,
        recoveryExecutionDryRun,
        recoveryExecutorContracts,
        executorVerificationContracts,
        verificationReadinessObservation,
        acceptanceReadinessContracts,
        acceptanceReviewPackage,
        validatorReadinessObservation,
        validatorExecutionManifest,
        validatorReviewSequence,
        validatorResultContracts,
        validatorDecisionPreparation,
        validatorAcceptanceSimulation,
        validatorRecoveryDecisionSequence,
        validatorAuditTrail,
        validatorReviewSnapshot,
        validatorCoverageLedger,
        validatorDecisionTrace,
        validatorHandoffReadiness,
        validatorHandoffManifest,
        validatorExecutionPreparation,
        validatorOperationalReadiness,
        validatorPreflightReadinessGate,
        validatorExecutionAdapterContract,
        validatorInvocationDryRunPlan,
        validatorInvocationResultContract,
        validatorOutputNormalizationContract,
        normalizedValidatorOutputEnvelope,
        validatorExecutionEligibilityPolicy,
        validatorRuntimeEligibilityInterpretation,
        validatorRuntimeReadinessEnvelope,
        validatorRuntimeGovernanceEnvelope,
        validatorRuntimeStabilizationEnvelope,
        validatorRuntimeActivationReadinessGate,
        validatorRuntimeRolloutClosureEnvelope,
      },
    };
  } catch {
    return result;
  }
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function runBlogGeneration(
  req: BlogGenerationRequest,
): Promise<BlogGenerationResult> {
  const {
    company_id,
    mode = 'full',
    topic,
    cluster,
    intent,
    related_blogs,
    series_blog_ids,
    series_context,
    answers,
    selected_angle,
    tone,
    goal_type,
    blogTable       = 'blogs',
    fetchAngleData  = defaultFetchAngleData,
    fetchSeriesData = defaultFetchSeriesData,
    companyContext,
    contentType     = 'blog',
    formatType: rawFormatType,
    target_words,
    template_blocks,
    template_name,
    cache_version,
  } = req;

  // Default format per content type
  const formatType = rawFormatType || (contentType === 'whitepaper' ? 'research' : contentType === 'guide' ? 'comprehensive' : contentType === 'newsletter' ? 'weekly-brief' : contentType === 'story' ? 'short_story' : contentType === 'article' ? 'narrative' : 'standard');

  const resolveDefaultBlogTemplate = (
    requestedFormat: typeof formatType,
    targetWords?: number,
  ): { templateName?: string; templateBlocks?: ContentBlock[] } => {
    if (contentType !== 'blog') return {};
    if (Array.isArray(template_blocks) && template_blocks.length > 0) {
      return {
        templateName: typeof template_name === 'string' ? template_name : undefined,
        templateBlocks: template_blocks,
      };
    }

    const normalizedFormat = typeof requestedFormat === 'string'
      ? requestedFormat.trim().toLowerCase()
      : '';
    if (normalizedFormat !== 'tutorial' && normalizedFormat !== 'comparison') {
      return {};
    }

    const matchedTemplate = getDefaultBlogTemplates().find((template) => {
      return template.content_type === 'blog' && template.format_type === normalizedFormat;
    });

    if (!matchedTemplate) return {};

    return {
      templateName: matchedTemplate.name,
      templateBlocks: instantiateBlogTemplate(matchedTemplate, targetWords),
    };
  };

  const themeInput: ThemeInput = {
    topic:          topic.trim(),
    cluster:        typeof cluster        === 'string' ? cluster.trim()        : undefined,
    intent:         typeof intent         === 'string' ? intent.trim()         : undefined,
    related_blogs:  Array.isArray(related_blogs)
      ? related_blogs.filter((b: unknown) => typeof b === 'string')
      : undefined,
    series_context: typeof series_context === 'string' ? series_context.trim() : undefined,
  };

  const hasAnswers = (
    answers !== null &&
    answers !== undefined &&
    typeof answers === 'object' &&
    Object.keys(answers).length > 0
  );

  // ── Clarification check ─────────────────────────────────────────────────────
  if (!hasAnswers && !selected_angle) {
    const questions = generateClarificationQuestions(themeInput);
    if (questions.length > 0) {
      return { needs_clarification: true, questions };
    }
  }

  const confidence: 'high' | 'medium' = hasAnswers ? 'medium' : 'high';

  const contextualAnswers: Record<string, string> = {
    ...(hasAnswers ? (answers as Record<string, string>) : {}),
  };
  if (companyContext?.audience && !contextualAnswers.audience) {
    contextualAnswers.audience = companyContext.audience;
  }
  if (companyContext?.industry && !contextualAnswers.industry) {
    contextualAnswers.industry = companyContext.industry;
  }
  if (companyContext?.brand_voice && !contextualAnswers.tone) {
    contextualAnswers.tone = companyContext.brand_voice;
  }

  // ── Auto-enrich contextual fields from company profile ─────────────────────
  // These fields dramatically improve AI output depth. Only populate when the
  // user hasn't explicitly provided them, so manual overrides always win.

  if (!contextualAnswers.uniqueness_directive && companyContext) {
    const parts: string[] = [];
    if (companyContext.uniqueValue) parts.push(companyContext.uniqueValue);
    if (companyContext.competitiveAdvantages) parts.push(companyContext.competitiveAdvantages);
    if (parts.length > 0) {
      contextualAnswers.uniqueness_directive =
        `Differentiate by highlighting: ${parts.join('. ')}. Avoid generic advice — tie insights back to these unique strengths.`;
    }
  }

  if (!contextualAnswers.must_include_points && companyContext) {
    const twRaw = contextualAnswers.target_word_count ? parseInt(contextualAnswers.target_word_count, 10) : 0;
    // Tier: 800 = base, 1200+ = medium depth, 1600+ = deep, 2000+ = comprehensive
    const tier = twRaw >= 2000 ? 3 : twRaw >= 1600 ? 2 : twRaw >= 1200 ? 1 : 0;

    const points: string[] = [];
    if (companyContext.coreProblemStatement) points.push(`The core problem: ${companyContext.coreProblemStatement}`);
    if (companyContext.painSymptoms?.length) {
      const maxPains = tier >= 2 ? 5 : tier >= 1 ? 4 : 3;
      points.push(`Key pain points: ${companyContext.painSymptoms.slice(0, maxPains).join(', ')}`);
    }
    if (companyContext.desiredTransformation) points.push(`Transformation outcome: ${companyContext.desiredTransformation}`);
    if (companyContext.authorityDomains?.length) {
      const maxDomains = tier >= 2 ? 5 : tier >= 1 ? 4 : 3;
      points.push(`Authority areas: ${companyContext.authorityDomains.slice(0, maxDomains).join(', ')}`);
    }
    if (companyContext.keyMessages) points.push(`Key messages: ${companyContext.keyMessages}`);
    if (companyContext.productsServices) points.push(`Products/services to reference: ${companyContext.productsServices}`);

    // 1200+: add depth-enhancing directives so the AI has enough material
    if (tier >= 1) {
      points.push('Include real-world examples or data points for each major section');
      points.push('Address common mistakes or misconceptions the audience holds');
      if (companyContext.competitiveAdvantages) {
        points.push(`Weave in competitive differentiators: ${companyContext.competitiveAdvantages}`);
      }
    }

    // 1600+: add implementation guidance and brand references
    if (tier >= 2) {
      points.push('Provide actionable implementation steps or frameworks readers can apply');
      if (companyContext.companyName) {
        points.push(`Reference ${companyContext.companyName}'s perspective or expertise where natural`);
      }
    }

    // 2000+: add comprehensive depth requirements
    if (tier >= 3) {
      points.push('Include a before/after comparison or case study showing measurable impact');
      points.push('Add expert analysis or contrarian viewpoints to deepen each section');
      points.push('Provide a mini-framework, checklist, or decision matrix readers can use immediately');
    }

    if (points.length > 0) {
      contextualAnswers.must_include_points = points.join('; ');
    }
  }

  if (!contextualAnswers.campaign_objective && companyContext) {
    const objParts: string[] = [];
    if (companyContext.campaignFocus) objParts.push(companyContext.campaignFocus);
    else if (companyContext.growthPriorities) objParts.push(companyContext.growthPriorities);
    else if (companyContext.goals) objParts.push(companyContext.goals);
    if (intent) {
      const intentMap: Record<string, string> = {
        awareness:  'Build awareness and educate the audience',
        authority:  'Establish thought leadership and deep expertise',
        conversion: 'Drive readers toward a decision or action',
        retention:  'Deepen engagement with existing audience',
      };
      objParts.push(intentMap[intent] ?? intent);
    }
    if (objParts.length > 0) {
      contextualAnswers.campaign_objective = objParts.join('. ');
    }
  }

  // Strategy perspective is NO LONGER injected into contextualAnswers (A2).
  // It is now a MANDATORY part of the system prompt via buildIdentityLock +
  // buildAntiGenericRules — propagated through companyIdentity below.

  if (!contextualAnswers.trend_context && companyContext) {
    const trendParts: string[] = [];
    if (companyContext.industry) trendParts.push(`Industry: ${companyContext.industry}`);
    if (companyContext.geography) trendParts.push(`Geography: ${companyContext.geography}`);
    if (companyContext.contentThemes) trendParts.push(`Key themes: ${companyContext.contentThemes}`);
    if (trendParts.length > 0) {
      contextualAnswers.trend_context = trendParts.join('. ') + '. Reference current industry trends and developments.';
    }
  }

  const twRaw = contextualAnswers.target_word_count ? parseInt(contextualAnswers.target_word_count, 10) : 0;
  const defaultBlogTemplate = resolveDefaultBlogTemplate(formatType, twRaw || undefined);
  const effectiveTemplateName =
    defaultBlogTemplate.templateName ??
    (typeof template_name === 'string' ? template_name : undefined);
  const effectiveTemplateBlocks =
    defaultBlogTemplate.templateBlocks ??
    (Array.isArray(template_blocks) ? template_blocks : undefined);

  const templateDepthGuidance = deriveTemplateDepthGuidance(contentType, effectiveTemplateName, formatType, twRaw);
  if (templateDepthGuidance) {
    contextualAnswers.uniqueness_directive = contextualAnswers.uniqueness_directive
      ? `${contextualAnswers.uniqueness_directive} ${templateDepthGuidance.uniquenessRule}`
      : templateDepthGuidance.uniquenessRule;

    contextualAnswers.must_include_points = contextualAnswers.must_include_points
      ? `${contextualAnswers.must_include_points}; ${templateDepthGuidance.mustIncludePoints.join('; ')}`
      : templateDepthGuidance.mustIncludePoints.join('; ');
  }

  const hasContextualAnswers = Object.keys(contextualAnswers).length > 0;

  // Build CompanyIdentity from companyContext for system-prompt-level enforcement.
  // This is the SAME identity shape consumed by buildIdentityLock + buildAntiGenericRules.
  const companyIdentity: CompanyIdentity | undefined = companyContext ? {
    companyName: companyContext.companyName,
    industry: companyContext.industry,
    targetAudience: companyContext.audience,
    coreProblem: companyContext.coreProblemStatement,
    painPoints: companyContext.painSymptoms,
    uniqueValue: companyContext.uniqueValue,
    productsServices: companyContext.productsServices,
    desiredTransformation: companyContext.desiredTransformation,
    competitiveAdvantages: companyContext.competitiveAdvantages,
    authorityDomains: companyContext.authorityDomains,
    keyMessages: companyContext.keyMessages,
    brandVoice: companyContext.brand_voice,
    strategyProfile: companyContext.strategyProfile,
  } : undefined;

  const baseInput: BlogGenerationInput = {
    ...themeInput,
    answers:        hasContextualAnswers ? contextualAnswers : undefined,
    selected_angle: selected_angle as BlogAngle | undefined,
    tone:           typeof tone      === 'string' ? tone.trim()      : undefined,
    goal_type:      typeof goal_type === 'string' ? goal_type.trim() : undefined,
    writingStyleInstructions: companyContext?.writingStyleInstructions,
    contentType,
    formatType,
    templateName: effectiveTemplateName,
    primaryKeyword: extractPrimaryKeyword(topic.trim()),
  };

  // ── Mode: angles ────────────────────────────────────────────────────────────
  if (mode === 'angles') {
    const [anglesResult, perfData, orchestratorResult] = await Promise.allSettled([

      // AI angle generation
      (async (): Promise<ReturnType<typeof validateAnglesOutput>> => {
        const aiResult = await runCompletionWithOperation({
          operation:       'blogGeneration',
          companyId:       company_id,
          cache_version:   cache_version,
          model:           'gpt-4o-mini',
          temperature:     0.7,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildAnglesSystemPrompt(contentType, companyIdentity) },
            { role: 'user',   content: buildAnglesUserPrompt(baseInput) },
          ],
        });
        const raw = aiResult.output ? JSON.parse(aiResult.output) : null;
        return raw ? validateAnglesOutput(raw) : null;
      })(),

      // Angle frequency proxy — fallback when feedback data is insufficient
      fetchAngleData(company_id, blogTable),

      // Orchestrator: SEO + feedback + trend intelligence (parallel internally)
      buildGenerationContext({ contentType, topic: topic.trim(), companyId: company_id, blogTable }),
    ]);

    const angles = (anglesResult.status === 'fulfilled' && anglesResult.value)
      ? anglesResult.value
      : buildFallbackAngles(topic.trim());

    // Extract orchestrator results (best-effort)
    const ctx: OrchestratorResult | null =
      orchestratorResult.status === 'fulfilled' ? orchestratorResult.value : null;

    // Prefer effectiveness-based recommendation; fall back to frequency
    const feedback = ctx?.feedback ?? null;

    let recommended_angle: AngleType | null = null;
    let effectiveness_based = false;

    if (feedback?.has_sufficient_data && feedback.recommended_angle_type) {
      recommended_angle = feedback.recommended_angle_type;
      effectiveness_based = true;
    } else {
      recommended_angle =
        (perfData.status === 'fulfilled' && perfData.value) ? perfData.value : null;
    }

    return {
      needs_clarification: false,
      mode:                'angles',
      angles,
      recommended_angle,
      angle_effectiveness: feedback?.angle_effectiveness ?? {},
      effectiveness_based,
      seo_intelligence:    ctx?.seo ?? undefined,
      trend_intelligence:  ctx?.trends ?? undefined,
    };
  }

  // ── Mode: full ──────────────────────────────────────────────────────────────

  // Orchestrator: all intelligence engines in parallel (non-blocking)
  const ctx = await buildGenerationContext({
    contentType, topic: topic.trim(), companyId: company_id, blogTable,
    formatType, targetWordCount: baseInput.answers?.target_word_count
      ? parseInt(String(baseInput.answers.target_word_count), 10) || 1200
      : 1200,
    companyContext,
  }).catch((): OrchestratorResult => {
    const doctrine = resolveOmnivyraDoctrineGenerationContext();
    const assimilation = assimilateCompanyEditorialPrimitives(companyContext);
    const narrativePlanning = buildNarrativePlanningPrimitives({
      topic: topic.trim(),
      contentType,
      doctrine,
      assimilation,
    });
    const generationGuidance = buildGenerationGuidanceContract({
      doctrine,
      assimilation,
      narrativePlanning,
    });
    const editorialDepth = buildEditorialDepthIntelligence({
      doctrine,
      assimilation,
      narrativePlanning,
      generationGuidance,
    });
    const editorialAuthority = buildEditorialAuthorityIntelligence({
      doctrine,
      assimilation,
      narrativePlanning,
      generationGuidance,
      editorialDepth,
    });
    const audienceMaturity = buildAudienceMaturityIntelligence({
      doctrine,
      assimilation,
      narrativePlanning,
      generationGuidance,
      editorialDepth,
      editorialAuthority,
    });
    const unifiedEditorialBrief = assembleUnifiedEditorialBrief({
      doctrine,
      assimilation,
      narrativePlanning,
      generationGuidance,
      editorialDepth,
      editorialAuthority,
      audienceMaturity,
    });
    const editorialRuntimeContext = prioritizeEditorialRuntimeContext({
      unifiedEditorialBrief,
      doctrine,
      assimilation,
      narrativePlanning,
      generationGuidance,
      editorialDepth,
      editorialAuthority,
      audienceMaturity,
    });
    const generatorRuntimeAlignment = buildGeneratorRuntimeAlignment({
      editorialRuntimeContext,
      unifiedEditorialBrief,
      narrativePlanning,
      generationGuidance,
    });
    const generatorBehavioralSteering = buildGeneratorBehavioralSteering({
      generatorRuntimeAlignment,
      editorialRuntimeContext,
      unifiedEditorialBrief,
    });
    return {
      seo: null,
      feedback: null,
      trends: null,
      structure: null,
      doctrine,
      assimilation,
      narrativePlanning,
      generationGuidance,
      editorialDepth,
      editorialAuthority,
      audienceMaturity,
      unifiedEditorialBrief,
      editorialRuntimeContext,
      generatorRuntimeAlignment,
      generatorBehavioralSteering,
    };
  });

  const unifiedPromptContext = buildUnifiedPromptContext(ctx);

  // Series continuation: fetch prior blog summaries via injectable
  let series_summaries: SeriesSummary[] | undefined;

  if (Array.isArray(series_blog_ids) && series_blog_ids.length > 0) {
    const validIds = series_blog_ids.filter((id: unknown) => typeof id === 'string');

    if (validIds.length > 0) {
      const fetched = await fetchSeriesData(validIds, company_id, blogTable);
      if (fetched.length > 0) series_summaries = fetched;
    }
  }

  const generationInput: BlogGenerationInput = { ...baseInput, series_summaries, unifiedPromptContext };

  try {
    const rawTargetWordCount =
      generationInput.answers?.target_word_count ??
      generationInput.answers?.word_count ??
      target_words;
    const targetWc = rawTargetWordCount != null
      ? parseInt(String(rawTargetWordCount), 10) || undefined
      : undefined;

    // Scale max_tokens to word target.
    // Template-aware path outputs JSON with block structure, metadata, and nested objects
    // which requires ~5 tokens per target word. Standard HTML path needs ~2.5 tokens/word.
    //
    // The 16384 ceiling is NOT arbitrary: it is gpt-4o's hard max-output-token
    // limit. Requesting more would be rejected by the provider, so we clamp
    // here. The practical consequence: at 2.5 tok/word the standard path tops
    // out near ~6500 words and the template path (5 tok/word) near ~3200 words.
    // Beyond that the model is forced to truncate; the AI gateway now logs
    // [ai-gateway] output-truncated (finish_reason=length) when this happens so
    // truncated long-form no longer ships silently.
    const TOKEN_OUTPUT_CEILING = 16384; // gpt-4o hard max output tokens
    const isTemplatePath = effectiveTemplateBlocks && Array.isArray(effectiveTemplateBlocks) && effectiveTemplateBlocks.length > 0;
    const tokensPerWord = isTemplatePath ? 5 : 2.5;
    const maxTokens = targetWc && targetWc >= 800
      ? Math.min(TOKEN_OUTPUT_CEILING, Math.max(4096, Math.round(targetWc * tokensPerWord)))
      : 4096;

    // Warn up-front when the requested word target cannot physically fit the
    // token ceiling — operators see the cause before the truncation log fires.
    if (targetWc && Math.round(targetWc * tokensPerWord) > TOKEN_OUTPUT_CEILING) {
      const maxAchievableWords = Math.floor(TOKEN_OUTPUT_CEILING / tokensPerWord);
      console.warn('[blog-generation] target-exceeds-token-budget', {
        contentType,
        requestedWords: targetWc,
        maxAchievableWords,
        tokensPerWord,
        path: isTemplatePath ? 'template' : 'standard',
        note: 'output will be truncated near maxAchievableWords for this model',
      });
    }

    // ── Template-aware generation path ─────────────────────────────────────
    // When a template is provided, AI fills the block structure directly
    // instead of generating a monolithic HTML blob.
    if (effectiveTemplateBlocks && Array.isArray(effectiveTemplateBlocks) && effectiveTemplateBlocks.length > 0) {
      const templateResult = await runTemplateBlogGenerationPath({
        company_id, topic, blogTable, cache_version, contentType, formatType,
        effectiveTemplateBlocks, effectiveTemplateName, targetWc, maxTokens,
        generationInput, ctx, confidence, selected_angle: selected_angle as BlogAngle | undefined,
        companyIdentity,
      });
      if (templateResult !== null) return attachEditorialDiagnostics(templateResult, ctx);
    }

    const standardResult = await runStandardHtmlBlogGeneration({
      company_id,
      topic,
      blogTable,
      targetWc,
      contentType,
      formatType,
      cache_version,
      maxTokens,
      generationInput,
      effectiveTemplateName,
      confidence,
      ctx,
      companyIdentity,
    });
    return attachEditorialDiagnostics(standardResult, ctx);

  } catch (err) {
    // C3: CompanyContextEnforcementError must propagate to the API route so
    // the caller returns a 422 quality-gate response instead of silently
    // shipping a weak fallback.
    if (err instanceof Error && err.name === 'CompanyContextEnforcementError') {
      throw err;
    }

    const fallback       = buildGenerationFallback(generationInput);
    let content_blocks = htmlToBlocks(fallback.content_html);

    // Best-effort internal links even on fallback
    content_blocks = await injectInternalLinks(
      content_blocks,
      topic.trim(),
      company_id,
      blogTable,
    );

    return attachEditorialDiagnostics({
      needs_clarification: false,
      mode:                'full',
      confidence:          'medium',
      result:              { ...fallback, content_blocks },
      hook_assessment:     { strength: 'moderate', note: 'Review before publishing.' },
    }, ctx);
  }
}
