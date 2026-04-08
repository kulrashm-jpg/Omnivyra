/**
 * Feedback Optimization Engine
 *
 * Bridges the Redis-backed contentFeedbackLoop into the primary lib/blog/
 * generation pipeline. Replaces naive angle frequency recommendation with
 * effectiveness-weighted scoring.
 *
 * Read-only access to feedback data — never writes.
 *
 * Safety: if Redis or the feedback service is unreachable, returns a
 * graceful fallback so generation is never blocked.
 */

import { getAngleEffectiveness, getToneEffectiveness } from '../../backend/services/contentFeedbackLoop';
import type { AngleType } from './blogGenerationEngine';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AngleEffectivenessEntry {
  score:       number;  // 0-1 effectiveness
  sample_size: number;
}

export interface FeedbackOptimizationResult {
  /** Per-angle effectiveness scores (only angles with data) */
  angle_effectiveness: Partial<Record<AngleType, AngleEffectivenessEntry>>;
  /** Highest-effectiveness angle with sufficient samples, or null */
  recommended_angle_type: AngleType | null;
  /** Whether there is enough data (>= MIN_SAMPLES for at least 1 angle) */
  has_sufficient_data: boolean;
  /** Pre-formatted prompt paragraph for injection into generation prompts */
  performance_learnings_prompt: string;
  /** Single-line hint for angle generation prompt */
  performance_hint: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_SAMPLES = 3;
const ANGLE_TYPES: AngleType[] = ['analytical', 'contrarian', 'strategic'];

// ── Main function ────────────────────────────────────────────────────────────

export async function getFeedbackOptimization(
  companyId:   string,
  contentType: 'blog' | 'article',
): Promise<FeedbackOptimizationResult> {
  try {
    const rawAngle = await getAngleEffectiveness(companyId, contentType);

    // Map raw data into typed structure
    const angle_effectiveness: Partial<Record<AngleType, AngleEffectivenessEntry>> = {};
    for (const type of ANGLE_TYPES) {
      const entry = rawAngle[type];
      if (entry && typeof entry.effectiveness === 'number' && typeof entry.samples === 'number') {
        angle_effectiveness[type] = {
          score:       entry.effectiveness,
          sample_size: entry.samples,
        };
      }
    }

    // Find best angle with sufficient samples
    let recommended_angle_type: AngleType | null = null;
    let bestScore = -1;

    for (const type of ANGLE_TYPES) {
      const entry = angle_effectiveness[type];
      if (entry && entry.sample_size >= MIN_SAMPLES && entry.score > bestScore) {
        bestScore = entry.score;
        recommended_angle_type = type;
      }
    }

    const has_sufficient_data = recommended_angle_type !== null;

    // Build performance learnings prompt
    const performance_learnings_prompt = buildPerformanceLearningsPrompt(angle_effectiveness, has_sufficient_data);
    const performance_hint = buildPerformanceHint(angle_effectiveness, recommended_angle_type);

    return {
      angle_effectiveness,
      recommended_angle_type,
      has_sufficient_data,
      performance_learnings_prompt,
      performance_hint,
    };
  } catch {
    // Redis/service failure — return safe fallback
    return {
      angle_effectiveness:        {},
      recommended_angle_type:     null,
      has_sufficient_data:        false,
      performance_learnings_prompt: '',
      performance_hint:           '',
    };
  }
}

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildPerformanceLearningsPrompt(
  effectiveness: Partial<Record<AngleType, AngleEffectivenessEntry>>,
  hasSufficientData: boolean,
): string {
  if (!hasSufficientData) return '';

  const lines: string[] = ['PERFORMANCE LEARNINGS (from historical content data):'];

  for (const type of ANGLE_TYPES) {
    const entry = effectiveness[type];
    if (entry) {
      const pct = Math.round(entry.score * 100);
      const suffix = entry.sample_size < MIN_SAMPLES ? ` (low confidence — only ${entry.sample_size} samples)` : '';
      lines.push(`- ${type.charAt(0).toUpperCase() + type.slice(1)} angle effectiveness: ${pct}%${suffix}`);
    } else {
      lines.push(`- ${type.charAt(0).toUpperCase() + type.slice(1)} angle: no data yet`);
    }
  }

  // Identify best and worst
  const sorted = ANGLE_TYPES
    .filter(t => effectiveness[t] && effectiveness[t]!.sample_size >= MIN_SAMPLES)
    .sort((a, b) => (effectiveness[b]?.score ?? 0) - (effectiveness[a]?.score ?? 0));

  if (sorted.length >= 2) {
    const best  = sorted[0];
    const worst = sorted[sorted.length - 1];
    lines.push('');
    lines.push(`Lean into the ${best} style — it has proven most effective for this company.`);
    if ((effectiveness[worst]?.score ?? 0) < 0.4) {
      lines.push(`Avoid heavy reliance on ${worst} patterns — they have underperformed historically.`);
    }
  }

  return lines.join('\n');
}

function buildPerformanceHint(
  effectiveness: Partial<Record<AngleType, AngleEffectivenessEntry>>,
  recommended: AngleType | null,
): string {
  if (!recommended) return '';

  const entry = effectiveness[recommended];
  if (!entry) return '';

  const pct = Math.round(entry.score * 100);
  return `Performance hint: ${recommended.charAt(0).toUpperCase() + recommended.slice(1)} angles have ${pct}% effectiveness for this company (${entry.sample_size} samples).`;
}
