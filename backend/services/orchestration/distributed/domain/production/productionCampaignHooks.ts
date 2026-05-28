/**
 * Phase 26B — Production campaign service hook factory.
 *
 * Wires `CampaignServiceHooks` into the real campaign execution layer
 * (existing `findDuePostsAndEnqueue`, scheduling, etc.) without modifying
 * those services. Same opt-in pattern as Phase 26A.
 *
 * GUARANTEES:
 *   - No duplicate campaign post execution: per-post idempotency at
 *     the substrate (cls=scheduling, semanticParts=['camp', campaignId,
 *     postId]) suppresses replay.
 *   - No replay-induced rescheduling: the hook delegates to a single
 *     publishPost call — actual scheduling decisions happen in the
 *     caller-supplied service, NOT in this hook.
 */

import type {
  CampaignContext,
  CampaignServiceHooks,
} from '../domainWorkflowTypes';

export interface CampaignServiceDeps {
  /**
   * Run a single campaign post. Operators wire into the real campaign
   * service (e.g. enqueueing a `publish` job into BullMQ, or directly
   * invoking the publish pipeline). MUST be idempotent on
   * (campaignId, postId).
   */
  publishPost: (input: {
    executionId: string;
    campaignId: string;
    postId: string;
    meta: Record<string, unknown>;
  }) => Promise<void>;
  /** Optional pre-campaign step (e.g. due-window check). */
  precheckCampaign?: (input: {
    executionId: string;
    campaignId: string;
    totalPosts: number;
  }) => Promise<void>;
  /** Optional post-campaign step (e.g. settlement). */
  finalizeCampaign?: (input: {
    executionId: string;
    campaignId: string;
    totalPosts: number;
  }) => Promise<void>;
}

export type ProductionCampaignTelemetryEvent =
  | 'domain_campaign_live_execution_started'
  | 'domain_campaign_live_execution_completed'
  | 'domain_campaign_live_execution_failed';

export interface ProductionCampaignTelemetrySink {
  emit(event: ProductionCampaignTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ProductionCampaignTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'domain_campaign_live_execution_failed') console.warn(`[prod_campaign] ${line}`);
      else console.log(`[prod_campaign] ${line}`);
    } catch { /* ignore */ }
  },
};

export interface CreateProductionCampaignHooksOptions {
  deps: CampaignServiceDeps;
  telemetry?: ProductionCampaignTelemetrySink;
}

export function createProductionCampaignHooks(
  options: CreateProductionCampaignHooksOptions,
): CampaignServiceHooks {
  if (!options || !options.deps || typeof options.deps.publishPost !== 'function') {
    throw new Error('[createProductionCampaignHooks] deps.publishPost required');
  }
  const deps = options.deps;
  const telemetry = options.telemetry ?? defaultTelemetrySink;

  async function withTelemetry<T>(
    op: 'precheck' | 'post' | 'finalize',
    ctx: CampaignContext,
    extra: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    telemetry.emit('domain_campaign_live_execution_started', {
      executionId: ctx.executionId, campaignId: ctx.campaignId, op, ...extra,
    });
    try {
      const r = await fn();
      telemetry.emit('domain_campaign_live_execution_completed', {
        executionId: ctx.executionId, campaignId: ctx.campaignId, op, ...extra,
      });
      return r;
    } catch (err) {
      telemetry.emit('domain_campaign_live_execution_failed', {
        executionId: ctx.executionId, campaignId: ctx.campaignId, op, ...extra,
        error: (err as Error)?.message ?? String(err),
      });
      throw err;
    }
  }

  return {
    runCampaignPrecheck: deps.precheckCampaign
      ? (ctx) => withTelemetry('precheck', ctx, {}, () => deps.precheckCampaign!({
          executionId: ctx.executionId,
          campaignId: ctx.campaignId,
          totalPosts: ctx.totalPosts,
        }))
      : undefined,
    runPost: (ctx, postId, meta) => withTelemetry('post', ctx, { postId },
      () => deps.publishPost({
        executionId: ctx.executionId,
        campaignId: ctx.campaignId,
        postId, meta,
      }),
    ),
    runCampaignFinalize: deps.finalizeCampaign
      ? (ctx) => withTelemetry('finalize', ctx, {}, () => deps.finalizeCampaign!({
          executionId: ctx.executionId,
          campaignId: ctx.campaignId,
          totalPosts: ctx.totalPosts,
        }))
      : undefined,
  };
}
