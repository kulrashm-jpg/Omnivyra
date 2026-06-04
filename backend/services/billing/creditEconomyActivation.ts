/**
 * Phase 11B — THE single authoritative credit-economy activation verdict.
 *
 * Before 11B the entry-consumption engine was activated inconsistently: some
 * paths (activity-workspace content, planner workspace-content, the
 * content-generation + creator-content processors, the reports settlement) keyed
 * off PHASE2_ENTRY_CONSUMPTION ALONE, while others (the 19 wirePhase2Route
 * routes, the bolt + campaign-planning processors) additionally required the
 * per-org enforcement gate. Flipping the master flag therefore produced PARTIAL
 * activation — exactly the rollout risk flagged by the 11A readiness audit.
 *
 * This module collapses that decision to one function used everywhere. Two axes,
 * uniform for every customer activity:
 *
 *   1. PHASE2_ENTRY_CONSUMPTION  — the global master switch (which engine).
 *   2. the existing per-org enforcement gate (billing.reservations_required /
 *      PHASE2_BILLING_*) — the canary deciding WHICH orgs are billed.
 *
 * Verdict:
 *   - master OFF                       → 'off'      (NO per-org read; this is the
 *                                                    default and is byte-identical
 *                                                    to pre-11B production)
 *   - master ON, no org context        → 'enforce'  (system activity, flag-driven)
 *   - master ON, org in enforce mode   → 'enforce'
 *   - master ON, org in shadow/off mode→ 'shadow' / 'off'
 *
 * Only 'enforce' selects executeWithEntryConsumption; 'shadow' and 'off' keep the
 * legacy path. This module is a pure DECISION — it touches no
 * billing/settlement/admission/reconciliation/accounting state. The separate
 * credit-economy shadow telemetry (emitCreditEconomyShadowEvaluation /
 * PHASE2_CREDIT_ECONOMY_SHADOW) is unaffected and remains independent.
 */
import { isEntryConsumptionEnabled } from '../creditExecutionService';
import { resolveEnforcementMode, type BillingSurface } from './phase2EnforcementGate';

export type CreditEconomyMode = 'off' | 'shadow' | 'enforce';

export async function getCreditEconomyExecutionMode(input?: {
  organizationId?: string | null;
  surface?: BillingSurface;
}): Promise<CreditEconomyMode> {
  // Master switch. Default OFF ⇒ 'off' for EVERY path, with no per-org lookup —
  // production behavior is unchanged until this flag is deliberately enabled.
  if (!isEntryConsumptionEnabled()) return 'off';

  // System / org-less activity: the master switch alone drives enforcement.
  if (!input?.organizationId) return 'enforce';

  // Uniform per-org canary gate (reuses the certified enforcement gate). This is
  // the SAME resolution the wirePhase2Route / bolt / campaign-planning paths
  // already consult — now consulted identically by every other path too.
  const { mode } = await resolveEnforcementMode(
    String(input.organizationId),
    input.surface ?? 'queue.credit-economy',
  );
  return mode;
}
