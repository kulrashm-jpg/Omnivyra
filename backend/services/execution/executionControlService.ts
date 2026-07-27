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

/** Is execution enabled for (tenant, campaign, connector)? Default OFF, layered. */
export async function isExecutionEnabled(companyId: string, campaignId: string | null, connector: string | null): Promise<ControlDecision> {
  if (!envExecutionEnabled()) return { enabled: false, reason: 'global_env_off' };
  let rows: Row[] = [];
  try {
    const { data } = await ownedDbTable(T).select('scope, scope_id, enabled, emergency_stop, company_id')
      .in('company_id', ['__global__', companyId]).limit(200);
    rows = (data as Row[]) ?? [];
  } catch { return { enabled: false, reason: 'control_lookup_error_failclosed' }; }

  const global = rows.find((r) => r.scope === 'global' && r.company_id === '__global__');
  if (!global || !global.enabled || global.emergency_stop) return { enabled: false, reason: 'global_disabled' };

  const scopes: Array<[string, string | null]> = [['tenant', '__none__'], ['campaign', campaignId], ['connector', connector]];
  for (const [scope, id] of scopes) {
    const r = rows.find((x) => x.scope === scope && (id == null ? true : x.scope_id === id) && (scope === 'tenant' ? x.company_id === companyId : true));
    if (r?.emergency_stop) return { enabled: false, reason: `${scope}_emergency_stop` };
    if (r && !r.enabled) return { enabled: false, reason: `${scope}_disabled` };
  }
  return { enabled: true, reason: 'enabled' };
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
