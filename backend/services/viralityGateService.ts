import { supabase } from '../db/supabaseClient';
import { DiagnosticsByType, ViralityAssessment } from './viralityAdvisorService';

export type GateDecision = 'pass' | 'warn' | 'block';

export interface GateRequiredAction {
  title: string;
  why: string;
  action: string;
  applies_to_platforms?: string[];
}

export interface ViralityGateResult {
  campaign_id: string;
  gate_decision: GateDecision;
  reasons: string[];
  required_actions: GateRequiredAction[];
  advisory_notes: string[];
  evaluated_at: string;
}

const MIN_READINESS_THRESHOLD = 100;
const VIRALITY_MODEL_VERSION = 'virality-diagnostics-1.1';

interface CampaignReadinessRow {
  readiness_percentage: number;
  readiness_state: string;
  blocking_issues: Array<{ code: string; message: string }> | null;
  last_evaluated_at: string;
}

function isInsufficientEvidenceLabel(text?: string | null): boolean {
  if (!text) return false;
  return text.trim().toLowerCase() === 'insufficient evidence';
}

function hasLowConfidence(diagnostics: DiagnosticsByType): boolean {
  return (
    diagnostics.asset_coverage.diagnostic_confidence === 'low' ||
    diagnostics.platform_opportunity.diagnostic_confidence === 'low' ||
    diagnostics.engagement_readiness.diagnostic_confidence === 'low'
  );
}

function collectBlockingReasons(diagnostics: DiagnosticsByType): string[] {
  const reasons: string[] = [];
  const entries = [
    diagnostics.asset_coverage,
    diagnostics.platform_opportunity,
    diagnostics.engagement_readiness,
  ];

  entries.forEach((entry) => {
    if (entry.diagnostic_confidence === 'low' && entry.blocking_reason) {
      reasons.push(entry.blocking_reason);
    }
  });

  return reasons;
}

function hasStructuralGaps(diagnostics: DiagnosticsByType): boolean {
  const assetFindings = diagnostics.asset_coverage.findings || [];
  const platformFindings = diagnostics.platform_opportunity.findings || [];

  const hasAssetGap = assetFindings.some(
    (finding) => !isInsufficientEvidenceLabel(finding.title)
  );
  const hasPlatformGap = platformFindings.some(
    (finding) => !isInsufficientEvidenceLabel(finding.title)
  );

  return hasAssetGap || hasPlatformGap;
}

function buildRequiredActions(diagnostics: DiagnosticsByType): GateRequiredAction[] {
  const actions: GateRequiredAction[] = [];
  const sources = [
    diagnostics.asset_coverage.recommendations || [],
    diagnostics.platform_opportunity.recommendations || [],
  ];

  sources.flat().forEach((rec) => {
    actions.push({
      title: rec.title,
      why: rec.why_it_matters,
      action: rec.what_to_do.join(' '),
      applies_to_platforms: rec.applies_to_platforms,
    });
  });

  return actions;
}

function buildAdvisoryNotes(assessment: ViralityAssessment): string[] {
  const notes: string[] = [];
  const diagnostics = assessment.diagnostics;

  const summaries = [
    diagnostics.asset_coverage.diagnostic_summary,
    diagnostics.platform_opportunity.diagnostic_summary,
    diagnostics.engagement_readiness.diagnostic_summary,
  ];

  summaries.forEach((summary) => {
    if (summary && !isInsufficientEvidenceLabel(summary)) {
      notes.push(summary);
    }
  });

  if (assessment.overall_summary && !isInsufficientEvidenceLabel(assessment.overall_summary)) {
    notes.push(assessment.overall_summary);
  }

  return notes;
}

async function loadCampaignReadiness(
  campaignId: string
): Promise<CampaignReadinessRow | null> {
  const { data, error } = await supabase
    .from('campaign_readiness')
    .select('readiness_percentage, readiness_state, blocking_issues, last_evaluated_at')
    .eq('campaign_id', campaignId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to load campaign readiness: ${error.message}`);
  }

  return data as CampaignReadinessRow;
}

async function loadViralityDiagnostics(
  campaignId: string
): Promise<ViralityAssessment | null> {
  const { data, error } = await supabase
    .from('campaign_virality_assessments')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('model_version', VIRALITY_MODEL_VERSION)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to load virality diagnostics: ${error.message}`);
  }

  return {
    campaign_id: data.campaign_id,
    snapshot_hash: data.snapshot_hash,
    model_version: data.model_version,
    diagnostics: data.diagnostics?.diagnostics || data.diagnostics,
    comparisons: data.diagnostics?.comparisons || [],
    overall_summary: data.diagnostics?.overall_summary || 'insufficient evidence',
    created_at: data.created_at,
  };
}

export async function evaluateViralityGate(
  campaignId: string
): Promise<ViralityGateResult> {
  const readiness = await loadCampaignReadiness(campaignId);
  const diagnostics = await loadViralityDiagnostics(campaignId);

  const reasons: string[] = [];
  const requiredActions: GateRequiredAction[] = [];
  const advisoryNotes: string[] = [];
  let gateDecision: GateDecision = 'pass';

  if (!readiness) {
    gateDecision = 'block';
    reasons.push('Campaign readiness has not been evaluated.');
  } else if (readiness.readiness_percentage < MIN_READINESS_THRESHOLD) {
    gateDecision = 'block';
    reasons.push(
      `Campaign readiness is below the required threshold (${MIN_READINESS_THRESHOLD}).`
    );
  }

  if (!diagnostics) {
    gateDecision = 'block';
    reasons.push('Virality diagnostics are missing for this campaign.');
  }

  if (diagnostics && hasLowConfidence(diagnostics.diagnostics)) {
    const blockingReasons = collectBlockingReasons(diagnostics.diagnostics);
    if (blockingReasons.length > 0) {
      gateDecision = 'block';
      reasons.push(...blockingReasons);
    }
  }

  if (diagnostics) {
    advisoryNotes.push(...buildAdvisoryNotes(diagnostics));
    requiredActions.push(...buildRequiredActions(diagnostics.diagnostics));
  }

  if (gateDecision !== 'block' && diagnostics) {
    if (hasStructuralGaps(diagnostics.diagnostics)) {
      gateDecision = 'warn';
      reasons.push('Structural gaps exist in assets or platform coverage.');
    }
  }

  if (gateDecision === 'pass' && readiness) {
    reasons.push('Readiness and diagnostics meet the minimum gate criteria.');
  }

  return {
    campaign_id: campaignId,
    gate_decision: gateDecision,
    reasons,
    required_actions: requiredActions,
    advisory_notes: advisoryNotes,
    evaluated_at: new Date().toISOString(),
  };
}
