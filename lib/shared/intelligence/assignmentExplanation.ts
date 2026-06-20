/**
 * Phase 6G-2 — Assignment explainability (READ-ONLY).
 *
 * A pure, deterministic layer that explains WHY platforms/formats were removed,
 * reordered, or left unresolved during Intelligent Mix planning. It mutates
 * nothing and changes no execution: it re-derives the same decisions the live
 * authorities already make and turns them into fixed strings.
 *
 * Derived from (no duplicated rules):
 *   - contentPlatformAssignment (6G-1)  — capability / exclusivity
 *   - formatPlatformBinding             — exclusivity reason text
 *   - platformOrdering (6D-C)           — platform reorder detection
 *   - formatOrdering (6D-D1)            — format reorder detection
 *
 * Combined-only: returns an empty explanation unless `isCombined` is true, so
 * BOLT Text / Creator surfaces are never affected.
 */

import { getSupportedPlatformsForFormat, isValidPlatformFormatPair } from '../bolt/contentPlatformAssignment';
import { FORMAT_EXCLUSIVE_PLATFORMS } from '../bolt/formatPlatformBinding';
import {
  orderPlatformsForIntelligentMix,
  type PlatformPerformanceRank,
  type PlatformPriorityMode,
} from './platformOrdering';
import {
  orderFormatsForIntelligentMix,
  type FormatPerformanceSignal,
  type FormatPriorityMode,
} from './formatOrdering';

export interface RemovalEntry {
  name: string;
  reason: 'capability' | 'exclusivity' | 'unsupported_on_selected' | 'unresolved';
  message: string;
}
export interface UnsupportedEntry {
  platform: string;
  format: string;
  reason: 'capability' | 'exclusivity';
  message: string;
}
export interface ReorderEntry {
  previous: string[];
  order: string[];
  message: string;
}

export interface AssignmentExplanation {
  removedPlatforms: RemovalEntry[];
  removedFormats: RemovalEntry[];
  reorderedPlatforms: ReorderEntry[];
  reorderedFormats: ReorderEntry[];
  unsupportedAssignments: UnsupportedEntry[];
  unresolvedFormats: RemovalEntry[];
  diagnostics: {
    assignment_explanations_generated: number;
    unsupported_assignments_detected: number;
    unresolved_formats_detected: number;
  };
}

export interface AssignmentExplanationInput {
  /** Connected ∩ selected platforms (the eligible candidate set). */
  selectedPlatforms: string[];
  /** Text + creator formats chosen. */
  selectedFormats: string[];
  platformPriorities?: PlatformPerformanceRank[];
  formatPriorities?: FormatPerformanceSignal[];
  platformPriorityMode?: PlatformPriorityMode;
  formatPriorityMode?: FormatPriorityMode;
  /** Explanations are produced ONLY for Intelligent Mix. */
  isCombined?: boolean;
}

const norm = (x: unknown) => String(x ?? '').toLowerCase().trim();

function emptyExplanation(): AssignmentExplanation {
  return {
    removedPlatforms: [],
    removedFormats: [],
    reorderedPlatforms: [],
    reorderedFormats: [],
    unsupportedAssignments: [],
    unresolvedFormats: [],
    diagnostics: {
      assignment_explanations_generated: 0,
      unsupported_assignments_detected: 0,
      unresolved_formats_detected: 0,
    },
  };
}

export function buildAssignmentExplanation(input: AssignmentExplanationInput): AssignmentExplanation {
  const out = emptyExplanation();
  if (!input?.isCombined) return out;

  const platforms = [...new Set((input.selectedPlatforms ?? []).map(norm).filter(Boolean))];
  const formats = [...new Set((input.selectedFormats ?? []).map(norm).filter(Boolean))];
  if (platforms.length === 0 && formats.length === 0) return out;

  // Per-format global capability (against ALL platforms). Empty ⇒ unresolved
  // capability (e.g. podcast/audio — no publish destination anywhere).
  const resolvedFormats: string[] = [];
  for (const f of formats) {
    const globalSupport = getSupportedPlatformsForFormat(f);
    if (globalSupport.length === 0) {
      out.unresolvedFormats.push({
        name: f,
        reason: 'unresolved',
        message: `${f} has no publish destination.`,
      });
      continue;
    }
    resolvedFormats.push(f);

    // Format removed when NO selected platform can run it.
    const eligible = platforms.filter((p) => isValidPlatformFormatPair(p, f));
    if (platforms.length > 0 && eligible.length === 0) {
      out.removedFormats.push({
        name: f,
        reason: 'unsupported_on_selected',
        message: `${f} removed — unsupported on the selected platforms (${platforms.join(', ')}).`,
      });
    }
  }

  // Unsupported (platform, format) pairs — with exclusivity-aware reasons.
  for (const f of resolvedFormats) {
    const exclusive = FORMAT_EXCLUSIVE_PLATFORMS[f];
    for (const p of platforms) {
      if (isValidPlatformFormatPair(p, f)) continue;
      if (exclusive) {
        out.unsupportedAssignments.push({
          platform: p,
          format: f,
          reason: 'exclusivity',
          message: `${f} is exclusive to ${exclusive.join('/')} — removed from ${p}.`,
        });
      } else {
        out.unsupportedAssignments.push({
          platform: p,
          format: f,
          reason: 'capability',
          message: `${f} removed from ${p} (unsupported).`,
        });
      }
    }
  }

  // Platform removed when it supports NONE of the resolved selected formats.
  for (const p of platforms) {
    if (resolvedFormats.length === 0) break;
    const failFormats = resolvedFormats.filter((f) => !isValidPlatformFormatPair(p, f));
    if (failFormats.length === resolvedFormats.length) {
      out.removedPlatforms.push({
        name: p,
        reason: 'capability',
        message: `${p} removed — supports none of the selected formats (${failFormats.join(', ')}).`,
      });
    }
  }

  // Reorderings — only when intelligence ACTUALLY changed the applied order.
  const platformMode: PlatformPriorityMode = input.platformPriorityMode ?? 'off';
  const formatMode: FormatPriorityMode = input.formatPriorityMode ?? 'off';

  if (platforms.length > 1) {
    const po = orderPlatformsForIntelligentMix(platforms, input.platformPriorities ?? [], platformMode);
    if (po.order.some((p, i) => p !== platforms[i])) {
      out.reorderedPlatforms.push({
        previous: platforms,
        order: po.order,
        message: `${po.order[0]} prioritized — platform intelligence reordered by historical engagement.`,
      });
    }
  }

  if (resolvedFormats.length > 1) {
    const fo = orderFormatsForIntelligentMix(resolvedFormats, input.formatPriorities ?? [], formatMode);
    if (fo.order.some((f, i) => f !== resolvedFormats[i])) {
      out.reorderedFormats.push({
        previous: resolvedFormats,
        order: fo.order,
        message: `${fo.order[0]} prioritized — format intelligence reordered by prior content performance.`,
      });
    }
  }

  out.diagnostics = {
    assignment_explanations_generated:
      out.removedPlatforms.length + out.removedFormats.length + out.reorderedPlatforms.length +
      out.reorderedFormats.length + out.unsupportedAssignments.length + out.unresolvedFormats.length,
    unsupported_assignments_detected: out.unsupportedAssignments.length,
    unresolved_formats_detected: out.unresolvedFormats.length,
  };
  return out;
}

// ─── Flat per-pair decision contract (6G-2 refined) ─────────────────────────

export type AssignmentAction = 'ALLOWED' | 'REMOVED' | 'RESTRICTED';

/**
 * One decision per (format, platform) pair. Reasons derive ONLY from the
 * canonical authorities (capability via getSupportedPlatformsForFormat /
 * isValidPlatformFormatPair + FORMAT_EXCLUSIVE_PLATFORMS) — never hardcoded
 * compatibility. This is a flat VIEW of the same authority used everywhere
 * else; it is not a second compatibility system.
 */
export interface AssignmentDecision {
  format: string;
  platform: string;
  action: AssignmentAction;
  reason: string;
}

export function buildAssignmentDecisions(input: {
  selectedPlatforms: string[];
  selectedFormats: string[];
  isCombined?: boolean;
}): AssignmentDecision[] {
  if (!input?.isCombined) return [];
  const platforms = [...new Set((input.selectedPlatforms ?? []).map(norm).filter(Boolean))];
  const formats = [...new Set((input.selectedFormats ?? []).map(norm).filter(Boolean))];
  if (platforms.length === 0 || formats.length === 0) return [];

  const decisions: AssignmentDecision[] = [];
  for (const f of formats) {
    const globalSupport = getSupportedPlatformsForFormat(f); // [] ⇒ unresolved capability
    const exclusive = FORMAT_EXCLUSIVE_PLATFORMS[f];
    for (const p of platforms) {
      if (isValidPlatformFormatPair(p, f)) {
        decisions.push(
          exclusive
            ? { format: f, platform: p, action: 'RESTRICTED', reason: `${f} is exclusive to ${exclusive.join('/')}.` }
            : { format: f, platform: p, action: 'ALLOWED', reason: `${p} supports ${f} content.` },
        );
      } else {
        const reason =
          globalSupport.length === 0
            ? `${f} has no publish destination.`
            : exclusive
              ? `${f} is exclusive to ${exclusive.join('/')} — not available on ${p}.`
              : `${p} does not support ${f} content.`;
        decisions.push({ format: f, platform: p, action: 'REMOVED', reason });
      }
    }
  }
  return decisions;
}
