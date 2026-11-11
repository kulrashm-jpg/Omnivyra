/**
 * Step-R6 pre-enqueue governance gate: the four store reads that feed evaluateRenderGovernance, CHECKED.
 *
 * BLOCKING fix (e9, 2026-11-11). The route destructured only `data` from each read, and the client does
 * not throw on a database error, so an unreadable governance row became `null` and was evaluated as "no
 * governance row" (default: rendering enabled). A global or org emergency_stop / queue_paused that could
 * not be READ was therefore ignored: fail-OPEN on a kill switch. An unreadable job count became 0 the
 * same way, so a quota could not trip during a store outage. The surrounding try/catch never saw any of it.
 *
 * Now every read's error is examined, and a list read must return an ARRAY (a null body is not "zero":
 * a null error is not an answer). Anything else is `unavailable`, and the caller refuses the render.
 * A single-row read that returns no row (no error) is a genuine "no governance row".
 */
import { evaluateRenderGovernance, coerceGovernanceRow, GLOBAL_GOVERNANCE_SENTINEL } from './renderGovernance';
import type { GovernanceDecision } from './renderGovernance';

export type GovernanceGateResult =
  | { ok: true; decision: GovernanceDecision }
  | { ok: false; reason: 'governance_unavailable'; detail: string };

type Read = { data?: unknown; error?: { code?: string; message?: string } | null };

const describe = (e: { code?: string; message?: string } | null | undefined): string =>
  `${e?.code ?? 'error'}: ${e?.message ?? 'read failed'}`;

export async function evaluateRenderGovernanceGate(
  supabase: any,
  orgId: string,
  ctx: { provider: string; assetFamily: string; now?: Date },
): Promise<GovernanceGateResult> {
  const unavailable = (detail: string): GovernanceGateResult => ({ ok: false, reason: 'governance_unavailable', detail });
  try {
    const now = ctx.now ?? new Date();
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const [orgGov, globalGov, dailyJobs] = (await Promise.all([
      supabase.from('creator_render_governance_state').select('*').eq('organization_id', orgId).maybeSingle(),
      supabase.from('creator_render_governance_state').select('*').eq('organization_id', GLOBAL_GOVERNANCE_SENTINEL).maybeSingle(),
      supabase.from('creator_render_job').select('id').eq('organization_id', orgId).gte('created_at', since).limit(1000),
    ])) as Read[];
    if (orgGov?.error) return unavailable(`org governance: ${describe(orgGov.error)}`);
    if (globalGov?.error) return unavailable(`global governance: ${describe(globalGov.error)}`);
    if (dailyJobs?.error) return unavailable(`daily jobs: ${describe(dailyJobs.error)}`);
    if (!Array.isArray(dailyJobs?.data)) return unavailable('daily jobs: no array body');

    const activeStates = (await supabase
      .from('creator_render_job_state').select('current_state')
      .in('current_state', ['queued', 'rendering', 'processing', 'moderation']).limit(1000)) as Read;
    if (activeStates?.error) return unavailable(`active states: ${describe(activeStates.error)}`);
    if (!Array.isArray(activeStates?.data)) return unavailable('active states: no array body');

    const decision = evaluateRenderGovernance(
      orgGov?.data ? coerceGovernanceRow(orgGov.data, orgId) : null,
      globalGov?.data ? coerceGovernanceRow(globalGov.data, GLOBAL_GOVERNANCE_SENTINEL) : null,
      {
        provider: ctx.provider, assetFamily: ctx.assetFamily,
        dailyRenderCount: (dailyJobs.data as unknown[]).length,
        concurrentRenderCount: (activeStates.data as unknown[]).length,
      },
    );
    return { ok: true, decision };
  } catch (e) {
    return unavailable(`threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}
