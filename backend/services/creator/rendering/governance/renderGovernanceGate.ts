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
    const [orgGov, globalGov] = (await Promise.all([
      supabase.from('creator_render_governance_state').select('*').eq('organization_id', orgId).maybeSingle(),
      supabase.from('creator_render_governance_state').select('*').eq('organization_id', GLOBAL_GOVERNANCE_SENTINEL).maybeSingle(),
    ])) as Read[];
    if (orgGov?.error) return unavailable(`org governance: ${describe(orgGov.error)}`);
    if (globalGov?.error) return unavailable(`global governance: ${describe(globalGov.error)}`);

    // The DAILY QUOTA uses an EXACT count (e9 / 05, 2026-11-11): a capped list's length could never trip a
    // max_daily_renders above its cap.
    const dailyCountRead = (await supabase
      .from('creator_render_job').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).gte('created_at', since)) as Read & { count?: number | null };
    if (dailyCountRead?.error) return unavailable(`daily count: ${describe(dailyCountRead.error)}`);
    if (typeof dailyCountRead?.count !== 'number') return unavailable('daily count: no count');
    const dailyRenderCount = dailyCountRead.count;

    // CONCURRENCY IS PER TENANT (e9 ruling 3, 2026-11-11) and EXACT (e9 / 05, 2026-11-14).
    // creator_render_job_state has no organization column, so the count joins its job
    // (render_job_id -> creator_render_job.id, FK) with an INNER embed and counts THIS org's in-flight
    // states inside the 24h window (a job still active after 24h is stale; the dead-runner takeover is its
    // own follow-up). This used to scope through an UNORDERED .limit(1000) id list, so an org with more than
    // 1000 renders in 24h counted an arbitrary subset, missed in-flight jobs and could exceed its cap.
    // No number = unavailable (fail closed), never 0.
    const activeCountRead = (await supabase
      .from('creator_render_job_state')
      .select('render_job_id, creator_render_job!inner(organization_id, created_at)', { count: 'exact', head: true })
      .eq('creator_render_job.organization_id', orgId)
      .gte('creator_render_job.created_at', since)
      .in('current_state', ['queued', 'rendering', 'processing', 'moderation'])) as Read & { count?: number | null };
    if (activeCountRead?.error) return unavailable(`active count: ${describe(activeCountRead.error)}`);
    if (typeof activeCountRead?.count !== 'number') return unavailable('active count: no count');
    const activeCount = activeCountRead.count;

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
