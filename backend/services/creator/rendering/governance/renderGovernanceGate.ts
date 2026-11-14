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

    // The DAILY QUOTA uses an EXACT count (e9 / 05, 2026-11-11). The id list above is capped at 1000
    // rows (it only scopes the concurrency count below), so its length clamps at 1000: an org whose
    // max_daily_renders is set above 1000 had a quota that could never trip.
    const dailyCountRead = (await supabase
      .from('creator_render_job').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).gte('created_at', since)) as Read & { count?: number | null };
    if (dailyCountRead?.error) return unavailable(`daily count: ${describe(dailyCountRead.error)}`);
    if (typeof dailyCountRead?.count !== 'number') return unavailable('daily count: no count');
    const dailyRenderCount = dailyCountRead.count;

    // CONCURRENCY IS PER TENANT (e9 ruling 3, 2026-11-11). creator_render_job_state has no organization
    // column, and the count used to run over EVERY tenant's active jobs, so one tenant's renders could
    // exhaust another's max_concurrent_renders. It is now scoped to THIS org's jobs from the window
    // above (a job still active more than 24h after creation is outside it: such a job is stale, and
    // the dead-runner takeover is its own follow-up).
    const orgJobIds = (dailyJobs.data as { id?: unknown }[]).map((j) => String(j?.id ?? '')).filter(Boolean);
    let activeCount = 0;
    if (orgJobIds.length > 0) {
      const activeStates = (await supabase
        .from('creator_render_job_state').select('current_state')
        .in('render_job_id', orgJobIds)
        .in('current_state', ['queued', 'rendering', 'processing', 'moderation']).limit(1000)) as Read;
      if (activeStates?.error) return unavailable(`active states: ${describe(activeStates.error)}`);
      if (!Array.isArray(activeStates?.data)) return unavailable('active states: no array body');
      activeCount = (activeStates.data as unknown[]).length;
    }

    const decision = evaluateRenderGovernance(
      orgGov?.data ? coerceGovernanceRow(orgGov.data, orgId) : null,
      globalGov?.data ? coerceGovernanceRow(globalGov.data, GLOBAL_GOVERNANCE_SENTINEL) : null,
      {
        provider: ctx.provider, assetFamily: ctx.assetFamily,
        dailyRenderCount,
        concurrentRenderCount: activeCount,
      },
    );
    return { ok: true, decision };
  } catch (e) {
    return unavailable(`threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}
