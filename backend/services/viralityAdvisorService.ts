import { supabase } from '../db/supabaseClient';
import {
  buildCampaignSnapshotWithHash,
  canonicalJsonStringify,
  ViralitySnapshot,
} from './viralitySnapshotBuilder';
import { runDiagnosticPrompt } from './llm/openaiAdapter';
import { buildDecideRequest, requestDecision, DecisionResult } from './omnivyreClient';

export type EvidenceType = 'weekly_plan' | 'daily_plan' | 'scheduled_post' | 'asset';

export interface EvidenceEntry {
  evidence_type: EvidenceType;
  reference: string;
  excerpt: string;
}

export interface DiagnosticFinding {
  title: string;
  detail: string;
  evidence: EvidenceEntry[];
}

export interface DiagnosticRecommendation {
  title: string;
  why_it_matters: string;
  what_to_do: string[];
  when_to_do_it: string;
  applies_to_platforms: string[];
  evidence: EvidenceEntry[];
}

export interface DiagnosticOutput {
  diagnostic: 'asset_coverage' | 'platform_opportunity' | 'engagement_readiness';
  diagnostic_summary: string;
  diagnostic_confidence: 'low' | 'normal';
  blocking_reason?: string;
  findings: DiagnosticFinding[];
  recommendations: DiagnosticRecommendation[];
}

export interface DiagnosticComparisons {
  dimension: 'platform' | 'week' | 'content_type';
  observation: string;
  implication: string;
  evidence: EvidenceEntry[];
}

export interface DiagnosticsByType {
  asset_coverage: DiagnosticOutput;
  platform_opportunity: DiagnosticOutput;
  engagement_readiness: DiagnosticOutput;
}

export interface ViralityAssessment {
  campaign_id: string;
  snapshot_hash: string;
  model_version: string;
  diagnostics: DiagnosticsByType;
  comparisons: DiagnosticComparisons[];
  overall_summary: string;
  omnivyre_decision?: DecisionResult;
  created_at: string;
}

interface LlmDiagnosticResponse {
  diagnostic_summary: string;
  findings: DiagnosticFinding[];
  recommendations: DiagnosticRecommendation[];
}

interface LlmComparisonsResponse {
  comparisons: DiagnosticComparisons[];
}

interface LlmSummaryResponse {
  overall_summary: string;
}

const SYSTEM_PROMPT =
  'You are a virality advisor. Use only the provided snapshot. ' +
  'Return JSON only. Do not invent data. Do not score or rank numerically.';

const DIAGNOSTIC_PROMPTS: Record<DiagnosticOutput['diagnostic'], string> = {
  asset_coverage:
    'Asset Coverage Diagnostic:\n' +
    '- Identify missing or unusable assets.\n' +
    '- Evidence must reference week_number, day, platform, and id when possible.\n' +
    '- Mention missing media or format mismatch.\n' +
    '- Include diagnostic_summary (3-5 sentences, plain English, no metrics).\n' +
    '- Return JSON with fields: diagnostic_summary, findings[], recommendations[].\n' +
    '- findings items: title, detail, evidence[].\n' +
    '- recommendations items: title, why_it_matters, what_to_do[], when_to_do_it, applies_to_platforms[], evidence[].\n' +
    '- what_to_do must be stepwise actions.\n' +
    '- when_to_do_it must be relative (e.g., "before week 3").\n' +
    '- evidence entries must include evidence_type (weekly_plan|daily_plan|scheduled_post|asset), reference, excerpt.\n' +
    '- If insufficient evidence, return a single finding with title \"Insufficient evidence\" and detail \"insufficient evidence\".',
  platform_opportunity:
    'Platform Opportunity Diagnostic:\n' +
    '- Detect underused platforms, overloaded platforms, cadence mismatches.\n' +
    '- Evidence must cite counts per platform and gaps per week.\n' +
    '- Include diagnostic_summary (3-5 sentences, plain English, no metrics).\n' +
    '- Return JSON with fields: diagnostic_summary, findings[], recommendations[].\n' +
    '- findings items: title, detail, evidence[].\n' +
    '- recommendations items: title, why_it_matters, what_to_do[], when_to_do_it, applies_to_platforms[], evidence[].\n' +
    '- what_to_do must be stepwise actions.\n' +
    '- when_to_do_it must be relative (e.g., "during week 1-2").\n' +
    '- evidence entries must include evidence_type (weekly_plan|daily_plan|scheduled_post|asset), reference, excerpt.\n' +
    '- If insufficient evidence, return a single finding with title \"Insufficient evidence\" and detail \"insufficient evidence\".',
  engagement_readiness:
    'Engagement Readiness Diagnostic:\n' +
    '- Scan content text for hooks, questions, CTAs, tagging potential.\n' +
    '- Suggest question framing styles, tagging strategies (who, not names), cadence hints, and CTA styles per platform.\n' +
    '- Evidence must quote exact content snippets.\n' +
    '- Include diagnostic_summary (3-5 sentences, plain English, no metrics).\n' +
    '- Return JSON with fields: diagnostic_summary, findings[], recommendations[].\n' +
    '- findings items: title, detail, evidence[].\n' +
    '- recommendations items: title, why_it_matters, what_to_do[], when_to_do_it, applies_to_platforms[], evidence[].\n' +
    '- what_to_do must be stepwise actions.\n' +
    '- when_to_do_it must be relative (e.g., "before week 2 scheduling").\n' +
    '- evidence entries must include evidence_type (weekly_plan|daily_plan|scheduled_post|asset), reference, excerpt.\n' +
    '- If insufficient evidence, return a single finding with title \"Insufficient evidence\" and detail \"insufficient evidence\".',
};

const MODEL_VERSION = process.env.OPENAI_MODEL_VERSION || 'virality-diagnostics-1.1';

function normalizeEvidence(item: { evidence: EvidenceEntry[] }): { evidence: EvidenceEntry[] } {
  if (!item.evidence || item.evidence.length === 0) {
    return {
      ...item,
      evidence: [
        {
          evidence_type: 'daily_plan',
          reference: 'insufficient evidence',
          excerpt: 'insufficient evidence',
        },
      ],
    };
  }
  return item;
}

function isInsufficientEvidence(evidence: EvidenceEntry[]): boolean {
  if (!evidence || evidence.length === 0) return true;
  return evidence.every((entry) => entry.excerpt === 'insufficient evidence');
}

function normalizeDiagnosticOutput(
  diagnostic: DiagnosticOutput['diagnostic'],
  response: LlmDiagnosticResponse
): DiagnosticOutput {
  const findings = (response.findings || []).map((item) =>
    ({ ...item, ...normalizeEvidence(item) })
  );
  const recommendations = (response.recommendations || []).map((item) =>
    ({ ...item, ...normalizeEvidence(item) })
  );
  const diagnosticSummary = response.diagnostic_summary || 'insufficient evidence';

  if (findings.length === 0 && recommendations.length === 0) {
    return {
      diagnostic,
      diagnostic_summary: 'insufficient evidence',
      diagnostic_confidence: 'low',
      blocking_reason: 'insufficient evidence',
      findings: [
        {
          title: 'Insufficient evidence',
          detail: 'insufficient evidence',
          evidence: [
            {
              evidence_type: 'daily_plan',
              reference: 'insufficient evidence',
              excerpt: 'insufficient evidence',
            },
          ],
        },
      ],
      recommendations: [],
    };
  }

  const insufficientFindings = findings.filter((item) => isInsufficientEvidence(item.evidence));
  const insufficientRatio = findings.length === 0 ? 1 : insufficientFindings.length / findings.length;
  const diagnosticConfidence = insufficientRatio > 0.5 ? 'low' : 'normal';

  return {
    diagnostic,
    diagnostic_summary: diagnosticSummary,
    diagnostic_confidence: diagnosticConfidence,
    blocking_reason:
      diagnosticConfidence === 'low'
        ? 'Most findings lack supporting evidence in the current snapshot.'
        : undefined,
    findings,
    recommendations,
  };
}

async function runDiagnostic(
  diagnostic: DiagnosticOutput['diagnostic'],
  snapshot: ViralitySnapshot
): Promise<DiagnosticOutput> {
  const snapshotJson = canonicalJsonStringify(snapshot);
  const userPrompt = `${DIAGNOSTIC_PROMPTS[diagnostic]}\nSnapshot JSON:\n${snapshotJson}`;

  const response = await runDiagnosticPrompt<LlmDiagnosticResponse>(SYSTEM_PROMPT, userPrompt);
  return normalizeDiagnosticOutput(diagnostic, response.data);
}

async function runComparisons(
  snapshot: ViralitySnapshot
): Promise<DiagnosticComparisons[]> {
  const snapshotJson = canonicalJsonStringify(snapshot);
  const userPrompt =
    'Comparative Diagnostics:\n' +
    '- Provide platform vs platform, week vs week, and content type vs content type comparisons.\n' +
    '- Return JSON with fields: comparisons[].\n' +
    '- Each comparison includes dimension (platform|week|content_type), observation, implication, evidence[].\n' +
    '- evidence entries must include evidence_type, reference, excerpt.\n' +
    '- If insufficient evidence, return comparisons with observation "insufficient evidence".\n' +
    `Snapshot JSON:\n${snapshotJson}`;

  const response = await runDiagnosticPrompt<LlmComparisonsResponse>(SYSTEM_PROMPT, userPrompt);
  return (response.data.comparisons || []).map((item) => ({
    ...item,
    ...normalizeEvidence(item),
  }));
}

async function runOverallSummary(
  snapshot: ViralitySnapshot,
  diagnostics: DiagnosticsByType,
  comparisons: DiagnosticComparisons[]
): Promise<string> {
  const summaryPrompt =
    'Executive Summary:\n' +
    '- Write a 5-7 sentence consultant-grade summary.\n' +
    '- Plain English, no metrics.\n' +
    '- Mention the most important structural issues and what to do next.\n' +
    '- Use only the provided snapshot, diagnostics, and comparisons.\n' +
    'Return JSON with field: overall_summary.\n';

  const userPrompt = `${summaryPrompt}\nSnapshot JSON:\n${canonicalJsonStringify(snapshot)}\nDiagnostics JSON:\n${canonicalJsonStringify(diagnostics)}\nComparisons JSON:\n${canonicalJsonStringify(comparisons)}`;
  const response = await runDiagnosticPrompt<LlmSummaryResponse>(SYSTEM_PROMPT, userPrompt);
  return response.data.overall_summary || 'insufficient evidence';
}

async function getCachedAssessment(
  campaignId: string,
  snapshotHash: string
): Promise<ViralityAssessment | null> {
  const { data, error } = await supabase
    .from('campaign_virality_assessments')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('snapshot_hash', snapshotHash)
    .eq('model_version', MODEL_VERSION)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to load virality assessment cache: ${error.message}`);
  }

  return {
    campaign_id: data.campaign_id,
    snapshot_hash: data.snapshot_hash,
    model_version: data.model_version,
    diagnostics: data.diagnostics?.diagnostics || data.diagnostics,
    comparisons: data.diagnostics?.comparisons || [],
    overall_summary: data.diagnostics?.overall_summary || 'insufficient evidence',
    omnivyre_decision: data.diagnostics?.omnivyre_decision,
    created_at: data.created_at,
  };
}

async function storeAssessment(
  assessment: ViralityAssessment
): Promise<void> {
  const { error } = await supabase
    .from('campaign_virality_assessments')
    .insert({
      campaign_id: assessment.campaign_id,
      snapshot_hash: assessment.snapshot_hash,
      diagnostics: {
        diagnostics: assessment.diagnostics,
        comparisons: assessment.comparisons,
        overall_summary: assessment.overall_summary,
        omnivyre_decision: assessment.omnivyre_decision,
      },
      model_version: assessment.model_version,
    });

  if (error && error.code !== '23505') {
    throw new Error(`Failed to store virality assessment: ${error.message}`);
  }
}

export type AssessViralityOptions = {
  snapshot: ViralitySnapshot;
  snapshot_hash: string;
};

export async function assessVirality(
  campaignId: string,
  prebuilt?: AssessViralityOptions
): Promise<ViralityAssessment> {
  const { snapshot, snapshot_hash } = prebuilt ?? await buildCampaignSnapshotWithHash(campaignId);

  const cached = await getCachedAssessment(campaignId, snapshot_hash);
  if (cached) {
    return cached;
  }

  const [assetCoverage, platformOpportunity, engagementReadiness] = await Promise.all([
    runDiagnostic('asset_coverage', snapshot),
    runDiagnostic('platform_opportunity', snapshot),
    runDiagnostic('engagement_readiness', snapshot),
  ]);
  const diagnostics: DiagnosticsByType = {
    asset_coverage: assetCoverage,
    platform_opportunity: platformOpportunity,
    engagement_readiness: engagementReadiness,
  };

  const comparisons = await runComparisons(snapshot);
  const overallSummary = await runOverallSummary(snapshot, diagnostics, comparisons);

  let omnivyreDecision: DecisionResult | undefined;
  try {
    const decidePayload = buildDecideRequest({
      campaign_id: campaignId,
      snapshot_hash,
      model_version: MODEL_VERSION,
      snapshot,
      diagnostics,
      comparisons,
      overall_summary: overallSummary,
    });

    omnivyreDecision = await requestDecision(decidePayload);
    console.log('Omnivyre decision', {
      snapshot_hash,
      decision_id: omnivyreDecision.decision_id,
      recommendation: omnivyreDecision.recommendation,
    });
  } catch (error: any) {
    console.warn('Omnivyre decision failed', {
      snapshot_hash,
      error: error?.message,
    });
  }

  const assessment: ViralityAssessment = {
    campaign_id: campaignId,
    snapshot_hash,
    model_version: MODEL_VERSION,
    diagnostics,
    comparisons,
    overall_summary: overallSummary,
    omnivyre_decision: omnivyreDecision,
    created_at: new Date().toISOString(),
  };

  await storeAssessment(assessment);
  return assessment;
}
