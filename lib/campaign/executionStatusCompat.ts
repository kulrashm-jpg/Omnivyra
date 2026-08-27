/**
 * R5 — the ONE place the absent `campaigns.execution_status` column is
 * interpreted.
 *
 * ── The evidence (R3 + R4) ────────────────────────────────────────────────
 * `campaigns.execution_status` does NOT exist in production and no migration
 * has ever created it. Its origin, `database/campaign_preemption_status.sql`
 * (`ADD COLUMN ... VARCHAR(20) DEFAULT 'ACTIVE'`), lives in a manual-apply
 * directory with no automated applier and was never run — its sibling column
 * `last_preempted_at` is equally absent, as are `priority_level`,
 * `is_protected` and `auto_optimize_enabled`. The whole preemption /
 * priority / auto-optimization subsystem is undeployed.
 *
 * Selecting the column is not a soft failure: PostgREST answers 42703 and the
 * WHOLE row read fails, which is why six routes returned 404 (or, in
 * planner-draft's case, silently created a duplicate draft).
 *
 * ── The contradiction this module resolves ────────────────────────────────
 * Two mutually exclusive defaults for the same absent value ship today:
 *
 *   normalizeExecutionState(null) -> 'DRAFT'        (ExecutionStateMachine)
 *   String(execution_status ?? 'ACTIVE')            (six ad-hoc readers)
 *
 * R5 chooses NEITHER as a substitute value. Both would be inventions: 'DRAFT'
 * and 'ACTIVE' are states of a machine that has never had a row to run on,
 * and picking either would resurrect the abandoned subsystem by implication.
 *
 * The policy is: an absent column is ABSENT — no signal, not a state. The
 * canonical read model already behaves exactly this way. In
 * `resolveCampaignStage`, `execution_status` contributes to only three
 * branches, and `campaigns.status` independently covers two of them:
 *
 *   completed  <- execution_status 'completed' OR status 'completed'   ✔ covered
 *   paused     <- execution_status 'paused'    OR status 'paused'      ✔ covered
 *   executing  <- execution_status 'active' ONLY                       — see below
 *
 * The `executing` branch is unreachable regardless: R4 proved the only two
 * writers of the column are terminal ('COMPLETED' in CampaignCompletionService,
 * 'PREEMPTED' in CampaignPreemptionService) and nothing has ever written
 * 'ACTIVE'. So omitting the column from a SELECT changes no resolved stage
 * that production could actually produce.
 *
 * ── What replaces the finalized guard ─────────────────────────────────────
 * `assertCampaignNotFinalized(normalizeExecutionState(execution_status))`
 * throws only on the terminal execution states. With the column absent it
 * normalizes to 'DRAFT' and can never throw — so wherever it survives the
 * 42703 today it is already a NO-OP. {@link isCampaignFinalized} replaces it
 * with the canonical equivalent driven by fields that genuinely exist:
 * `isTerminalStage(resolveCampaignStage(row).stage)` — i.e. completed or
 * archived. That STRENGTHENS the protection rather than weakening it.
 *
 * PREEMPTED has no canonical stage equivalent and is deliberately not
 * emulated: it cannot occur, because the column its only writer targets does
 * not exist. If the preemption subsystem is ever deployed (a separate product
 * decision, see R4 §12), this module is the one place that must change.
 *
 * NOTE — `pages/api/campaigns/[id]/release.ts` carries its own P1.2-era
 * guarded optional read and is deliberately NOT refactored onto this module:
 * R5's scope forbids touching release.ts semantics. The two agree in
 * behaviour; release.ts additionally tolerates the column being PRESENT,
 * which this module has no need to do because none of its consumers branch
 * on the value.
 *
 * Pure and deterministic: no I/O, no clock, no environment.
 */

import {
  resolveCampaignStage,
  isTerminalStage,
  type CampaignStatusFields,
  type CampaignStageHints,
} from './campaignStage';

/**
 * The campaign lifecycle columns that actually exist in production.
 *
 * Every planner-path route selects from this list instead of naming
 * `execution_status`. Keep it in sync with `CampaignStatusFields` minus the
 * absent column.
 */
export const CAMPAIGN_LIFECYCLE_COLUMNS = [
  'id',
  'status',
  'current_stage',
  'blueprint_status',
  'thread_id',
] as const;

/** PostgREST `select=` string for the columns above. */
export const CAMPAIGN_LIFECYCLE_SELECT = CAMPAIGN_LIFECYCLE_COLUMNS.join(', ');

/**
 * Build a select list that adds route-specific columns to the canonical
 * lifecycle set, de-duplicated and order-stable.
 *
 * Using this instead of a hand-written string is what keeps six routes from
 * drifting back into six subtly different column lists.
 */
export function campaignLifecycleSelect(...extra: string[]): string {
  const seen = new Set<string>(CAMPAIGN_LIFECYCLE_COLUMNS);
  const out: string[] = [...CAMPAIGN_LIFECYCLE_COLUMNS];
  for (const raw of extra) {
    const col = String(raw ?? '').trim();
    if (!col || seen.has(col)) continue;
    seen.add(col);
    out.push(col);
  }
  return out.join(', ');
}

/**
 * True when a campaign is genuinely finalized and must not be mutated.
 *
 * The canonical replacement for
 * `assertCampaignNotFinalized(normalizeExecutionState(execution_status))`,
 * expressed through the approved read model rather than a raw field compare.
 */
export function isCampaignFinalized(
  row: CampaignStatusFields | null | undefined,
  hints?: CampaignStageHints,
): boolean {
  return isTerminalStage(resolveCampaignStage(row, hints).stage);
}

/**
 * Guard for a select list. Returns the offending column when a query would
 * name a column production does not have.
 *
 * Exists so the R5 regression test can assert the policy over route SOURCE
 * rather than trusting six separate hand-audits.
 */
export function findAbsentColumns(select: string): string[] {
  const named = String(select ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return named.filter((c) => ABSENT_CAMPAIGN_COLUMNS.has(c));
}

/**
 * Campaign columns proven ABSENT from production by R3/R4 read-only probes.
 * All five belong to the undeployed governance subsystem.
 */
export const ABSENT_CAMPAIGN_COLUMNS: ReadonlySet<string> = new Set([
  'execution_status',
  'last_preempted_at',
  'priority_level',
  'is_protected',
  'auto_optimize_enabled',
]);
