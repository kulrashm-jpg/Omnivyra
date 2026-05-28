/**
 * Partial-draft salvage for campaign planner.
 *
 * The drafting LLM call can produce text that the strict
 * `parseAndValidateCampaignPlan` parser rejects (missing fields, mid-stream
 * truncation, malformed week headers). Pre-salvage, the planner falls all
 * the way to a deterministic placeholder. This helper tries one cheap, sync,
 * regex-only pass to extract whatever weekly structure is identifiable in
 * the raw text and returns it as a valid structured plan stitched together
 * with skeleton-derived defaults for any missing weeks.
 *
 * Priority order:
 *   1. Partial parsed plan from rawText  ← this helper
 *   2. Partial weekly skeleton           ← buildPlaceholderPlanFromSkeleton
 *   3. Deterministic placeholder         ← buildPlaceholderPlanFromSkeleton (same path)
 *
 * Safety: this function NEVER throws. It returns `{ structured: null }` when
 * salvage is not safe. Acceptance criteria (configurable, all must be true):
 *   - At least 1 week block was recognized in the raw text.
 *   - That week has a non-empty theme OR objective.
 *   - The total recognized week count is ≥ `minSalvagedWeeks` (default 3),
 *     OR the skeleton can fill in the rest.
 *
 * Output is always validated: a returned `structured` plan has
 * `Array.isArray(weeks)` and each week has at minimum `{ week: number, theme:
 * string, primary_objective: string }`. Downstream code can rely on that
 * shape.
 */

import { buildPlaceholderPlanFromSkeleton } from '../campaign-ai/campaignAiPlanSkeleton';

export type PartialDraftSalvageResult = {
  structured: any | null;
  salvaged: boolean;
  salvagedWeekCount: number;
  totalWeekCount: number;
  reason?: string;
};

export interface PartialDraftSalvageArgs {
  rawText: string;
  planSkeleton: any;
  prefilledPlanning?: Record<string, unknown> | null;
  /** Minimum number of weeks that must be recognized to accept salvage. */
  minSalvagedWeeks?: number;
}

function safeMatchAll(text: string, re: RegExp): RegExpMatchArray[] {
  try {
    return Array.from(text.matchAll(re));
  } catch {
    return [];
  }
}

/**
 * Conservative regex scan over the raw draft text to identify week blocks.
 * Recognized header formats:
 *   - **Week 1**
 *   - Week 1:
 *   - Week Number: Week 1
 *   - 1. Week Number: Week 1
 */
function splitWeeks(rawText: string): Array<{ week: number; body: string }> {
  if (!rawText || typeof rawText !== 'string') return [];
  // Strip wrapper markers if present.
  const marked = rawText.match(/BEGIN_12WEEK_PLAN([\s\S]*?)END_12WEEK_PLAN/);
  const text = marked ? marked[1] : rawText;

  // Find every header position. We use indexOf style to slice bodies
  // between headers without disturbing matchAll's read pointer.
  const headerRe = /(?:^|\n)\s*(?:\*\*\s*)?(?:Week Number:\s*)?Week\s+(\d{1,2})\b[^\n]*/gi;
  const headers = safeMatchAll(text, headerRe)
    .map((m) => ({ idx: m.index ?? -1, weekNum: Number(m[1]) }))
    .filter((h) => h.idx >= 0 && h.weekNum >= 1 && h.weekNum <= 52);

  if (headers.length === 0) return [];

  const blocks: Array<{ week: number; body: string }> = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].idx;
    const end = i + 1 < headers.length ? headers[i + 1].idx : text.length;
    const body = text.slice(start, end);
    blocks.push({ week: headers[i].weekNum, body });
  }
  return blocks;
}

function extractField(body: string, label: string): string {
  // Matches: "Theme: Foo" / "**Theme**: Foo" / "- Theme: Foo"
  const re = new RegExp(
    `(?:^|\\n)\\s*[-*]?\\s*\\*?\\*?\\s*${label}\\s*\\*?\\*?\\s*[:\\-]\\s*([^\\n]+)`,
    'i',
  );
  const m = body.match(re);
  return m ? m[1].trim().replace(/^[*"']+|[*"']+$/g, '').trim() : '';
}

function isWeekBlockUsable(theme: string, objective: string): boolean {
  return theme.length > 0 || objective.length > 0;
}

export function attemptPartialDraftSalvage({
  rawText,
  planSkeleton,
  prefilledPlanning,
  minSalvagedWeeks = 3,
}: PartialDraftSalvageArgs): PartialDraftSalvageResult {
  if (!rawText || rawText.length < 30) {
    return {
      structured: null,
      salvaged: false,
      salvagedWeekCount: 0,
      totalWeekCount: 0,
      reason: 'empty_or_too_short',
    };
  }

  const blocks = splitWeeks(rawText);
  if (blocks.length === 0) {
    return {
      structured: null,
      salvaged: false,
      salvagedWeekCount: 0,
      totalWeekCount: 0,
      reason: 'no_week_headers_found',
    };
  }

  // Extract per-week usable content.
  const salvagedWeeks: any[] = [];
  for (const blk of blocks) {
    const theme = extractField(blk.body, 'Theme');
    const objective =
      extractField(blk.body, 'Primary Objective') ||
      extractField(blk.body, 'Objective');
    if (!isWeekBlockUsable(theme, objective)) continue;
    salvagedWeeks.push({
      week: blk.week,
      theme: theme || 'Recovered theme',
      primary_objective: objective || 'Recovered objective — refine when ready',
      topicFocus: extractField(blk.body, 'Topic Focus') || extractField(blk.body, 'Topic'),
      cta: extractField(blk.body, 'CTA') || extractField(blk.body, 'Call to Action'),
      audience: extractField(blk.body, 'Audience'),
      partial_salvage: true,
    });
  }

  if (salvagedWeeks.length === 0) {
    return {
      structured: null,
      salvaged: false,
      salvagedWeekCount: 0,
      totalWeekCount: blocks.length,
      reason: 'no_usable_week_fields',
    };
  }

  // Build a placeholder baseline and merge salvaged weeks over the matching
  // week numbers so the final structure has the right total week count.
  let baseline: any;
  try {
    baseline = buildPlaceholderPlanFromSkeleton({
      skeleton: planSkeleton,
      prefilledPlanning: prefilledPlanning ?? null,
    });
  } catch {
    // Without a baseline we can't safely return a partial structure — the
    // total week count would be wrong.
    return {
      structured: null,
      salvaged: false,
      salvagedWeekCount: salvagedWeeks.length,
      totalWeekCount: blocks.length,
      reason: 'placeholder_baseline_unavailable',
    };
  }

  if (!baseline || !Array.isArray(baseline.weeks) || baseline.weeks.length === 0) {
    return {
      structured: null,
      salvaged: false,
      salvagedWeekCount: salvagedWeeks.length,
      totalWeekCount: blocks.length,
      reason: 'placeholder_baseline_has_no_weeks',
    };
  }

  // Acceptance threshold: when we don't have a planSkeleton-derived baseline
  // covering enough weeks, require minSalvagedWeeks worth of actual salvage.
  const totalWeeks = baseline.weeks.length;
  if (salvagedWeeks.length < Math.min(minSalvagedWeeks, totalWeeks)) {
    return {
      structured: null,
      salvaged: false,
      salvagedWeekCount: salvagedWeeks.length,
      totalWeekCount: totalWeeks,
      reason: 'below_min_salvaged_weeks',
    };
  }

  const byWeek = new Map<number, any>();
  for (const w of salvagedWeeks) byWeek.set(w.week, w);

  const mergedWeeks = baseline.weeks.map((bw: any) => {
    const weekNum = Number(bw?.week ?? 0);
    const salv = byWeek.get(weekNum);
    if (!salv) return bw;
    return {
      ...bw,
      theme: salv.theme || bw.theme,
      primary_objective: salv.primary_objective || bw.primary_objective,
      topicFocus: salv.topicFocus || bw.topicFocus,
      cta: salv.cta || bw.cta,
      audience: salv.audience || bw.audience,
      partial_salvage: true,
    };
  });

  return {
    structured: {
      ...baseline,
      weeks: mergedWeeks,
      partial_salvage_used: true,
      salvaged_week_count: salvagedWeeks.length,
    },
    salvaged: true,
    salvagedWeekCount: salvagedWeeks.length,
    totalWeekCount: totalWeeks,
  };
}
