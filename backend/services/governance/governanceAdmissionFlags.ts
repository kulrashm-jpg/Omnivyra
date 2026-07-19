/**
 * RELEASE-R3D — Governance Admission feature-flag configuration.
 *
 * The Governance Admission Adapter is OFF by default and must be so in every
 * environment until an operator deliberately promotes it. Rather than invent a
 * parallel flag system, this reuses the proven in-repo Rollout Kit
 * (`lib/platform/rollout`), which already provides:
 *   - off / shadow / enforce staged rollout (default off),
 *   - environment-specific activation (env var per flag),
 *   - staged rollout (per-tenant shadow→enforce promotion / canary),
 *   - kill switches (global + per-flag), and
 *   - live re-resolution (no redeploy to flip).
 *
 * Mode semantics for admission:
 *   off     → adapter bypasses entirely; the Governance Runtime is NOT invoked.
 *   shadow  → admission is invoked for observability but NEVER blocks (the AI
 *             workflow always proceeds); used to validate before enforcing.
 *   enforce → admission is authoritative and FAIL-CLOSED for governance-
 *             designated workflows.
 *
 * Environment variable: ROLLOUT_GOVERNANCE_ADMISSION_MODE = off | shadow |
 * enforce (default off). Per-tenant canary: ROLLOUT_GOVERNANCE_ADMISSION_TENANTS.
 * Kill: ROLLOUT_GOVERNANCE_ADMISSION_KILL / ROLLOUT_KILL_SWITCH.
 */
import {
  defineRolloutFlag,
  resolveRolloutSync,
  type RolloutDecision,
} from '../../../lib/platform/rollout';

/** The single admission rollout flag. Default OFF — Release R3D requirement. */
export const GOVERNANCE_ADMISSION_FLAG = defineRolloutFlag({
  key: 'governance-admission',
  description:
    'RELEASE-R3D: optional Governance Admission Adapter before governance-designated AI workflows (default off)',
  defaultMode: 'off',
});

/**
 * Operations that are GOVERNANCE-DESIGNATED. Only these AI workflows are ever
 * eligible for admission; every other AI operation bypasses the adapter even
 * when the flag is enabled — guaranteeing zero impact on standard AI requests.
 * Additive: extend this set to designate more workflows. Empty-by-intent means
 * no workflow is designated yet; the seam exists and is inert until populated.
 */
export const GOVERNANCE_DESIGNATED_OPERATIONS: ReadonlySet<string> = new Set<string>([
  // Reserved designation namespace. Governance-sensitive workflows opt in by
  // adding their stable operation label here.
  'governance.admission.selfTest',
  // OMNI-GOV-002: the autonomous governance audit sweep (backend/jobs/
  // governanceAuditJob.ts). A governance "audit" is explicitly within the
  // constitutional gateway's charter, and the sweep is a background job that
  // tolerates admission latency — the first genuine production workflow to
  // consume the certified runtime via the published adapter (OFF by default).
  'governance.audit.sweep',
]);

/** True when an operation is governance-designated (eligible for admission). */
export function isGovernanceDesignated(operation: string): boolean {
  return GOVERNANCE_DESIGNATED_OPERATIONS.has(operation);
}

/** Resolve the current admission mode (env + last-cached admin override). */
export function resolveGovernanceAdmissionMode(tenantId?: string): RolloutDecision {
  return resolveRolloutSync(GOVERNANCE_ADMISSION_FLAG, tenantId ? { tenantId } : {});
}

/** Machine-readable flag state for audit/diagnostic visibility (§3, §8). */
export interface GovernanceFlagState {
  key: string;
  mode: RolloutDecision['mode'];
  source: RolloutDecision['source'];
  defaultMode: string;
  enabled: boolean;
  enforcing: boolean;
  designatedOperations: string[];
}

export function describeGovernanceFlagState(tenantId?: string): GovernanceFlagState {
  const decision = resolveGovernanceAdmissionMode(tenantId);
  return {
    key: GOVERNANCE_ADMISSION_FLAG.key,
    mode: decision.mode,
    source: decision.source,
    defaultMode: GOVERNANCE_ADMISSION_FLAG.defaultMode,
    enabled: decision.mode !== 'off',
    enforcing: decision.mode === 'enforce',
    designatedOperations: Array.from(GOVERNANCE_DESIGNATED_OPERATIONS),
  };
}
