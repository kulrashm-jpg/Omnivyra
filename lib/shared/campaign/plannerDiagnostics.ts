/**
 * CAMPAIGN-IMPL-002 — Planner integrity & deterministic generation.
 *
 * The canonical vocabulary + invariant for "no campaign silently loses content".
 * Pure, dependency-free, client+server-safe (imported by the planner API, the
 * schedulers, and the scheduling-result UI).
 *
 * The invariant every campaign must satisfy:
 *
 *     planned  ===  generated  +  dropped.length
 *
 * `planned`   = the count the user selected (Σ format_frequency across weeks).
 * `generated` = daily_content_plans rows actually produced.
 * `dropped`   = one structured entry per lost piece, each with a reason + stage,
 *               so nothing disappears without an explanation.
 */

/** Where in the pipeline a piece was lost. */
export type DropStage =
  | 'structure_generation' // before any daily_content_plans row exists
  | 'validation'           // pre-persist row validation
  | 'scheduling'           // row exists but never reached scheduled_posts
  | 'creator_render';      // creator asset couldn't be produced/scheduled

/** Machine-readable reason a piece was dropped. */
export type DropReasonCode =
  | 'no_eligible_platform'        // format has no platform that can run it
  | 'platform_blocked'            // format explicitly blocked on the target platform (e.g. poll↛X)
  | 'exceeds_limit'               // trimmed by the business-rule clamp (IMPL-001)
  | 'duplicate_content'           // near-identical content already scheduled (same platform+type)
  | 'duplicate_platform_content'  // same content_type::topic already used on that platform
  | 'schedule_conflict'           // no free day on the platform (conflict policy = skip)
  | 'zero_platforms'              // item resolved to no platform targets
  | 'validation_failure'          // structural row validation failed
  | 'generation_failure'          // AI master/content generation failed
  | 'creator_render_failure'      // creator asset render failed / not ready
  | 'account_unavailable';        // no connected social account for the platform

export interface DroppedItem {
  content_type: string;
  /** Target platform when known; null for format-level drops before assignment. */
  platform: string | null;
  reason: DropReasonCode;
  stage: DropStage;
  /** Human detail for the UI / logs (optional). */
  detail?: string;
}

export interface PlannerReconciliation {
  planned: number;
  generated: number;
  dropped: DroppedItem[];
  /** planned === generated + dropped.length */
  ok: boolean;
}

const FRIENDLY: Record<DropReasonCode, string> = {
  no_eligible_platform: 'No selected platform can publish this format.',
  platform_blocked: 'This format is not allowed on the target platform.',
  exceeds_limit: 'Reduced to stay within the per-week limits.',
  duplicate_content: 'Near-identical content was already scheduled this week.',
  duplicate_platform_content: 'This topic was already used on this platform.',
  schedule_conflict: 'No free day was available on this platform.',
  zero_platforms: 'No platform was available for this piece.',
  validation_failure: 'The generated piece failed validation.',
  generation_failure: 'Content generation failed for this piece.',
  creator_render_failure: 'The creator asset could not be rendered.',
  account_unavailable: 'No connected account for this platform.',
};

/** User-facing message for a drop reason. */
export function dropReasonMessage(code: DropReasonCode): string {
  return FRIENDLY[code] ?? 'This piece could not be scheduled.';
}

/** Build the reconciliation record + compute the invariant flag. */
export function buildReconciliation(
  planned: number,
  generated: number,
  dropped: DroppedItem[],
): PlannerReconciliation {
  const p = Math.max(0, Math.round(planned));
  const g = Math.max(0, Math.round(generated));
  return { planned: p, generated: g, dropped, ok: p === g + dropped.length };
}

/**
 * Non-throwing invariant check. Logs a structured mismatch when
 * planned ≠ generated + dropped so a broken reconciliation is always visible,
 * and returns whether the invariant held. Never throws — a diagnostics failure
 * must not break generation.
 */
export function assertPlannerInvariant(
  r: PlannerReconciliation,
  log?: (message: string, meta: Record<string, unknown>) => void,
): boolean {
  if (!r.ok && log) {
    log('[planner-invariant] MISMATCH — planned != generated + dropped', {
      planned: r.planned,
      generated: r.generated,
      dropped: r.dropped.length,
      delta: r.planned - (r.generated + r.dropped.length),
    });
  }
  return r.ok;
}

/** Collapse a dropped[] list into a per-reason count summary for the UI. */
export function summarizeDrops(dropped: DroppedItem[]): Array<{ reason: DropReasonCode; message: string; count: number }> {
  const counts = new Map<DropReasonCode, number>();
  for (const d of dropped) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, message: dropReasonMessage(reason), count }))
    .sort((a, b) => b.count - a.count);
}
