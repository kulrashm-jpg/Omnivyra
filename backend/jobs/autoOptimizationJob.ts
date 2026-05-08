/**
 * Stage 37 — Auto-Optimization Background Job.
 * Runs after scheduler cycle. Non-blocking. Never throws.
 *
 * Tenant containment: each campaign's auto-optimization runs inside
 * `runJob` with the resolved owning organizationId. The canonical tenant
 * guard rejects soft-deleted / suspended orgs BEFORE `runAutoOptimization`
 * touches campaign or content data — closing a Severity-1 cross-tenant
 * mutation surface flagged by the audit (campaigns table query without
 * `is_deleted` filter would have iterated every campaign whose owning
 * org had been soft-deleted).
 */

import { supabase } from '../db/supabaseClient';
import { runAutoOptimization } from '../services/CampaignAutoOptimizationService';
import { runJob } from '../services/jobRunner';

/**
 * Run auto-optimization for all campaigns with auto_optimize_enabled = true.
 * Non-blocking. Never throws.
 */
export async function runAutoOptimizationForEligibleCampaigns(): Promise<void> {
  try {
    // Pull each campaign WITH its owning company_id so the runner can
    // bind tenant context per execution. Without the join, we'd be
    // back to the audit's flagged risk: iterating campaigns whose
    // owning org may have been soft-deleted.
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id, company_id')
      .eq('auto_optimize_enabled', true);

    if (error || !campaigns?.length) {
      if (campaigns?.length === 0) {
        console.log('AutoOptimizationJob: no campaigns with auto_optimize_enabled');
      }
      return;
    }

    let applied = 0;
    let tenantInvalid = 0;
    const dayBucket = new Date().toISOString().slice(0, 10);

    for (const c of campaigns as Array<{ id: string; company_id: string | null }>) {
      const campaignId = c.id;
      const ownerOrgId = c.company_id ?? null;
      if (!campaignId) continue;

      const outcome = await runJob(
        {
          jobName:        'job:auto-optimization',
          triggerSource:  'system',
          tenantId:       ownerOrgId,
          principalKind:  'system:auto-optimization',
          idempotencyKey: `job:auto-optimization:${campaignId}:${dayBucket}`,
          // Per-tenant cap: a tenant's campaigns can run two
          // auto-optimizations in parallel but no more — keeps the
          // analytics pipeline from saturating on any one org.
          concurrency: ownerOrgId
            ? {
                key:                 `tenant:${ownerOrgId}:job:auto-optimization`,
                max:                 2,
                maxPerSecond:        5,
                maxRetriesPerMinute: 6,
              }
            : undefined,
        },
        async () => runAutoOptimization(campaignId),
      );

      if (outcome.status === 'completed') {
        if (outcome.result.applied) applied++;
      } else if (outcome.status === 'tenant_invalid') {
        tenantInvalid++;
        console.warn(
          `AutoOptimizationJob: tenant_invalid for campaign=${campaignId} org=${ownerOrgId} reason=${outcome.reason}`,
        );
      }
      // 'failed' / 'dead_letter_skip' / 'pressure_rejected' are
      // intentionally swallowed — this job is contractually
      // non-blocking ("Never throws"). Pressure rejections naturally
      // resume on the next scheduler tick.
    }

    if (applied > 0 || tenantInvalid > 0) {
      console.log(
        `✅ Auto-optimization: applied=${applied} tenant_invalid=${tenantInvalid} of ${campaigns.length} eligible`,
      );
    }
  } catch (err) {
    console.error('AutoOptimizationJob: run failed', err);
  }
}
