/**
 * Shared types, constants, and pure helper functions for TrendCampaignsTab.
 */

import React from 'react';
import {
  getConfidenceTierForRecommendation,
  getJourneyState,
  getDecisionMomentumState,
} from '../cards/RecommendationBlueprintCard';
import type { PrimaryCampaignTypeId, SecondaryOptionId } from '../../../lib/campaignTypeHierarchy';

// ── Constants ────────────────────────────────────────────────────────────────

export const TYPE = 'TREND';
export const TREND_CLUSTER_PAYLOAD_BRIDGE = 'trend_cluster_payload_bridge';
export const PULSE_TOPIC_BRIDGE = 'pulse_topic_bridge';

// ── Types ────────────────────────────────────────────────────────────────────

export type ClusterInput = {
  problem_domain: string;
  signal_count: number;
  avg_intent_score: number;
  avg_urgency_score: number;
  priority_score: number;
};

export type PulseTopicBridge = {
  topic: string;
  regions: string[];
  narrative_phase: string | null;
  momentum_score: number | null;
};

/** Execution configuration (UX compact bar); injected into strategic payload. */
export type ExecutionConfig = {
  target_audience: string;
  /** Single segment for backward compatibility (first of professional_segments). */
  professional_segment: string | null;
  /** Multiple professional segments when Target Audience is Professionals. */
  professional_segments: string[];
  communication_style: string[];
  content_depth: string;
  /** Desired posting frequency per week (e.g. "5/w"). Capacity is collected in AI Chat. */
  frequency_per_week: string;
  campaign_duration?: number;
  tentative_start: string | undefined;
  campaign_goal: string;
};

/** Payload sent to backend and stored for attribution (matches API shape). */
export type StrategicPayload = {
  context_mode: string;
  company_context: Record<string, unknown>;
  selected_offerings: string[];
  selected_aspect: string | null;
  /** Multiple aspects; treated as OR (recommendations match any). */
  selected_aspects?: string[];
  strategic_text: string;
  strategic_intents?: string[];
  regions?: string[];
  cluster_inputs?: ClusterInput[];
  focused_modules?: string[];
  additional_direction?: string;
  /** Hierarchical campaign focus: primary + secondaries → mapped core types for engine. */
  primary_campaign_type?: PrimaryCampaignTypeId;
  secondary_campaign_types?: SecondaryOptionId[];
  context?: 'business' | 'personal' | 'third_party';
  mapped_core_types?: string[];
  /** Execution configuration from compact bar (Phase 1 UX). */
  execution_config?: ExecutionConfig;
};

export type StrategyStatusForProgress = 'continuation' | 'expansion' | 'neutral' | 'momentum_expand' | undefined;

export type StrategicFlowState =
  | 'expansion'
  | 'momentum'
  | 'exploration'
  | 'consolidation'
  | 'default';

export type CardSignals = {
  journeyState: ReturnType<typeof getJourneyState>;
  confidenceTier: 'high' | 'medium' | 'low';
  momentumState: ReturnType<typeof getDecisionMomentumState>;
  strategyStatus: StrategyStatusForProgress;
  /** For workspace panel: show which cards are in "execute" / "upcoming" lists. */
  cardId?: string;
  cardTitle?: string;
};

// ── Country data ─────────────────────────────────────────────────────────────

/** Country name → ISO 2-letter code for autocomplete and resolution. */
export const ISO_COUNTRIES = [
  { name: 'India', code: 'IN' },
  { name: 'United States', code: 'US' },
  { name: 'United Kingdom', code: 'GB' },
  { name: 'Germany', code: 'DE' },
  { name: 'France', code: 'FR' },
  { name: 'Canada', code: 'CA' },
  { name: 'Australia', code: 'AU' },
  { name: 'Singapore', code: 'SG' },
  { name: 'UAE', code: 'AE' },
  { name: 'Japan', code: 'JP' },
  { name: 'Indonesia', code: 'ID' },
  { name: 'Italy', code: 'IT' },
  { name: 'Spain', code: 'ES' },
  { name: 'Brazil', code: 'BR' },
  { name: 'Mexico', code: 'MX' },
  { name: 'Netherlands', code: 'NL' },
  { name: 'South Korea', code: 'KR' },
  { name: 'China', code: 'CN' },
  { name: 'Hong Kong', code: 'HK' },
  { name: 'Ireland', code: 'IE' },
  { name: 'New Zealand', code: 'NZ' },
  { name: 'South Africa', code: 'ZA' },
  { name: 'Sweden', code: 'SE' },
  { name: 'Norway', code: 'NO' },
  { name: 'Denmark', code: 'DK' },
  { name: 'Finland', code: 'FI' },
  { name: 'Poland', code: 'PL' },
  { name: 'Belgium', code: 'BE' },
  { name: 'Switzerland', code: 'CH' },
  { name: 'Austria', code: 'AT' },
  { name: 'Portugal', code: 'PT' },
  { name: 'Greece', code: 'GR' },
  { name: 'Turkey', code: 'TR' },
  { name: 'Israel', code: 'IL' },
  { name: 'Saudi Arabia', code: 'SA' },
  { name: 'Malaysia', code: 'MY' },
  { name: 'Thailand', code: 'TH' },
  { name: 'Philippines', code: 'PH' },
  { name: 'Vietnam', code: 'VN' },
  { name: 'Argentina', code: 'AR' },
  { name: 'Chile', code: 'CL' },
  { name: 'Colombia', code: 'CO' },
  { name: 'Egypt', code: 'EG' },
  { name: 'Nigeria', code: 'NG' },
  { name: 'Kenya', code: 'KE' },
  { name: 'Pakistan', code: 'PK' },
  { name: 'Bangladesh', code: 'BD' },
  { name: 'Sri Lanka', code: 'LK' },
  { name: 'Russia', code: 'RU' },
  { name: 'Ukraine', code: 'UA' },
  { name: 'Czech Republic', code: 'CZ' },
  { name: 'Romania', code: 'RO' },
  { name: 'Hungary', code: 'HU' },
];

// ── Utility functions ─────────────────────────────────────────────────────────

export function safeParseClusterPayload(raw: string): { cluster_inputs?: ClusterInput[]; context_mode?: string } | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { cluster_inputs?: unknown }).cluster_inputs)) {
      return parsed as { cluster_inputs: ClusterInput[]; context_mode?: string };
    }
    return null;
  } catch {
    return null;
  }
}

export function matchCountry(query: string, country: { name: string; code: string }): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    country.name.toLowerCase().includes(q) ||
    country.code.toLowerCase() === q
  );
}

/** Resolve a single token (code or country name) to ISO code. */
export function tokenToIsoCode(token: string): string {
  const t = token.trim();
  if (t.length === 2) {
    const byCode = ISO_COUNTRIES.find((c) => c.code.toLowerCase() === t.toLowerCase());
    if (byCode) return byCode.code.toUpperCase();
  }
  const byName = ISO_COUNTRIES.find((c) => c.name.toLowerCase() === t.toLowerCase());
  if (byName) return byName.code.toUpperCase();
  const startsWith = ISO_COUNTRIES.find((c) => c.name.toLowerCase().startsWith(t.toLowerCase()));
  if (startsWith) return startsWith.code.toUpperCase();
  return t.toUpperCase();
}

/** Parse region input and return list of ISO codes (resolve country names to codes). */
export function regionInputToIsoCodes(regionInput: string): string[] {
  const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
  return parts.map(tokenToIsoCode);
}

/** UI-level priority score from existing recommendation signals only. Used for presentation order; does not mutate data. */
export function getRecommendationPriorityScore(card: { id: string; recommendation: Record<string, unknown> }): number {
  const rec = card.recommendation ?? {};
  const tier = getConfidenceTierForRecommendation(rec);
  let score =
    tier === 'high' ? 100 : tier === 'medium' ? 60 : 20;
  const polishFlags = rec.polish_flags as Record<string, unknown> | undefined;
  if (polishFlags?.diamond_candidate === true) score += 20;
  if (polishFlags?.authority_elevated === true) score += 15;
  const strategyModifier =
    typeof rec.strategy_modifier === 'number' && Number.isFinite(rec.strategy_modifier)
      ? rec.strategy_modifier
      : null;
  if (strategyModifier != null && strategyModifier > 0) score += 10;
  const finalAlignmentScore =
    typeof rec.final_alignment_score === 'number' && Number.isFinite(rec.final_alignment_score)
      ? rec.final_alignment_score
      : typeof (rec as { finalAlignmentScore?: number }).finalAlignmentScore === 'number' &&
          Number.isFinite((rec as { finalAlignmentScore: number }).finalAlignmentScore)
        ? (rec as { finalAlignmentScore: number }).finalAlignmentScore
        : null;
  if (finalAlignmentScore != null) score += finalAlignmentScore * 20;
  const execution = (rec.execution as Record<string, unknown> | undefined) ?? rec;
  const executionStage =
    (typeof execution?.execution_stage === 'string' && execution.execution_stage.trim()) ||
    (typeof (rec as { execution_stage?: string }).execution_stage === 'string' &&
      (rec as { execution_stage: string }).execution_stage.trim());
  const stageLower = executionStage ? String(executionStage).toLowerCase() : '';
  if (stageLower.includes('conversion') || stageLower.includes('action') || stageLower.includes('consideration')) {
    score += 15;
  }
  return score;
}

/** Progress-aware adjustment from existing UI state. Does not mutate data. */
export function getProgressAdjustment(
  card: { id: string; recommendation: Record<string, unknown> },
  strategyStatus: StrategyStatusForProgress,
  longTermSource: Set<string> | Record<string, string>
): { adjustment: number; resurfaced: boolean } {
  let adjustment = 0;
  let resurfaced = false;
  const rec = card.recommendation ?? {};
  const recId = typeof rec.id === 'string' ? rec.id.trim() : null;
  const isLongTerm =
    typeof longTermSource === 'object' && !(longTermSource instanceof Set)
      ? !!(recId && longTermSource[recId] === 'LONG_TERM')
      : longTermSource.has(card.id);
  const isContinuationOrExpansion =
    strategyStatus === 'continuation' || strategyStatus === 'expansion';

  if (isContinuationOrExpansion) {
    adjustment -= 25;
  }
  if (isLongTerm) {
    adjustment -= 40;
  }

  const tier = getConfidenceTierForRecommendation(rec);
  if (
    tier === 'high' &&
    !isContinuationOrExpansion &&
    !isLongTerm
  ) {
    adjustment += 15;
    resurfaced = true;
  }

  const execution = (rec.execution as Record<string, unknown> | undefined) ?? rec;
  const executionStage =
    (typeof execution?.execution_stage === 'string' && execution.execution_stage.trim()) ||
    (typeof (rec as { execution_stage?: string }).execution_stage === 'string' &&
      (rec as { execution_stage: string }).execution_stage.trim());
  const stageLower = executionStage ? String(executionStage).toLowerCase() : '';

  if (stageLower.includes('education') || stageLower.includes('awareness')) {
    adjustment += 5;
  }
  if (
    (stageLower.includes('conversion') || stageLower.includes('action')) &&
    !isContinuationOrExpansion
  ) {
    adjustment += 10;
  }

  return { adjustment, resurfaced };
}

/** List-level flow state from existing per-card signals. Narrative aggregation only. */
export function getStrategicFlowState(cards: CardSignals[]): StrategicFlowState {
  if (cards.length === 0) return 'default';
  const pastCount = cards.filter((c) => c.journeyState === 'past').length;
  const currentCount = cards.filter((c) => c.journeyState === 'current').length;
  const upcomingCount = cards.filter((c) => c.journeyState === 'upcoming').length;
  const continuationOrExpansionCount = cards.filter(
    (c) =>
      c.strategyStatus === 'continuation' ||
      c.strategyStatus === 'expansion'
  ).length;
  const currentWithHighOrMedium = cards.some(
    (c) => c.journeyState === 'current' && (c.confidenceTier === 'high' || c.confidenceTier === 'medium')
  );
  const planCount = cards.filter((c) => c.momentumState === 'plan').length;
  const majority = cards.length / 2;

  if (continuationOrExpansionCount >= majority || pastCount >= majority) {
    return 'consolidation';
  }
  if (pastCount >= 1 && currentCount >= 1 && currentWithHighOrMedium) {
    return 'expansion';
  }
  const topMomentum = cards[0]?.momentumState;
  const strongPast = pastCount >= majority || continuationOrExpansionCount >= majority;
  if (topMomentum === 'execute' && !strongPast) {
    return 'momentum';
  }
  if (upcomingCount >= majority || planCount >= majority) {
    return 'exploration';
  }
  return 'default';
}

// ── Strategic flow UI ─────────────────────────────────────────────────────────

export const FLOW_SUMMARY_MESSAGES: Record<StrategicFlowState, string> = {
  expansion:
    'Your strategy is expanding from established momentum into a strong active focus.',
  momentum:
    'Your strategy shows strong forward momentum — this is a good time to execute on priority opportunities.',
  exploration:
    'Your strategy is in exploration mode — focus on shaping direction before committing heavily.',
  consolidation:
    'Your strategy is consolidating — maintaining consistency will strengthen long-term positioning.',
  default:
    'Your strategy contains multiple opportunities — focus on current priorities while monitoring upcoming directions.',
};

export function StrategicFlowSummary(props: { state: StrategicFlowState }) {
  const message = FLOW_SUMMARY_MESSAGES[props.state];
  return (
    <div
      className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
      role="status"
    >
      <p className="text-sm text-slate-600">{message}</p>
    </div>
  );
}
