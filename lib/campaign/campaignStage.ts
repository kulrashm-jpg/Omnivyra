/**
 * Strategic Mix R2-P4 — the Canonical Campaign Status Read Model
 * (SPEC-001 §5.1).
 *
 * THE single approved read path for campaign lifecycle inside Strategic
 * Mix. The three physical status axes (campaigns.status, current_stage,
 * execution_status — plus blueprint_status) remain untouched in the
 * database; this resolver is the ONLY place their interpretation lives.
 * No Strategic Mix component may compare those raw fields directly — the
 * campaignStageGovernance source-scan test fails CI on new offenders.
 *
 * Pure and deterministic: same row → same stage, no I/O, no clock.
 */

/** The closed canonical vocabulary (I-11 — additions require a spec
 *  amendment; free-text stage values are forbidden). */
export type CanonicalCampaignStage =
  | 'draft'
  | 'planning'
  | 'alignment'
  | 'review'
  | 'scheduling'
  | 'ready'
  | 'executing'
  | 'completed'
  | 'paused'
  | 'archived';

export const CANONICAL_CAMPAIGN_STAGES: readonly CanonicalCampaignStage[] = [
  'draft', 'planning', 'alignment', 'review', 'scheduling', 'ready',
  'executing', 'completed', 'paused', 'archived',
];

/** The raw axes exactly as stored today (read-only view; never written here). */
export interface CampaignStatusFields {
  status?: string | null;
  current_stage?: string | null;
  execution_status?: string | null;
  blueprint_status?: string | null;
  thread_id?: string | null;
}

/** Optional planner-session signals for the stages that exist only in
 *  planning space (a campaign row alone cannot distinguish planning from
 *  alignment/review — the assignments live in the snapshot). */
export interface CampaignStageHints {
  /** Number of assignments in planner_state (Alignment has begun). */
  assignments_count?: number;
  /** True when the user reached the Board/review surface. */
  reviewing?: boolean;
}

export interface CampaignStageResolution {
  stage: CanonicalCampaignStage;
  /** Orthogonal flags (SPEC-001 §5.1 models paused/archived as flags). */
  paused: boolean;
  archived: boolean;
  /** Raw values consumed, for diagnostics — never for branching. */
  sources: { status: string; current_stage: string; execution_status: string };
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** current_stage → canonical mapping for the values the pipeline writes
 *  today. Unknown values NEVER invent vocabulary — they fall through to
 *  the status-axis defaults (free-text tolerated on read, contained here). */
const CURRENT_STAGE_MAP: Record<string, CanonicalCampaignStage> = {
  planning: 'planning',
  campaign_week_plan: 'scheduling',
  blueprint_committed: 'scheduling',
  execution_ready: 'ready',
  // P1: 'schedule' is what the scheduling writers have always emitted
  // (commit-plan, schedule-structured-plan, the live BOLT path, and now the
  // Strategic Mix release seam). It was absent here, so a genuinely scheduled
  // campaign read back as 'planning'. No new vocabulary — an existing raw
  // value mapped onto the existing canonical stage it always meant.
  schedule: 'scheduling',
};

/**
 * Resolve the canonical stage. Deterministic precedence, most-terminal
 * first:
 *   archived → completed → paused → executing → (current_stage map) →
 *   draft → planning(+hints: alignment/review)
 */
export function resolveCampaignStage(
  row: CampaignStatusFields | null | undefined,
  hints?: CampaignStageHints,
): CampaignStageResolution {
  const status = norm(row?.status);
  const currentStage = norm(row?.current_stage);
  const executionStatus = norm(row?.execution_status);
  const sources = { status, current_stage: currentStage, execution_status: executionStatus };

  const archived = status === 'archived';
  const paused = executionStatus === 'paused' || status === 'paused';

  let stage: CanonicalCampaignStage;
  if (archived) {
    stage = 'archived';
  } else if (executionStatus === 'completed' || status === 'completed') {
    stage = 'completed';
  } else if (paused) {
    stage = 'paused';
  } else if (executionStatus === 'active') {
    // EXPLICIT 'ACTIVE' only — null/absent never implies executing (unlike
    // the legacy blueprint guard's default, which stays its own concern).
    stage = 'executing';
  } else {
    const mapped = CURRENT_STAGE_MAP[currentStage];
    const isDraft = status === 'draft' || (norm(row?.thread_id).startsWith('planner_draft_') && status !== 'active');
    if (isDraft && (!mapped || mapped === 'planning')) {
      // Fresh planner drafts carry current_stage='planning' — draft wins
      // there; a more advanced stage marker (finalize's writes) outranks it.
      stage = 'draft';
    } else if (mapped) {
      stage = mapped;
    } else {
      stage = 'planning';
    }
  }

  // Planning-space refinement (only when nothing later already claimed it).
  if (stage === 'planning' || stage === 'draft') {
    if (hints?.reviewing) stage = 'review';
    else if ((hints?.assignments_count ?? 0) > 0) stage = 'alignment';
  }

  return { stage, paused, archived, sources };
}

/** Stages at-or-past the execution handoff (Finalize refuses re-entry). */
export function isFinalizedStage(stage: CanonicalCampaignStage): boolean {
  return stage === 'ready' || stage === 'executing' || stage === 'completed' || stage === 'archived';
}

/** Terminal stages — nothing mutates past these. */
export function isTerminalStage(stage: CanonicalCampaignStage): boolean {
  return stage === 'completed' || stage === 'archived';
}
