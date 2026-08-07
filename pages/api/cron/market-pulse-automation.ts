import { safeEnqueue } from '../../../backend/middleware/queueBackpressure';
import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET|POST /api/cron/market-pulse-automation
 *
 * Cron endpoint — fires automated Market Pulse runs for every company that
 * has `market_pulse_automation_settings.is_active = true`. Replaces the
 * previously-cosmetic "Enable daily Market Pulse monitoring" toggle, which
 * persisted state but had no consumer.
 *
 * Reuses existing infrastructure end-to-end:
 *   - tenant safety + idempotency: `runJob` wraps each per-company unit of
 *     work, with idempotencyKey `cron:market-pulse-automation:{companyId}:{day}`
 *     so two cron invocations on the same UTC day collapse to one execution.
 *   - run lifecycle: same `createMarketPulseRun` + `market_pulse_jobs_v1`
 *     pair the user-triggered `/api/market-pulse/run` endpoint creates,
 *     so the worker pipeline (engine-jobs queue → processMarketPulseJobV1
 *     → syncLegacyJobIntoRun) is unchanged.
 *   - executor context: `buildMarketPulseExecutorContext` is invoked the
 *     same way the user-triggered endpoint invokes it, so cron-driven runs
 *     receive the same company-aware prompting + scoring as on-demand runs.
 *
 * Authentication: CRON_SECRET bearer (matches existing cron endpoints).
 *
 * Hobby-plan note: vercel.json is currently bound by Vercel's hobby-plan
 * 2-cron cap. This handler is callable directly via CRON_SECRET; once the
 * project is on a plan that allows >2 crons, add the schedule entry to
 * vercel.json (see the corresponding diff). Until then, an external
 * scheduler (or `analytics-ingestion` cron tick) can hit this endpoint.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { config } from '@/config';
import { supabase } from '../../../backend/db/supabaseClient';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { jobQueue } from '../../../backend/queue/jobQueue';
import { runJob } from '../../../backend/services/jobRunner';
import {
  buildMarketPulseExecutorContext,
  createMarketPulseRun,
  resolveMarketPulseRunInput,
  syncLegacyJobIntoRun,
  type MarketPulseRunInput,
} from '../../../backend/services/marketPulseV2Service';
import { processMarketPulseJobV1 } from '../../../backend/services/marketPulseJobProcessor';

const BATCH_SIZE = 50;

type AutomationSettingsRow = {
  company_id: string;
  is_active?: boolean | null;
  cadence?: string | null;
  objective?: string | null;
  categories?: string[] | null;
  region_scope?: string | null;
  custom_regions?: string[] | null;
  competitor_scope?: string | null;
  custom_direction?: string | null;
  credit_acknowledged?: boolean | null;
};

function isValidObjective(value: string | null | undefined): value is MarketPulseRunInput['objective'] {
  return value === 'growth'
    || value === 'expansion'
    || value === 'hiring'
    || value === 'partnerships'
    || value === 'product'
    || value === 'risk';
}

function isValidRegionScope(value: string | null | undefined): value is MarketPulseRunInput['region_scope'] {
  return value === 'profile_markets'
    || value === 'expansion_markets'
    || value === 'all_defaults'
    || value === 'custom';
}

function isValidCompetitorScope(value: string | null | undefined): value is MarketPulseRunInput['competitor_scope'] {
  return value === 'profile_only' || value === 'auto_discover' || value === 'combined';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth — fail-closed when CRON_SECRET is not configured. Mirrors
  // process-scheduled-posts and analytics-ingestion handlers.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[cron/market-pulse-automation] CRON_SECRET not configured; rejecting');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = Date.now();
  const dayBucket = new Date().toISOString().slice(0, 10);

  const results = {
    eligible: 0,
    enqueued: 0,
    inline_executed: 0,
    skipped_dead_letter: 0,
    skipped_tenant_invalid: 0,
    skipped_credit_unacknowledged: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    // Fetch only active automation rows. Bound the batch so a single cron
    // tick stays inside Vercel's function execution window even with many
    // companies enabled.
    const { data: rows, error: fetchError } = await supabase
      .from('market_pulse_automation_settings')
      .select('company_id, is_active, cadence, objective, categories, region_scope, custom_regions, competitor_scope, custom_direction, credit_acknowledged')
      .eq('is_active', true)
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error('[cron/market-pulse-automation] settings fetch failed:', fetchError.message);
      return res.status(500).json({ error: fetchError.message });
    }

    // Supabase's auto-typed select doesn't match our local AutomationSettingsRow
    // shape exactly (column nullability differs). Filter + cast — the per-row
    // shape is already validated by the column SELECT list above.
    const eligibleRows = ((rows ?? []) as Array<Record<string, unknown>>)
      .filter((r) => typeof r?.company_id === 'string' && (r.company_id as string).length > 0)
      .map((r) => r as AutomationSettingsRow);
    results.eligible = eligibleRows.length;

    for (const settings of eligibleRows) {
      const companyId = settings.company_id;

      // Hard guard: if the user never acknowledged the credit warning, do
      // not auto-spend on their behalf. The UI requires this before saving;
      // double-check at execution time in case the DB was edited directly.
      if (!settings.credit_acknowledged) {
        results.skipped_credit_unacknowledged++;
        continue;
      }

      // Per-company unit of work — runJob handles tenant safety, audit,
      // and DLQ replay protection. Each company's failure is isolated.
      const outcome = await runJob(
        {
          jobName:        'cron:market-pulse-automation',
          triggerSource:  'cron',
          tenantId:       companyId,
          principalKind:  'cron-secret',
          idempotencyKey: `cron:market-pulse-automation:${companyId}:${dayBucket}`,
          payload:        { company_id: companyId, day: dayBucket },
          // Single per-tenant slot — we do not want concurrent automated
          // Market Pulse runs piling up if a previous tick stalled.
          concurrency: {
            key:                 `tenant:${companyId}:cron:market-pulse-automation`,
            max:                 1,
            maxPerSecond:        2,
            maxRetriesPerMinute: 4,
          },
        },
        async () => {
          // Reuse the exact `MarketPulseRunInput` shape the on-demand path
          // builds, so downstream resolveMarketPulseRunInput +
          // buildMarketPulseExecutorContext + processMarketPulseJobV1 see
          // identical inputs whether the run came from the UI or the cron.
          const input: MarketPulseRunInput = {
            mode: 'automated',
            objective: isValidObjective(settings.objective) ? settings.objective : 'growth',
            categories: Array.isArray(settings.categories) ? settings.categories.filter(Boolean) : [],
            region_scope: isValidRegionScope(settings.region_scope) ? settings.region_scope : 'profile_markets',
            custom_regions: Array.isArray(settings.custom_regions) ? settings.custom_regions.filter(Boolean) : [],
            competitor_scope: isValidCompetitorScope(settings.competitor_scope) ? settings.competitor_scope : 'combined',
            // Cron uses hybrid by default — same as on-demand fallback.
            source_strategy: 'hybrid',
            custom_direction: settings.custom_direction ?? null,
            delivery_mode: 'daily_digest',
            credit_acknowledged: true,
          };

          const { context, resolvedInput } = await resolveMarketPulseRunInput(companyId, input);

          const regionsNormalized =
            resolvedInput.custom_regions && resolvedInput.custom_regions.length > 0
              ? [...resolvedInput.custom_regions]
              : ['GLOBAL'];

          const executorContext = buildMarketPulseExecutorContext(context, resolvedInput);

          const contextPayload = {
            context_mode: 'FULL',
            additional_direction: resolvedInput.custom_direction ?? undefined,
            insight_source: resolvedInput.source_strategy ?? 'hybrid',
            selected_categories: resolvedInput.categories,
            objective: resolvedInput.objective,
            competitor_scope: resolvedInput.competitor_scope,
            executor_context: executorContext,
            // Tag the job so observability can distinguish cron-driven runs
            // from user-triggered ones without having to join back to the
            // execution_audit table.
            triggered_by: 'cron:market-pulse-automation',
            triggered_day: dayBucket,
          };

          const { data: legacyJob, error: insertError } = await ownedDbTable('market_pulse_jobs_v1')
            .insert({
              company_id: companyId,
              regions: regionsNormalized,
              status: 'PENDING',
              confidence_index: 0,
              region_results: {},
              consolidated_result: null,
              error: null,
              context_payload: contextPayload,
            })
            .select('id, status')
            .single();

          if (insertError || !legacyJob) {
            throw new Error(insertError?.message || 'Failed to create legacy Market Pulse job');
          }

          const run = await createMarketPulseRun(companyId, resolvedInput, legacyJob.id);

          if (!config.ENABLE_AUTO_WORKERS) {
            // Same fallback the on-demand endpoint uses when workers are
            // disabled (single-process / dev). Runs the processor inline so
            // findings are persisted by the time this cron tick returns.
            await processMarketPulseJobV1(legacyJob.id);
            await syncLegacyJobIntoRun(run.id, companyId);
            return { mode: 'inline', runId: run.id, legacyJobId: legacyJob.id };
          }

          await safeEnqueue(jobQueue, 'engine-jobs', 'market-pulse-job', {
            type: 'MARKET_PULSE',
            jobId: legacyJob.id,
          });

          return { mode: 'enqueued', runId: run.id, legacyJobId: legacyJob.id };
        },
      );

      if (outcome.status === 'completed') {
        if (outcome.result.mode === 'inline') results.inline_executed++;
        else results.enqueued++;
      } else if (outcome.status === 'tenant_invalid') {
        results.skipped_tenant_invalid++;
        results.errors.push(`[${companyId}] tenant_invalid: ${outcome.reason}`);
      } else if (outcome.status === 'dead_letter_skip') {
        results.skipped_dead_letter++;
      } else if (outcome.status === 'pressure_rejected') {
        // Concurrency lease refused — already a recent execution in flight.
        results.errors.push(`[${companyId}] pressure_rejected: ${outcome.reason}`);
      } else {
        results.failed++;
        const msg = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
        results.errors.push(`[${companyId}] ${msg}`);
      }
    }

    const elapsed = Date.now() - startedAt;
    console.log('[cron/market-pulse-automation]', { ...results, elapsed_ms: elapsed });
    return res.status(200).json({ ok: true, ...results, elapsed_ms: elapsed });
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/market-pulse-automation] fatal:', message);
    return res.status(500).json({ ok: false, error: message, ...results, elapsed_ms: elapsed });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/market-pulse-automation' });
