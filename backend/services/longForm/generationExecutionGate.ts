/**
 * Phase 3 — Generation execution gate.
 *
 * Decides whether the planner output proceeds to generation. Three modes:
 *
 *   strict      — readinessFloor 70, no dimension below floor, ANY critical
 *                 detection blocks.
 *   balanced    — readinessFloor 55, max 2 dimensions below floor, critical
 *                 detection blocks.
 *   exploratory — readinessFloor 35, dimension floors waived, only blocked
 *                 readinessBand stops execution.
 *
 * `balanced` is the engine default.
 *
 * Returns `decision`:
 *   • 'execute' — pass to generation
 *   • 'warn'    — pass with warnings
 *   • 'block'   — do NOT proceed
 */

import type {
  ExecutionGateThreshold,
  GenerationGateDecision,
  GenerationReadinessAssessment,
  PlannerGenerationContinuityResult,
} from './longFormRecommendationTypes';

interface ThresholdProfile {
  readinessFloor: number;
  minDimensionFloor: number;
  blockOnAnyCritical: boolean;
  maxBelowFloorDimensions: number;
  warnIfBlockedDimensions: number;
}

const PROFILES: Record<ExecutionGateThreshold, ThresholdProfile> = {
  strict: {
    readinessFloor: 70,
    minDimensionFloor: 55,
    blockOnAnyCritical: true,
    maxBelowFloorDimensions: 0,
    warnIfBlockedDimensions: 0,
  },
  balanced: {
    readinessFloor: 55,
    minDimensionFloor: 45,
    blockOnAnyCritical: true,
    maxBelowFloorDimensions: 2,
    warnIfBlockedDimensions: 1,
  },
  exploratory: {
    readinessFloor: 35,
    minDimensionFloor: 25,
    blockOnAnyCritical: false,
    maxBelowFloorDimensions: 4,
    warnIfBlockedDimensions: 2,
  },
};

interface BlockReason {
  dimension: string;
  reason: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface EvaluateGateInput {
  readiness: GenerationReadinessAssessment;
  plannerContinuity: PlannerGenerationContinuityResult;
  thresholdMode?: ExecutionGateThreshold;
}

export function evaluateGenerationExecutionGate(input: EvaluateGateInput): GenerationGateDecision {
  const mode = input.thresholdMode ?? 'balanced';
  const profile = PROFILES[mode];

  const blockReasons: BlockReason[] = [];
  const warnings: string[] = [];

  // 1. Readiness band check.
  if (input.readiness.readinessBand === 'blocked') {
    blockReasons.push({
      dimension: 'readinessBand',
      reason: `Readiness band 'blocked' (score=${input.readiness.generationReadinessScore} < 35).`,
      severity: 'critical',
    });
  } else if (input.readiness.generationReadinessScore < profile.readinessFloor) {
    blockReasons.push({
      dimension: 'generationReadinessScore',
      reason: `Readiness ${input.readiness.generationReadinessScore} below ${mode} floor ${profile.readinessFloor}.`,
      severity: mode === 'strict' ? 'critical' : 'major',
    });
  }

  // 2. Per-dimension floor check (skipped for exploratory).
  if (mode !== 'exploratory') {
    const dimsBelow = input.readiness.failingDimensions.filter((d) => d.score < profile.minDimensionFloor);
    if (dimsBelow.length > profile.maxBelowFloorDimensions) {
      // Strict / balanced: block.
      const overflow = dimsBelow.slice(profile.maxBelowFloorDimensions);
      for (const d of overflow) {
        blockReasons.push({
          dimension: String(d.dimension),
          reason: `${String(d.dimension)} ${d.score} below mode floor ${profile.minDimensionFloor}.`,
          severity: mode === 'strict' ? 'critical' : 'major',
        });
      }
    } else if (dimsBelow.length > profile.warnIfBlockedDimensions) {
      // Below floor but within tolerance → warn.
      warnings.push(`${dimsBelow.length} dimensions below mode floor ${profile.minDimensionFloor}: ${dimsBelow.map((d) => String(d.dimension)).join(', ')}.`);
    }
  }

  // 3. Planner-continuity high-severity detection.
  for (const det of input.plannerContinuity.detections) {
    if (det.severity === 'high') {
      if (profile.blockOnAnyCritical) {
        blockReasons.push({
          dimension: det.type,
          reason: det.detail,
          severity: 'critical',
        });
      } else {
        warnings.push(`[${det.type}] ${det.detail}`);
      }
    } else if (det.severity === 'medium') {
      warnings.push(`[${det.type}] ${det.detail}`);
    }
  }

  // 4. Always surface failing dimensions as informational warnings.
  if (input.readiness.failingDimensions.length > 0 && warnings.length < 8) {
    warnings.push(`Failing dimensions: ${input.readiness.failingDimensions.map((d) => `${String(d.dimension)}(${d.score})`).join(', ')}.`);
  }

  const passed = blockReasons.length === 0;
  const decision: GenerationGateDecision['decision'] = passed
    ? warnings.length === 0 ? 'execute' : 'warn'
    : 'block';

  return {
    thresholdMode: mode,
    passed,
    decision,
    generationBlockReasons: blockReasons,
    generationWarnings: warnings,
    appliedThresholds: {
      readinessFloor: profile.readinessFloor,
      minDimensionFloor: profile.minDimensionFloor,
      blockOnAnyCritical: profile.blockOnAnyCritical,
    },
  };
}

export { PROFILES as GATE_PROFILES };
