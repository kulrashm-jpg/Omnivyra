/**
 * operationalExplainability.ts
 *
 * Phase 6.8 — Human-readable reasoning extracted from telemetry +
 * lifecycle + recovery state.
 *
 * Operators in support and governance need to answer questions like
 *   "why did this article ship with warnings?"
 *   "why was section 4 abandoned?"
 *   "why was convergence below threshold?"
 *   "why was compression escalated to SURVIVAL?"
 * without reading log lines.
 *
 * This module takes the structured records already produced by earlier
 * phases and turns them into ordered, plain-language explanations.
 */

import type { SectionLifecycleHistoryEntry } from './sectionLifecycleManager';
import { SectionLifecycleState } from './sectionLifecycleManager';
import type { ArticleConvergenceResult } from './articleConvergence';
import type { RecoveryPlan } from './plannedEngineRecoveryCoordinator';
import type { GroundedClaimValidationResult } from './groundedClaimValidator';
import type { RetirementSimulationReport } from './retirementSimulation';
import type { DecommissionGateResult } from './compatibilityCoreDecommissionGate';

// ── Public types ─────────────────────────────────────────────────────────────

export interface ExplanationEntry {
  sectionIndex?: number;
  category: string;          // 'retry' | 'abandonment' | 'convergence' | 'compression' | 'grounding' | 'retirement'
  headline: string;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface OperationalExplanation {
  retryReasoning: ExplanationEntry[];
  abandonmentReasoning: ExplanationEntry[];
  convergenceReasoning: ExplanationEntry[];
  compressionReasoning: ExplanationEntry[];
  groundingReasoning: ExplanationEntry[];
  retirementReasoning: ExplanationEntry[];
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface BuildExplanationInput {
  lifecycleHistory?: SectionLifecycleHistoryEntry[];
  recoveryPlan?: RecoveryPlan;
  convergence?: ArticleConvergenceResult;
  groundedClaimResults?: Array<{ sectionIndex: number; result: GroundedClaimValidationResult }>;
  compressionEvents?: Array<{
    sectionIndex: number;
    mode: string;
    finalTokens: number;
    originalTokens: number;
    droppedSegmentLabels: string[];
  }>;
  retirementSimulation?: RetirementSimulationReport;
  decommissionGate?: DecommissionGateResult;
}

// ── Builders ─────────────────────────────────────────────────────────────────

function buildRetryReasoning(history: SectionLifecycleHistoryEntry[] = []): ExplanationEntry[] {
  const out: ExplanationEntry[] = [];
  for (const entry of history) {
    const retryTransitions = entry.transitions.filter((t) =>
      t.to === SectionLifecycleState.RETRYING || t.from === SectionLifecycleState.RETRYING,
    );
    if (retryTransitions.length === 0) continue;

    const categories = entry.failureCategoriesEncountered.join(', ') || 'unknown';
    const actions = entry.recoveryActionsApplied.join(' → ') || 'none';
    out.push({
      sectionIndex: entry.sectionIndex,
      category: 'retry',
      headline: `Section ${entry.sectionIndex} ("${entry.sectionTitle}") retried ${Math.max(0, entry.finalAttempt - 1)} time(s).`,
      detail: `Failure categories: [${categories}]. Recovery actions: [${actions}]. Final state: ${entry.finalState}.`,
      evidence: {
        finalAttempt: entry.finalAttempt,
        regenerationLineageId: entry.regenerationLineageId,
        finalAcceptanceReason: entry.acceptanceReason,
      },
    });
  }
  return out;
}

function buildAbandonmentReasoning(history: SectionLifecycleHistoryEntry[] = [], recoveryPlan?: RecoveryPlan): ExplanationEntry[] {
  const out: ExplanationEntry[] = [];
  for (const entry of history) {
    if (entry.finalState !== SectionLifecycleState.ABANDONED) continue;
    const planNote = recoveryPlan?.abandonedSections.find((s) => s.sectionIndex === entry.sectionIndex);
    out.push({
      sectionIndex: entry.sectionIndex,
      category: 'abandonment',
      headline: `Section ${entry.sectionIndex} ("${entry.sectionTitle}") was abandoned (${entry.abandonmentReason ?? 'unspecified'}).`,
      detail: planNote
        ? `Recovery coordinator marked it ${planNote.reason} after ${entry.finalAttempt} attempts. Categories encountered: ${entry.failureCategoriesEncountered.join(', ') || 'unknown'}.`
        : `${entry.finalAttempt} attempts exhausted. Categories encountered: ${entry.failureCategoriesEncountered.join(', ') || 'unknown'}.`,
      evidence: {
        regenerationLineageId: entry.regenerationLineageId,
        recoveryActionsApplied: entry.recoveryActionsApplied,
      },
    });
  }
  return out;
}

function buildConvergenceReasoning(convergence?: ArticleConvergenceResult): ExplanationEntry[] {
  if (!convergence) return [];
  const out: ExplanationEntry[] = [];
  out.push({
    category: 'convergence',
    headline: `Article convergence ${convergence.convergenceScore}/100 → ${convergence.shipRecommendation}.`,
    detail: convergence.reasoning.join(' '),
    evidence: {
      componentScores: convergence.componentScores,
      requiredRepairs: convergence.requiredRepairs.length,
      optionalRepairs: convergence.optionalRepairs.length,
      unsafeSections: convergence.unsafeSections.length,
    },
  });
  for (const r of convergence.requiredRepairs) {
    out.push({
      sectionIndex: r.sectionIndex,
      category: 'convergence',
      headline: `Section ${r.sectionIndex} blocks clean ship (required repair).`,
      detail: r.reason,
    });
  }
  for (const u of convergence.unsafeSections) {
    out.push({
      sectionIndex: u.sectionIndex,
      category: 'convergence',
      headline: `Section ${u.sectionIndex} flagged unsafe.`,
      detail: u.reason,
    });
  }
  return out;
}

function buildCompressionReasoning(events: BuildExplanationInput['compressionEvents'] = []): ExplanationEntry[] {
  return events.map((e) => ({
    sectionIndex: e.sectionIndex,
    category: 'compression',
    headline: `Section ${e.sectionIndex}: prompt compressed (${e.mode}), ${e.originalTokens} → ${e.finalTokens} tokens.`,
    detail: e.droppedSegmentLabels.length === 0
      ? `No segments dropped at ${e.mode}.`
      : `Dropped: ${e.droppedSegmentLabels.join(', ')}.`,
    evidence: {
      reductionPct: e.originalTokens > 0 ? Math.round(((e.originalTokens - e.finalTokens) / e.originalTokens) * 100) : 0,
    },
  }));
}

function buildGroundingReasoning(
  groundedClaimResults: Array<{ sectionIndex: number; result: GroundedClaimValidationResult }> = [],
): ExplanationEntry[] {
  const out: ExplanationEntry[] = [];
  for (const { sectionIndex, result } of groundedClaimResults) {
    if (result.verdict === 'pass') continue;
    out.push({
      sectionIndex,
      category: 'grounding',
      headline: `Section ${sectionIndex}: grounding verdict ${result.verdict} (coverage ${result.evidenceCoverage}%).`,
      detail: result.unsupportedClaims.length === 0
        ? `Hallucination risk ${result.hallucinationRisk}. ${result.softeningTargets.length} softening target(s).`
        : `${result.unsupportedClaims.length} unsupported claim(s). Hallucination risk ${result.hallucinationRisk}. Fabricated-specificity risk ${result.fabricatedSpecificityRisk}.`,
      evidence: {
        softeningActions: result.softeningTargets.map((t) => t.action),
      },
    });
  }
  return out;
}

function buildRetirementReasoning(
  sim?: RetirementSimulationReport,
  gate?: DecommissionGateResult,
): ExplanationEntry[] {
  const out: ExplanationEntry[] = [];
  if (sim) {
    out.push({
      category: 'retirement',
      headline: `Retirement simulation: projected failure rate ${(sim.projectedFailureRate * 100).toFixed(2)}%; recommendation ${sim.retirementRecommendation}.`,
      detail: sim.reasoning.join(' '),
      evidence: {
        unsafeContentTypes: sim.unsafeContentTypes.map((t) => t.content_type),
        timeoutFailureRate: sim.projectedTimeoutImpact.timeoutFailureRate,
      },
    });
  }
  if (gate) {
    out.push({
      category: 'retirement',
      headline: `Decommission gate: ${gate.mode}.`,
      detail: `Reasoning: ${gate.reasoning.join(' ')} Blockers: ${gate.blockers.length === 0 ? 'none' : gate.blockers.join('; ')}.`,
      evidence: {
        recommendedNextActions: gate.recommendedNextActions,
        checks: gate.checks,
      },
    });
  }
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function buildOperationalExplanation(input: BuildExplanationInput): OperationalExplanation {
  return {
    retryReasoning: buildRetryReasoning(input.lifecycleHistory),
    abandonmentReasoning: buildAbandonmentReasoning(input.lifecycleHistory, input.recoveryPlan),
    convergenceReasoning: buildConvergenceReasoning(input.convergence),
    compressionReasoning: buildCompressionReasoning(input.compressionEvents),
    groundingReasoning: buildGroundingReasoning(input.groundedClaimResults),
    retirementReasoning: buildRetirementReasoning(input.retirementSimulation, input.decommissionGate),
  };
}

// ── Friendly-text formatter (for admin UI / support tooling) ─────────────────

export function formatExplanationAsText(explanation: OperationalExplanation): string {
  const sections: string[] = [];
  const categories = [
    ['retryReasoning',        'Retries'],
    ['abandonmentReasoning',  'Abandonments'],
    ['convergenceReasoning',  'Convergence'],
    ['compressionReasoning',  'Compression'],
    ['groundingReasoning',    'Grounding'],
    ['retirementReasoning',   'Retirement readiness'],
  ] as const;
  for (const [key, label] of categories) {
    const entries = explanation[key];
    if (entries.length === 0) continue;
    sections.push(`### ${label}`);
    for (const e of entries) {
      sections.push(`- ${e.headline}`);
      if (e.detail) sections.push(`  - ${e.detail}`);
    }
  }
  return sections.join('\n');
}
