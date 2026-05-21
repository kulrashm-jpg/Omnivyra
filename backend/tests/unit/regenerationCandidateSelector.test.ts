import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import { observeBehavioralAdherenceDiagnostics } from '../../../lib/content/behavioralAdherenceDiagnostics';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
import { buildEditorialQualityReadiness } from '../../../lib/content/editorialQualityReadiness';
import { buildEditorialQualitySignals } from '../../../lib/content/editorialQualitySignals';
import { observeEditorialDiagnostics } from '../../../lib/content/editorialDiagnosticObserver';
import { assembleEditorialRemediationPlan } from '../../../lib/content/editorialRemediationPlanAssembler';
import { buildEditorialRemediationHints } from '../../../lib/content/editorialRemediationHints';
import {
  selectRegenerationCandidates,
  serializeRegenerationCandidateSelection,
} from '../../../lib/content/regenerationCandidateSelector';
import { buildRegenerationReadinessContract } from '../../../lib/content/regenerationReadinessContracts';
import { prioritizeEditorialRuntimeContext } from '../../../lib/content/editorialRuntimeContextPrioritizer';
import { buildGeneratorBehavioralSteering } from '../../../lib/content/generatorBehavioralSteering';
import { buildGeneratorRuntimeAlignment } from '../../../lib/content/generatorRuntimeAlignment';
import { buildGenerationGuidanceContract } from '../../../lib/content/generationGuidanceContracts';
import { buildNarrativePlanningPrimitives } from '../../../lib/content/narrativePlanningEngine';
import { resolveOmnivyraDoctrineGenerationContext } from '../../../lib/content/omnivyraEditorialDoctrine';
import { assembleUnifiedEditorialBrief } from '../../../lib/content/unifiedEditorialBriefAssembler';

const companyContext = {
  companyName: 'SignalForge',
  audience: 'growth operators',
  industry: 'marketing intelligence',
  coreProblemStatement: 'teams cannot connect campaign signals to daily execution decisions',
  uniqueValue: 'turns marketing signals into governed execution choices',
  competitiveAdvantages: 'workflow governance and closed-loop attribution',
  productsServices: 'an AI marketing intelligence workspace',
  authorityDomains: ['marketing intelligence', 'content operations'],
  desiredTransformation: 'from scattered campaign activity to governed execution intelligence',
};

function buildSelectionInput(contentHtml: string) {
  const doctrine = resolveOmnivyraDoctrineGenerationContext();
  const assimilation = assimilateCompanyEditorialPrimitives(companyContext);
  const narrativePlanning = buildNarrativePlanningPrimitives({
    topic: 'AI content operations',
    contentType: 'blog',
    doctrine,
    assimilation,
    sectionCount: 6,
  });
  const generationGuidance = buildGenerationGuidanceContract({ doctrine, assimilation, narrativePlanning });
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
  const generatedContent = {
    title: 'AI Content Operations',
    excerpt: 'A governed approach to content operations.',
    content_html: contentHtml,
    key_insights: ['Candidate selection must preserve workflow proof and reader-state movement.'],
  };
  const editorialDiagnostics = observeEditorialDiagnostics({
    generatedContent,
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
  });
  const behavioralAdherenceDiagnostics = observeBehavioralAdherenceDiagnostics({
    generatedContent,
    generatorBehavioralSteering,
    generatorRuntimeAlignment,
    unifiedEditorialBrief,
    editorialRuntimeContext,
  });
  const editorialQualitySignals = buildEditorialQualitySignals({
    editorialDiagnostics,
    behavioralAdherenceDiagnostics,
    generatorBehavioralSteering,
    generatorRuntimeAlignment,
  });
  const editorialQualityReadiness = buildEditorialQualityReadiness({
    editorialQualitySignals,
    behavioralAdherenceDiagnostics,
    editorialDiagnostics,
    generatorRuntimeAlignment,
  });
  const editorialRemediationHints = buildEditorialRemediationHints({
    editorialQualityReadiness,
    editorialQualitySignals,
    behavioralAdherenceDiagnostics,
    editorialDiagnostics,
  });
  const editorialRemediationPlan = assembleEditorialRemediationPlan({
    editorialRemediationHints,
    editorialQualityReadiness,
    editorialQualitySignals,
    behavioralAdherenceDiagnostics,
  });
  const regenerationReadinessContract = buildRegenerationReadinessContract({
    editorialRemediationPlan,
    editorialRemediationHints,
    editorialQualityReadiness,
    behavioralAdherenceDiagnostics,
  });

  return {
    regenerationReadinessContract,
    editorialRemediationPlan,
    editorialQualityReadiness,
    behavioralAdherenceDiagnostics,
  };
}

const alignedHtml = `
<h2>Diagnose the operating tension</h2>
<p>Growth operators feel the pain when teams cannot connect campaign signals to daily execution decisions. The hidden cause is weak upstream context, unclear workflow ownership, and decision stakes that never reach the content brief.</p>
<h2>Reframe the default assumption</h2>
<p>The default assumption is that more articles create authority. Instead, SignalForge should reframe AI content operations around workflow governance, closed-loop attribution, and the belief that generic content reflects weak operating context.</p>
<h2>Expand the mechanism</h2>
<p>The mechanism is an execution intelligence loop. It separates insight, priority, proof, and publishing so the implication is causal rather than decorative.</p>
<h2>Operationalize the workflow</h2>
<p>The workflow should name an owner, decision point, review check, handoff, tradeoff, and constraint. That operating sequence changes how operators prioritize work and approve output.</p>
<h2>Validate the proof behavior</h2>
<p>Proof should be handled through evidence, scenario limits, constraints, and qualified claims. When verified metrics are unavailable, the recommendation should stay bounded rather than inflated.</p>
<h2>Resolve the operating implication</h2>
<p>Ultimately, the operating implication is that governed generation compounds only when strategic tension, workflow realism, proof boundaries, and authority discipline stay connected.</p>
`;

describe('regenerationCandidateSelector', () => {
  it('generates deterministic candidate selections', () => {
    const first = selectRegenerationCandidates(buildSelectionInput(alignedHtml));
    const second = selectRegenerationCandidates(buildSelectionInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('regeneration-candidate-selection-v1');
    expect(first.sectionRecoveryCandidates.length).toBeGreaterThan(0);
  });

  it('selects safe rewrite candidates', () => {
    const selection = selectRegenerationCandidates(buildSelectionInput(alignedHtml));

    expect(selection.safeRewriteCandidates.every((candidate) => candidate.risk === 'low')).toBe(true);
    expect(selection.safeRewriteCandidates.every((candidate) => candidate.eligibility === 'eligible')).toBe(true);
  });

  it('defers unsafe narrative rewrites', () => {
    const selection = selectRegenerationCandidates(buildSelectionInput(`
<h2>A</h2><p>In short, the answer is best practices and innovative ways to leverage content and drive growth.</p>
<h2>B</h2><p>In short, the answer is best practices and innovative ways to leverage content and drive growth.</p>
<h2>C</h2><p>In short, the answer is best practices and innovative ways to leverage content and drive growth.</p>
`));

    expect(selection.rewriteDeferralCandidates.length).toBeGreaterThan(0);
    expect(selection.highRiskRewriteCandidates.length).toBeGreaterThan(0);
  });

  it('generates priority and confidence maps', () => {
    const selection = selectRegenerationCandidates(buildSelectionInput(alignedHtml));

    expect(Object.keys(selection.candidatePriorityMap).length).toBe(selection.sectionRecoveryCandidates.length);
    expect(Object.keys(selection.candidateConfidenceMap).length).toBe(selection.sectionRecoveryCandidates.length);
  });

  it('generates deterministic execution order', () => {
    const selection = selectRegenerationCandidates(buildSelectionInput(alignedHtml));

    expect(selection.candidateExecutionOrder.map((candidate) => candidate.sectionIndex)).toEqual(
      selection.candidateExecutionOrder.map((candidate) => candidate.sectionIndex),
    );
    expect(selection.candidateExecutionOrder.every((candidate) => candidate.eligibility === 'eligible')).toBe(true);
  });

  it('maps narrative-safe and authority-safe recovery candidates', () => {
    const selection = selectRegenerationCandidates(buildSelectionInput(alignedHtml));

    expect(Array.isArray(selection.narrativeSafeRecoveryCandidates)).toBe(true);
    expect(Array.isArray(selection.authoritySafeRecoveryCandidates)).toBe(true);
    expect(Array.isArray(selection.antiRepetitionRecoveryCandidates)).toBe(true);
  });

  it('serializes compact candidate selection', () => {
    const selection = selectRegenerationCandidates(buildSelectionInput(alignedHtml));
    const serialized = serializeRegenerationCandidateSelection(selection);

    expect(serialized).toContain('## REGENERATION CANDIDATE SELECTION');
    expect(serialized).toContain('Safe candidates:');
    expect(serialized).toContain('Execution order:');
    expect(serialized.length).toBeLessThan(1800);
  });
});
