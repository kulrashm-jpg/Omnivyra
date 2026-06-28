/**
 * Design System coverage validation (CREATOR-029).
 *
 * Pure, deterministic check run before campaign generation: for every asset family
 * the campaign actually requests (frequency > 0), the pinned Design System must hold
 * at least one template for that family. A requested-but-empty family is a coverage
 * gap — surfaced as a non-blocking warning (the user may Manage Templates or Continue
 * Anyway). No template is ever auto-created. No AI. Reused by the planner UI and the
 * pre-generation guard so both compute coverage identically.
 */

import type { TemplateAssetFamily } from './types';

export interface RequestedFamilyFrequency {
  family: TemplateAssetFamily;
  frequency: number;
}

export interface DesignSystemCoverageInput {
  /** Families the campaign requests + how many pieces (from format_frequency / mix). */
  requestedFamilies: RequestedFamilyFrequency[];
  /** Templates the pinned Design System holds per family (0 when absent). */
  selectedCountByFamily: Partial<Record<TemplateAssetFamily, number>>;
}

export interface CoverageGap {
  family: TemplateAssetFamily;
  /** Requested pieces for this family (> 0). */
  frequency: number;
  /** Templates available in the Design System (0 for a gap). */
  selected: number;
}

export interface DesignSystemCoverageReport {
  /** True when every requested family has ≥ 1 template. */
  ok: boolean;
  /** Requested families (frequency > 0) with zero templates. */
  gaps: CoverageGap[];
  /** Requested families that ARE covered. */
  covered: TemplateAssetFamily[];
}

/**
 * Evaluate coverage. A family contributes a gap only when it is genuinely requested
 * (frequency > 0) AND the Design System has no template for it. Families with
 * frequency 0 are ignored (not requested), and templates for un-requested families
 * are simply unused — never a gap.
 */
export function evaluateDesignSystemCoverage(input: DesignSystemCoverageInput): DesignSystemCoverageReport {
  const gaps: CoverageGap[] = [];
  const covered: TemplateAssetFamily[] = [];
  const seen = new Set<TemplateAssetFamily>();
  for (const { family, frequency } of input.requestedFamilies) {
    if (seen.has(family)) continue; // de-dupe repeated family rows
    seen.add(family);
    if (!Number.isFinite(frequency) || frequency <= 0) continue;
    const selected = input.selectedCountByFamily[family] ?? 0;
    if (selected <= 0) gaps.push({ family, frequency, selected: 0 });
    else covered.push(family);
  }
  return { ok: gaps.length === 0, gaps, covered };
}

/** Human-readable warning lines (e.g. "Carousel requested but Design System has zero Carousel templates."). */
export function coverageWarnings(report: DesignSystemCoverageReport): string[] {
  const label = (f: TemplateAssetFamily) => f.charAt(0).toUpperCase() + f.slice(1);
  return report.gaps.map((g) => `${label(g.family)} requested but Design System has zero ${label(g.family)} templates.`);
}
