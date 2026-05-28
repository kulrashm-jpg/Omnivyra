/**
 * Phase 26C — Production social publish hook factory.
 *
 * Wires `SocialPublishServiceHooks` into the real per-provider adapters
 * (x / linkedin / instagram / facebook / tiktok / youtube / pinterest /
 * reddit / spotify) without modifying any adapter. Same opt-in factory
 * pattern: operators import their adapters and pass a `provider →
 * adapterFn` map.
 *
 * IDEMPOTENCY GUARANTEES (per spec):
 *   1. The Phase 24C builder attaches per-step idempotency
 *      `cls=node_insert`, `semanticParts=['sp', provider, accountId,
 *      contentFingerprint, threadRootId|null]`. Re-running the same
 *      publish step is a no-op via the governor.
 *   2. Adapters ALREADY implement per-platform idempotency (the spec
 *      says "preserve adapter idempotency semantics"); this hook calls
 *      them as-is.
 *   3. THIS hook adds defense-in-depth: an in-process publish-fingerprint
 *      cache that suppresses provider calls for fingerprints already
 *      published in the current process (caches up to 10_000 entries).
 *      This is in addition to the durable governor; it short-circuits
 *      replays without round-tripping through the governor on every call.
 *
 * Distributed replay → adapter idempotency layers (3 deep):
 *   queue dedup (step) → idempotency governor → in-process fp cache →
 *   adapter's own per-provider idempotency.
 *
 * Telemetry:
 *   domain_publish_live_execution_started
 *   domain_publish_live_execution_completed
 *   domain_publish_live_execution_failed
 *   domain_publish_live_execution_suppressed (fingerprint cache hit)
 */

import type {
  SocialPlatform,
  SocialPublishContext,
  SocialPublishServiceHooks,
} from '../domainWorkflowTypes';

// ────────────────────────────────────────────────────────────────────
// Adapter signature
// ────────────────────────────────────────────────────────────────────

/**
 * Per-provider publish function. Each existing adapter exposes its own
 * shape (e.g. `xAdapter.publish(input)`); operators wrap it to match
 * this signature in their boot wiring. The wrapper has full access to
 * the context — `scheduledPostId` is enough to look up the row,
 * `contentFingerprint` lets the wrapper bail if the adapter already
 * marked the post as published.
 */
export type ProviderAdapterFn = (input: {
  executionId: string;
  provider: SocialPlatform;
  socialAccountId: string;
  scheduledPostId: string;
  contentFingerprint: string;
  threadRootId: string | null;
}) => Promise<void>;

export type ProviderAdapterMap = Partial<Record<SocialPlatform, ProviderAdapterFn>>;

export interface SocialPublishServiceDeps {
  /** Provider → adapter function map. Operators wire each platform's adapter. */
  adapters: ProviderAdapterMap;
  /** Optional pre-publish validation (e.g. token freshness check). */
  validateTokens?: (input: {
    executionId: string;
    provider: SocialPlatform;
    socialAccountId: string;
  }) => Promise<void>;
  /** Optional post-publish confirmation (e.g. verify provider state). */
  confirmPublish?: (input: {
    executionId: string;
    provider: SocialPlatform;
    socialAccountId: string;
    scheduledPostId: string;
    contentFingerprint: string;
  }) => Promise<void>;
}

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ProductionPublishTelemetryEvent =
  | 'domain_publish_live_execution_started'
  | 'domain_publish_live_execution_completed'
  | 'domain_publish_live_execution_failed'
  | 'domain_publish_live_execution_suppressed';

export interface ProductionPublishTelemetrySink {
  emit(event: ProductionPublishTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ProductionPublishTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'domain_publish_live_execution_failed') console.warn(`[prod_publish] ${line}`);
      else console.log(`[prod_publish] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class ProductionPublishHookError extends Error {
  constructor(
    public readonly code: 'NO_ADAPTER' | 'ADAPTER_THREW' | 'INVALID_INPUT',
    message: string,
  ) {
    super(`[ProductionPublishHook] ${code}: ${message}`);
    this.name = 'ProductionPublishHookError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────

export interface CreateProductionSocialPublishHooksOptions {
  deps: SocialPublishServiceDeps;
  telemetry?: ProductionPublishTelemetrySink;
  /** Max fingerprints kept in the in-process suppression cache. Default 10_000. */
  fingerprintCacheSize?: number;
}

export function createProductionSocialPublishHooks(
  options: CreateProductionSocialPublishHooksOptions,
): SocialPublishServiceHooks {
  if (!options || !options.deps || typeof options.deps.adapters !== 'object') {
    throw new Error('[createProductionSocialPublishHooks] deps.adapters required');
  }
  const deps = options.deps;
  const telemetry = options.telemetry ?? defaultTelemetrySink;
  const cacheSize = Math.max(100, options.fingerprintCacheSize ?? 10_000);

  // In-process suppression cache. Key = `${provider}:${accountId}:${fingerprint}:${threadRootId|''}`.
  const publishedFingerprints = new Set<string>();

  function cacheKey(ctx: SocialPublishContext): string {
    return `${ctx.provider}:${ctx.socialAccountId}:${ctx.contentFingerprint}:${ctx.threadRootId ?? ''}`;
  }
  function noteCacheHit(key: string): void {
    publishedFingerprints.add(key);
    while (publishedFingerprints.size > cacheSize) {
      // Drop the oldest entry (Set iteration is insertion-order).
      const first = publishedFingerprints.values().next().value as string | undefined;
      if (!first) break;
      publishedFingerprints.delete(first);
    }
  }

  return {
    runPublishValidate: deps.validateTokens
      ? async (ctx) => {
          telemetry.emit('domain_publish_live_execution_started', {
            executionId: ctx.executionId, provider: ctx.provider,
            op: 'validate', accountId: ctx.socialAccountId,
          });
          try {
            await deps.validateTokens!({
              executionId: ctx.executionId,
              provider: ctx.provider,
              socialAccountId: ctx.socialAccountId,
            });
            telemetry.emit('domain_publish_live_execution_completed', {
              executionId: ctx.executionId, provider: ctx.provider, op: 'validate',
            });
          } catch (err) {
            telemetry.emit('domain_publish_live_execution_failed', {
              executionId: ctx.executionId, provider: ctx.provider, op: 'validate',
              error: (err as Error)?.message ?? String(err),
            });
            throw err;
          }
        }
      : undefined,

    runProviderPublish: async (ctx) => {
      const adapter = deps.adapters[ctx.provider];
      if (!adapter) {
        const err = new ProductionPublishHookError(
          'NO_ADAPTER',
          `no adapter registered for provider='${ctx.provider}'`,
        );
        telemetry.emit('domain_publish_live_execution_failed', {
          executionId: ctx.executionId, provider: ctx.provider,
          contentFingerprint: ctx.contentFingerprint,
          op: 'publish', error: err.message,
        });
        throw err;
      }

      const key = cacheKey(ctx);
      if (publishedFingerprints.has(key)) {
        // Defense-in-depth: the substrate's idempotency governor should
        // already have suppressed this, but a same-process retry could
        // sneak through if the governor cache TTL'd the entry. Belt-and-
        // braces: refuse to call the adapter.
        telemetry.emit('domain_publish_live_execution_suppressed', {
          executionId: ctx.executionId, provider: ctx.provider,
          contentFingerprint: ctx.contentFingerprint,
          accountId: ctx.socialAccountId,
          reason: 'fingerprint_cache_hit',
        });
        return;
      }

      telemetry.emit('domain_publish_live_execution_started', {
        executionId: ctx.executionId, provider: ctx.provider,
        contentFingerprint: ctx.contentFingerprint,
        accountId: ctx.socialAccountId, op: 'publish',
      });
      try {
        await adapter({
          executionId: ctx.executionId,
          provider: ctx.provider,
          socialAccountId: ctx.socialAccountId,
          scheduledPostId: ctx.scheduledPostId,
          contentFingerprint: ctx.contentFingerprint,
          threadRootId: ctx.threadRootId,
        });
        // On success, populate the cache. Failures intentionally don't —
        // the queue's retry policy will replay, and we want the adapter's
        // own idempotency to handle the retry.
        noteCacheHit(key);
        telemetry.emit('domain_publish_live_execution_completed', {
          executionId: ctx.executionId, provider: ctx.provider,
          contentFingerprint: ctx.contentFingerprint, op: 'publish',
        });
      } catch (err) {
        telemetry.emit('domain_publish_live_execution_failed', {
          executionId: ctx.executionId, provider: ctx.provider,
          contentFingerprint: ctx.contentFingerprint,
          op: 'publish',
          error: (err as Error)?.message ?? String(err),
        });
        throw new ProductionPublishHookError(
          'ADAPTER_THREW',
          `adapter for '${ctx.provider}' threw: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    },

    runPublishConfirm: deps.confirmPublish
      ? async (ctx) => {
          telemetry.emit('domain_publish_live_execution_started', {
            executionId: ctx.executionId, provider: ctx.provider, op: 'confirm',
          });
          try {
            await deps.confirmPublish!({
              executionId: ctx.executionId,
              provider: ctx.provider,
              socialAccountId: ctx.socialAccountId,
              scheduledPostId: ctx.scheduledPostId,
              contentFingerprint: ctx.contentFingerprint,
            });
            telemetry.emit('domain_publish_live_execution_completed', {
              executionId: ctx.executionId, provider: ctx.provider, op: 'confirm',
            });
          } catch (err) {
            telemetry.emit('domain_publish_live_execution_failed', {
              executionId: ctx.executionId, provider: ctx.provider, op: 'confirm',
              error: (err as Error)?.message ?? String(err),
            });
            throw err;
          }
        }
      : undefined,
  };
}
