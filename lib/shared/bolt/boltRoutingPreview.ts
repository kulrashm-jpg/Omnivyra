/**
 * Phase 2A — Scheduling route preview & telemetry (INERT INFRASTRUCTURE).
 *
 * Provides the ability to compute, for a campaign's rows:
 *   - the CURRENT route  (campaign-level, exactly what the scheduler does
 *                          today via `usesUnifiedMediaFlow`), and
 *   - the FUTURE route   (per-row, what row-level routing WOULD choose).
 *
 * ────────────────────────────────────────────────────────────────────────
 * IMPORTANT — FUTURE ROUTE IS INFORMATIONAL ONLY (Phase 2A boundary):
 *   The future (row-level) route is computed for visibility/telemetry. It
 *   is NEVER consumed by any scheduling decision in Phase 2A. The live
 *   scheduler continues to route by campaign mode. Nothing in the execution
 *   path imports this module. Activation is Phase 2B.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Pure functions only — no DB, no scheduler interaction, no side effects.
 * `emitRoutingDiagnostics` performs logging ONLY through an injected logger
 * (no global console/IO), so importing this module changes nothing on its
 * own.
 */

import { classifyRowLane, type RoutableRow, type RowRoutingDecision, type SchedulingLane } from './rowSchedulingLane';

/**
 * The two scheduler paths that exist today. `processCreatorStructuredSchedule`
 * is the CREATOR_PATH; the text/queue/legacy builders are the TEXT_PATH.
 * `HOLD` represents a row that neither path schedules (ineligible / waiting).
 */
export type CampaignSchedulingPath = 'CREATOR_PATH' | 'TEXT_PATH' | 'HOLD';

/**
 * Faithful read-only reproduction of the scheduler's CURRENT campaign-level
 * routing decision. Mirrors `usesUnifiedMediaFlow = executionProfile === 'creator'`
 * in structuredPlanScheduler.ts WITHOUT importing or modifying it.
 *
 * Today every row in a campaign takes this single path.
 */
export function computeCurrentCampaignPath(executionProfile: string | null | undefined): CampaignSchedulingPath {
  return String(executionProfile ?? '').trim() === 'creator' ? 'CREATOR_PATH' : 'TEXT_PATH';
}

/** Map a per-row lane to the scheduler path that row-level routing WOULD use. */
export function laneToFuturePath(lane: SchedulingLane): CampaignSchedulingPath {
  switch (lane) {
    case 'TEXT':
      return 'TEXT_PATH';
    case 'CREATOR_AUTONOMOUS':
    case 'CREATOR_ATTACHMENT':
      return 'CREATOR_PATH';
    case 'VIDEO_WAITING':
    case 'INELIGIBLE':
    default:
      return 'HOLD';
  }
}

export interface RowRoutePreview {
  decision: RowRoutingDecision;
  /** What the scheduler does today for this row (campaign-level). */
  currentPath: CampaignSchedulingPath;
  /** What row-level routing WOULD do (Phase 2B). Informational only. */
  futurePath: CampaignSchedulingPath;
  /** True if the future per-row path differs from today's campaign path. */
  wouldReroute: boolean;
}

/**
 * Per-row preview comparing current (campaign-level) vs future (row-level)
 * routing. Future path is NEVER acted on — for diagnostics/telemetry only.
 */
export function previewRowRoutes(
  executionProfile: string | null | undefined,
  rows: Array<RoutableRow | null | undefined>,
): RowRoutePreview[] {
  const currentPath = computeCurrentCampaignPath(executionProfile);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const decision = classifyRowLane(row);
    const futurePath = laneToFuturePath(decision.lane);
    return {
      decision,
      currentPath,
      futurePath,
      wouldReroute: futurePath !== currentPath,
    };
  });
}

export interface RoutingDiagnostics {
  execution_profile: string;
  current_path: CampaignSchedulingPath;
  total_rows: number;
  text_rows: number;
  creator_rows: number;
  autonomous_rows: number;
  attachment_rows: number;
  video_waiting_rows: number;
  ineligible_rows: number;
  /** Rows whose future per-row path would differ from today's campaign path. */
  rows_that_would_reroute: number;
  /** Lane → count breakdown. */
  by_lane: Record<SchedulingLane, number>;
  /**
   * Always true in Phase 2A — declares that these diagnostics did NOT
   * influence any scheduling decision. A guard against accidental wiring.
   */
  routing_active: false;
}

const EMPTY_BY_LANE: Record<SchedulingLane, number> = {
  TEXT: 0,
  CREATOR_AUTONOMOUS: 0,
  CREATOR_ATTACHMENT: 0,
  VIDEO_WAITING: 0,
  INELIGIBLE: 0,
};

/**
 * Build diagnostics for a campaign's rows. Pure. The result is a plain data
 * object; producing it has no effect on scheduling.
 */
export function buildRoutingDiagnostics(
  executionProfile: string | null | undefined,
  rows: Array<RoutableRow | null | undefined>,
): RoutingDiagnostics {
  const profile = String(executionProfile ?? '').trim();
  const currentPath = computeCurrentCampaignPath(profile);
  const previews = previewRowRoutes(profile, rows);
  const byLane: Record<SchedulingLane, number> = { ...EMPTY_BY_LANE };
  let creatorRows = 0;
  let reroute = 0;

  for (const p of previews) {
    byLane[p.decision.lane] += 1;
    if (p.decision.intent === 'creator') creatorRows += 1;
    if (p.wouldReroute) reroute += 1;
  }

  return {
    execution_profile: profile,
    current_path: currentPath,
    total_rows: previews.length,
    text_rows: byLane.TEXT,
    creator_rows: creatorRows,
    autonomous_rows: byLane.CREATOR_AUTONOMOUS,
    attachment_rows: byLane.CREATOR_ATTACHMENT,
    video_waiting_rows: byLane.VIDEO_WAITING,
    ineligible_rows: byLane.INELIGIBLE,
    rows_that_would_reroute: reroute,
    by_lane: byLane,
    routing_active: false,
  };
}

/** Minimal logger contract — satisfied by console or a structured logger. */
export type DiagnosticsLogger = (event: string, payload: Record<string, unknown>) => void;

/**
 * Emit diagnostics through an INJECTED logger only. No global IO. Callers in
 * Phase 2B may wire this into the pipeline/scheduler for observability; in
 * Phase 2A it is invoked only by tests. Returns the diagnostics it emitted.
 */
export function emitRoutingDiagnostics(
  diagnostics: RoutingDiagnostics,
  logger?: DiagnosticsLogger,
): RoutingDiagnostics {
  if (typeof logger === 'function') {
    logger('bolt.routing.preview', { ...diagnostics });
  }
  return diagnostics;
}
