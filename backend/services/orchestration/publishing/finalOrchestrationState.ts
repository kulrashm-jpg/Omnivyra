/**
 * finalOrchestrationState — Phase-2 Step-35.
 *
 * Single canonical resolver for the FINAL cutover state + the final
 * validation logs. It REPORTS which authorities are PRIMARY vs SHADOW and
 * confirms legacy is rollback-only WHEN the operator has set the cutover
 * to AUTHORITATIVE. It does NOT flip the default itself — preserving
 * rollback capability + SHADOW safety is a STRICT RULE; promoting to
 * AUTHORITATIVE remains a controlled operator/env action. Fail-soft.
 */

import { resolveCutoverMode } from '../generation';

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

export type AuthorityState = 'PRIMARY' | 'SHADOW' | 'ROLLBACK';

export interface FinalCutoverState {
  cutover_mode: string;
  scheduler_authority: AuthorityState;
  publishing_authority: AuthorityState;
  workspace_authority: AuthorityState;
  orchestration_authority: AuthorityState;
  legacy_role: 'PRIMARY' | 'ROLLBACK_ONLY';
}

/**
 * Resolve the final cutover state from the SINGLE canonical cutover gate.
 * AUTHORITATIVE ⇒ all authorities PRIMARY, legacy rollback-only.
 * SHADOW (default) ⇒ authorities SHADOW, legacy PRIMARY (byte-identical).
 * LEGACY ⇒ authorities ROLLBACK, legacy PRIMARY.
 */
export function resolveFinalCutoverState(): FinalCutoverState {
  let mode = 'SHADOW';
  try {
    mode = resolveCutoverMode();
  } catch {
    mode = 'SHADOW';
  }
  const state: FinalCutoverState =
    mode === 'AUTHORITATIVE'
      ? {
          cutover_mode: mode,
          scheduler_authority: 'PRIMARY',
          publishing_authority: 'PRIMARY',
          workspace_authority: 'PRIMARY',
          orchestration_authority: 'PRIMARY',
          legacy_role: 'ROLLBACK_ONLY',
        }
      : mode === 'LEGACY'
        ? {
            cutover_mode: mode,
            scheduler_authority: 'ROLLBACK',
            publishing_authority: 'ROLLBACK',
            workspace_authority: 'ROLLBACK',
            orchestration_authority: 'ROLLBACK',
            legacy_role: 'PRIMARY',
          }
        : {
            cutover_mode: 'SHADOW',
            scheduler_authority: 'SHADOW',
            publishing_authority: 'SHADOW',
            workspace_authority: 'SHADOW',
            orchestration_authority: 'SHADOW',
            legacy_role: 'PRIMARY',
          };
  LOG('FINAL_CUTOVER_STATE', { ...state });
  return state;
}

/**
 * Emit the final orchestration validation diffs for a scheduling run.
 * Observability only — never alters behavior. All inputs are best-effort
 * counts already computed by the enqueue/pruning/replay layers.
 */
export function emitFinalOrchestrationDiff(input: {
  campaignId: string;
  legacyEligible: boolean;
  enqueueable: number;
  deferred: number;
  blocked: number;
  pruningUsable: boolean;
  replayedCount: number;
  permanentlyBlockedCount: number;
}): void {
  const state = resolveFinalCutoverState();
  const orchestrationActive = state.cutover_mode === 'AUTHORITATIVE';

  LOG('GLOBAL_PRUNING_DIFF', {
    campaign_id: input.campaignId,
    cutover_mode: state.cutover_mode,
    pruning_usable: input.pruningUsable,
    enqueueable: input.enqueueable,
    deferred: input.deferred,
    blocked: input.blocked,
    downstream_isolation_active: orchestrationActive && input.pruningUsable,
  });
  LOG('REPLAY_ORCHESTRATION_DIFF', {
    campaign_id: input.campaignId,
    cutover_mode: state.cutover_mode,
    replayed: input.replayedCount,
    permanently_blocked: input.permanentlyBlockedCount,
    replay_active: orchestrationActive,
  });
  LOG('FINAL_ORCHESTRATION_DIFF', {
    campaign_id: input.campaignId,
    cutover_mode: state.cutover_mode,
    legacy_eligible: input.legacyEligible,
    canonical_enqueueable: input.enqueueable,
    canonical_blocked: input.blocked,
    enqueue_mismatch: input.legacyEligible && input.blocked > 0,
    pruning_mismatch: input.pruningUsable && input.deferred + input.blocked > 0,
    replay_mismatch: input.replayedCount > 0,
    orchestration_fidelity:
      !(input.legacyEligible && input.blocked > 0) || orchestrationActive,
  });
  LOG('FINAL_ORCHESTRATION_STATE', {
    campaign_id: input.campaignId,
    cutover_mode: state.cutover_mode,
    scheduler_authority: state.scheduler_authority,
    publishing_authority: state.publishing_authority,
    workspace_authority: state.workspace_authority,
    orchestration_authority: state.orchestration_authority,
    legacy_role: state.legacy_role,
    fallback_active: !orchestrationActive,
  });
}
