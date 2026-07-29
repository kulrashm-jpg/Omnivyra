/**
 * LC-501 (W5.1) — C5 Kill-switch & layered execution controls (DEFAULT OFF).
 *
 * The ONE control layer every execution path consults. Execution is disabled unless
 * ALL hold:
 *   (a) hard env gate GTM_EXECUTION_ENABLED === 'true'  (default OFF)
 *   (b) a GLOBAL control row exists with enabled=true and emergency_stop=false
 *   (c) no tenant / campaign / connector control has emergency_stop or enabled=false
 * Any scope can hard-stop (emergency_stop) or disable. A second independent gate
 * (GTM_LIVE_SEND, checked in the connector) keeps sends dry-run in W5.1 regardless.
 */

import { ownedDbTable } from '../../db/writeOwner';

const T = 'execution_controls';
const now = () => new Date().toISOString();

export interface ControlDecision { enabled: boolean; reason: string }
type Row = { scope: string; scope_id: string | null; enabled: boolean; emergency_stop: boolean; company_id: string | null };

/** Hard env gate — the ultimate default-off. */
export function envExecutionEnabled(): boolean {
  return process.env.GTM_EXECUTION_ENABLED === 'true';
}

/**
 * ES-102 — does a control row APPLY to this dispatch? Company-isolated per layer:
 *  - global:    the singleton (__global__) global row
 *  - tenant:    a tenant row owned by THIS company
 *  - campaign:  a campaign row for THIS campaign, owned by this company OR global
 *  - connector: a connector row for THIS connector, owned by this company OR global
 * A row that does not clearly apply is ignored (never used to enable, never to mask a stop).
 */
function controlApplies(r: Row, companyId: string, campaignId: string | null, connector: string | null): boolean {
  const ownedHere = r.company_id === companyId || r.company_id === '__global__';
  switch (r.scope) {
    case 'global':    return r.company_id === '__global__';
    case 'tenant':    return r.company_id === companyId;
    case 'campaign':  return campaignId != null && r.scope_id === campaignId && ownedHere;
    case 'connector': return connector != null && r.scope_id === connector && ownedHere;
    default:          return false;
  }
}

/**
 * ES-102 — PURE, deterministic, MOST-RESTRICTIVE control evaluation (unit-testable).
 * Precedence (restrictive always wins; emergency stop is never maskable):
 *   1. env OFF                                            → disabled
 *   2. ANY applicable row with emergency_stop            → disabled  (cannot be masked by any enabled row)
 *   3. no explicitly-enabled global row                  → disabled  (default OFF)
 *   4. ANY applicable row with enabled=false             → disabled  (most-restrictive layer wins)
 *   5. otherwise                                          → enabled
 */
export function evaluateControls(
  rows: Row[], ctx: { companyId: string; campaignId: string | null; connector: string | null; envEnabled: boolean },
): ControlDecision {
  if (!ctx.envEnabled) return { enabled: false, reason: 'global_env_off' };
  const applicable = rows.filter((r) => controlApplies(r, ctx.companyId, ctx.campaignId, ctx.connector));
  // 2 — emergency stop anywhere applicable hard-halts; never maskable.
  const stop = applicable.find((r) => r.emergency_stop);
  if (stop) return { enabled: false, reason: `${stop.scope}_emergency_stop` };
  // 3 — a global row must exist and be explicitly enabled.
  const global = applicable.find((r) => r.scope === 'global');
  if (!global || !global.enabled) return { enabled: false, reason: 'global_disabled' };
  // 4 — most-restrictive: any applicable disabled layer wins.
  const disabled = applicable.find((r) => !r.enabled);
  if (disabled) return { enabled: false, reason: `${disabled.scope}_disabled` };
  return { enabled: true, reason: 'enabled' };
}

/** Is execution enabled for (tenant, campaign, connector)? Default OFF; most-restrictive layer wins. */
export async function isExecutionEnabled(companyId: string, campaignId: string | null, connector: string | null): Promise<ControlDecision> {
  if (!envExecutionEnabled()) return { enabled: false, reason: 'global_env_off' };
  let rows: Row[] = [];
  try {
    const { data } = await ownedDbTable(T).select('scope, scope_id, enabled, emergency_stop, company_id')
      .in('company_id', ['__global__', companyId]).limit(500);
    rows = (data as Row[]) ?? [];
  } catch { return { enabled: false, reason: 'control_lookup_error_failclosed' }; }
  return evaluateControls(rows, { companyId, campaignId, connector, envEnabled: true });
}

export async function setControl(input: { companyId: string | null; scope: 'global' | 'tenant' | 'campaign' | 'connector'; scopeId?: string | null; enabled?: boolean; emergencyStop?: boolean; reason?: string; actor?: string | null }): Promise<void> {
  await ownedDbTable(T).upsert({
    company_id: input.companyId ?? '__global__', scope: input.scope, scope_id: input.scopeId ?? '__none__',
    enabled: input.enabled ?? false, emergency_stop: input.emergencyStop ?? false, reason: input.reason ?? null,
    updated_by: input.actor ?? null, updated_at: now(),
  }, { onConflict: 'company_id,scope,scope_id' }).select('id').maybeSingle();
}

/** EMERGENCY STOP — hard-halt a scope. Reversible only by an explicit clear. */
export const killSwitch = (companyId: string | null, scope: 'global' | 'tenant' | 'campaign' | 'connector', scopeId: string | null, actor: string, reason: string) =>
  setControl({ companyId, scope, scopeId, enabled: false, emergencyStop: true, reason, actor });
