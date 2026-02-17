/**
 * Stage 12 — AI Negotiation Loop.
 * Orchestration layer for conversational duration refinement.
 * Reuses CampaignPrePlanningService. No LLM. Deterministic only.
 */

import { supabase } from '../db/supabaseClient';
import { runPrePlanning } from './CampaignPrePlanningService';
import { normalizeGovernanceDecision } from './GovernanceExplanationService';
import type { DurationEvaluationResult } from '../types/CampaignDuration';

export interface RunDurationNegotiationParams {
  campaignId: string;
  companyId: string;
  userMessage: string;
  /** Optional: last evaluation for contextual parsing (extend → max, reduce → min) */
  lastEvaluation?: DurationEvaluationResult | null;
}

export interface RunDurationNegotiationResult {
  evaluation: DurationEvaluationResult;
  explanation: string;
}

const DEFAULT_REQUESTED_WEEKS = 12;

/**
 * Parse user message for proposed duration or intent.
 * Pure deterministic extraction. No LLM.
 */
function parseProposedWeeksFromMessage(
  userMessage: string,
  currentDurationWeeks: number | null,
  lastEvaluation?: DurationEvaluationResult | null
): number {
  const msg = (userMessage || '').trim().toLowerCase();
  const lastMax = lastEvaluation?.max_weeks_allowed;
  const lastMin = lastEvaluation?.min_weeks_required;
  const base = currentDurationWeeks ?? DEFAULT_REQUESTED_WEEKS;

  if (!msg) return base;

  // Explicit number (1–52 weeks)
  const numberMatch = msg.match(/\b(\d{1,2})\s*(?:weeks?|wk)/i) ?? msg.match(/\b(\d{1,2})\b/);
  if (numberMatch) {
    const n = parseInt(numberMatch[1], 10);
    if (n >= 1 && n <= 52) return n;
  }

  // Keywords: extend, stretch, longer → use max if available, else +2
  if (/\b(extend|stretch|longer|more weeks|increase duration)\b/.test(msg)) {
    if (lastMax != null && lastMax > 0) return lastMax;
    return Math.min(52, base + 2);
  }

  // Keywords: reduce, shorten, less → use min if available, else -2
  if (/\b(reduce|shorten|less weeks|decrease duration)\b/.test(msg)) {
    if (lastMin != null && lastMin > 0) return lastMin;
    return Math.max(1, base - 2);
  }

  // "increase capacity" doesn't change duration directly; re-run with current
  return base;
}

/**
 * Run duration negotiation.
 * Loads campaign, parses message, calls runPrePlanning, returns evaluation + explanation.
 */
export async function runDurationNegotiation(
  params: RunDurationNegotiationParams
): Promise<RunDurationNegotiationResult> {
  const { campaignId, companyId, userMessage, lastEvaluation } = params;

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, duration_weeks, priority_level')
    .eq('id', campaignId)
    .maybeSingle();

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const durationWeeks = (campaign as any).duration_weeks as number | null;

  const proposedWeeks = parseProposedWeeksFromMessage(
    userMessage,
    durationWeeks,
    lastEvaluation
  );

  const evaluation = await runPrePlanning({
    companyId,
    campaignId,
    requested_weeks: proposedWeeks,
  });

  const normalized = normalizeGovernanceDecision(evaluation);
  const explanation = normalized.explanation;

  return {
    evaluation,
    explanation,
  };
}
