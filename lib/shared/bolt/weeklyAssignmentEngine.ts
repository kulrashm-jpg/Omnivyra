/**
 * Phase 6H-1 — Intelligent Mix Weekly Assignment Engine.
 *
 * A PURE, deterministic planning function that distributes selected formats
 * across campaign weeks and allocates each to eligible platforms. It composes
 * the existing canonical authorities and adds NO new capability/eligibility
 * rules of its own:
 *   - eligibility   ← contentPlatformAssignment (6G-1)  — capability + exclusivity
 *   - attachment    ← attachmentRequiredMedia (6F-1A/B) — video/audio families
 *   - platform order← platformOrdering (6D-C)           — reorder only
 *   - format order  ← formatOrdering (6D-D)             — reorder only
 *
 * No publishing, scheduling, generation, billing, or credit logic. No DB. No
 * Date.now()/random — same inputs always yield the same weekAssignments. The
 * caller supplies `selectedPlatforms` already narrowed to connected ∩ selected
 * (eligibility lives upstream and is not duplicated here); the engine intersects
 * that with per-format capability and FAILS CLOSED (an un-runnable format is
 * dropped, never routed to an unsupported platform).
 */

import { filterPlatformsForFormat, getSupportedPlatformsForFormat } from './contentPlatformAssignment';
import {
  orderPlatformsForIntelligentMix,
  type PlatformPerformanceRank,
  type PlatformPriorityMode,
} from '../intelligence/platformOrdering';
import {
  orderFormatsForIntelligentMix,
  type FormatPerformanceSignal,
  type FormatPriorityMode,
} from '../intelligence/formatOrdering';
import {
  isAttachmentRequiredMedia,
  getRequiredAssetType,
  normalizeAttachmentMediaFormat,
  type RequiredAssetType,
} from './attachmentRequiredMedia';

export interface WeeklyAssignmentInput {
  durationWeeks: number;
  /** Connected ∩ selected platforms (eligibility resolved upstream). */
  selectedPlatforms: string[];
  /** format → posts per week (total across platforms). */
  formatFrequency: Record<string, number>;
  /** 6D-C signal (optional). */
  platformPriorities?: PlatformPerformanceRank[];
  /** 6D-D signal (optional). */
  formatPriorities?: FormatPerformanceSignal[];
  /** 6D-C mode (default 'off' → deterministic, order preserved). */
  platformPriorityMode?: PlatformPriorityMode;
  /** 6D-D mode (default 'off'). */
  formatPriorityMode?: FormatPriorityMode;
}

export interface WeekFormatAssignment {
  format: string;
  platform: string;
  count: number;
  attachmentRequired: boolean;
  requiredAssetType: RequiredAssetType | null;
}

export interface WeekAssignment {
  week: number; // 1-based
  assignments: WeekFormatAssignment[];
}

export interface WeeklyAssignmentDiagnostics {
  weekly_assignments_generated: number;
  eligible_platform_count: number;
  platform_rotations_used: number;
  format_rotations_used: number;
  invalid_assignments_prevented: number;
}

export interface WeeklyAssignmentResult {
  weekAssignments: WeekAssignment[];
  diagnostics: WeeklyAssignmentDiagnostics;
}

export function buildWeeklyAssignments(input: WeeklyAssignmentInput): WeeklyAssignmentResult {
  const duration = Math.max(0, Math.floor(Number(input?.durationWeeks) || 0));
  const selected = Array.isArray(input?.selectedPlatforms) ? input.selectedPlatforms : [];
  const freqMap = input?.formatFrequency && typeof input.formatFrequency === 'object' ? input.formatFrequency : {};
  const platformMode: PlatformPriorityMode = input?.platformPriorityMode ?? 'off';
  const formatMode: FormatPriorityMode = input?.formatPriorityMode ?? 'off';

  const empty: WeeklyAssignmentResult = {
    weekAssignments: [],
    diagnostics: {
      weekly_assignments_generated: 0,
      eligible_platform_count: 0,
      platform_rotations_used: 0,
      format_rotations_used: 0,
      invalid_assignments_prevented: 0,
    },
  };
  if (duration === 0 || selected.length === 0) return empty;

  // Format intelligence — reorder only; frequency/membership untouched (6D-D).
  const requestedFormats = Object.keys(freqMap).filter((f) => Number(freqMap[f]) > 0);
  if (requestedFormats.length === 0) return empty;
  const orderedFormats = orderFormatsForIntelligentMix(requestedFormats, input?.formatPriorities ?? [], formatMode).order;

  // Resolve per-format eligibility (capability ∩ selected) + platform intelligence (6D-C).
  let prevented = 0;
  const perFormat = orderedFormats
    .map((format) => {
      const canonical = normalizeAttachmentMediaFormat(format);
      const freq = Math.max(0, Math.floor(Number(freqMap[format]) || 0));
      // eligible = selected ∩ capability-supported, preserving selected order; fail-closed.
      const eligibleRaw = filterPlatformsForFormat(selected, canonical);
      // platform intelligence reorders WITHIN the eligible set (never adds/removes).
      const eligible = orderPlatformsForIntelligentMix(eligibleRaw, input?.platformPriorities ?? [], platformMode).order;
      return {
        format,
        canonical,
        freq,
        eligible,
        attachmentRequired: isAttachmentRequiredMedia(canonical),
        requiredAssetType: getRequiredAssetType(canonical),
      };
    })
    .filter((pf) => pf.freq > 0);

  const usedPlatforms = new Set<string>();
  let totalPicks = 0;
  let assignedFormats = 0;
  const rotationPtr: Record<string, number> = {};

  const weekAssignments: WeekAssignment[] = [];
  for (let week = 1; week <= duration; week++) {
    const assignments: WeekFormatAssignment[] = [];
    for (const pf of perFormat) {
      if (pf.eligible.length === 0) {
        // No legal platform for this format (e.g. carousel with only YouTube
        // selected, or podcast/audio with no audio destination). Counted once.
        if (week === 1) prevented += pf.freq * duration;
        continue;
      }
      if (week === 1) assignedFormats += 1;
      // Weighted rotation: each instance advances a per-format pointer across
      // weeks AND instances, so platforms rotate evenly with no front-loading.
      const counts = new Map<string, number>();
      for (let i = 0; i < pf.freq; i++) {
        const idx = (rotationPtr[pf.format] ?? 0) % pf.eligible.length;
        const platform = pf.eligible[idx];
        counts.set(platform, (counts.get(platform) ?? 0) + 1);
        rotationPtr[pf.format] = (rotationPtr[pf.format] ?? 0) + 1;
        usedPlatforms.add(platform);
        totalPicks += 1;
      }
      for (const [platform, count] of counts) {
        assignments.push({
          format: pf.format,
          platform,
          count,
          attachmentRequired: pf.attachmentRequired,
          requiredAssetType: pf.requiredAssetType,
        });
      }
    }
    weekAssignments.push({ week, assignments });
  }

  return {
    weekAssignments,
    diagnostics: {
      weekly_assignments_generated: weekAssignments.reduce((s, w) => s + w.assignments.length, 0),
      eligible_platform_count: usedPlatforms.size,
      platform_rotations_used: totalPicks,
      format_rotations_used: assignedFormats,
      invalid_assignments_prevented: prevented,
    },
  };
}
