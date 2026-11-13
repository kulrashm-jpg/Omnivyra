/**
 * Image reconciliation orchestrator (DALL·E / generic image-gen providers).
 * Mirrors OpenAI/Anthropic/Gemini/audio orchestrators and reuses the generic
 * `reconcileProviderInvoice` matcher core.
 *
 * Per-provider usage_events filtering:
 *   - providerTag='openai_image' → usage_events.provider_name='openai'
 *                                  AND model_name IN (gpt-image-*, dall-e-*).
 *   - providerTag='image:<name>' (caller supplies usageEventsProviderName)
 *                                → usage_events.provider_name=<name>.
 *
 * The matcher key is (period_day, model), so image rows never collide with
 * the existing OpenAI completion reconciler — DALL·E and gpt-image-* have
 * their own bucket per model. Resolution/quality are preserved in metadata
 * but do NOT participate in the bucket key (consistency with other adapters).
 *
 * REPLAY SAFETY: see reconciliationPersist (shared by the five provider
 *  reconcilers): one invoice per (provider, period); a re-run of an imported
 *  invoice RESUMES from its stored line_items until its run is 'completed',
 *  and only then is it a 'duplicate'. Adjustments are append-only
 *  (immutability trigger) and inserted in one statement, at most once per run.
 *
 * Runtime status: schema-correct against migrations 20260693/694 which are
 * CREATED BUT NOT APPLIED in this environment. Pure normalizer + matcher
 * fully unit-tested; live operation requires the controlled apply.
 */

import { logger } from '../../logger';
import {
  normalizeImageBillingExport,
  normalizeDalleUsageExport,
  normalizeImageUsageExport,
  IMAGE_ADAPTER_VERSION_BILLING,
  IMAGE_ADAPTER_VERSION_DALLE,
  IMAGE_ADAPTER_VERSION_USAGE,
  type ImageNormalizeResult,
} from './imageAdapter';
import type { RateTable } from './openaiAdapter';
import { persistProviderReconciliation, type PersistOutcome } from './reconciliationPersist';
import { readEstimatedUsageAggregates, type UsageFilter } from './usageAggregateReader';
import type { UsageAggregate } from './reconciliationMatcher';

export type ImageProviderTag = 'openai_image' | `image:${string}`;
export type ImagePayloadKind = 'billing' | 'dalle_usage' | 'image_usage';

export interface IngestImageArgs {
  providerInvoiceId: string;
  periodStart: string;
  periodEnd:   string;
  /** Provider tag persisted into provider_invoice_imports / adjustments. */
  providerTag: ImageProviderTag;
  /** When providerTag !== 'openai_image', the usage_events.provider_name to filter on. */
  usageEventsProviderName?: string;
  kind: ImagePayloadKind;
  payload: unknown;
  rates: RateTable;
}

export type IngestOutcome = PersistOutcome;

async function readUsageAggregates(
  providerTag: ImageProviderTag,
  usageEventsProviderName: string | undefined,
  periodStart: string,
  periodEnd: string,
): Promise<UsageAggregate[]> {
  let filter: UsageFilter;
  if (providerTag === 'openai_image') {
    filter = (q) => q.eq('provider_name', 'openai').or('model_name.like.dall-e%,model_name.like.gpt-image%');
  } else if (usageEventsProviderName) {
    filter = (q) => q.eq('provider_name', usageEventsProviderName);
  } else {
    // No usage filter we can trust — return empty so reconciliation surfaces
    // platform-level `missing_attribution` rows rather than mis-attributing.
    logger.warn('image_reconcile_missing_provider_filter', { providerTag });
    return [];
  }
  return readEstimatedUsageAggregates(providerTag, filter, periodStart, periodEnd);
}

function adapterVersionFor(kind: ImagePayloadKind): string {
  if (kind === 'dalle_usage') return IMAGE_ADAPTER_VERSION_DALLE;
  if (kind === 'image_usage') return IMAGE_ADAPTER_VERSION_USAGE;
  return IMAGE_ADAPTER_VERSION_BILLING;
}

export async function ingestImageInvoice(args: IngestImageArgs): Promise<IngestOutcome> {
  let norm: ImageNormalizeResult;
  if (args.kind === 'dalle_usage') {
    norm = normalizeDalleUsageExport({ payload: args.payload, rates: args.rates });
  } else if (args.kind === 'image_usage') {
    norm = normalizeImageUsageExport({ payload: args.payload, rates: args.rates });
  } else {
    norm = normalizeImageBillingExport({ payload: args.payload, rates: args.rates });
  }

  // 0) Read the estimates FIRST: the read fails closed (throws), and nothing has
  //    been written yet, so a failed read leaves the invoice importable on retry.
  const aggregates = await readUsageAggregates(args.providerTag, args.usageEventsProviderName, args.periodStart, args.periodEnd);

  // 1-5) Import, run, adjustments, completion - resumable (reconciliationPersist).
  return persistProviderReconciliation({
    provider: args.providerTag,
    providerInvoiceId: args.providerInvoiceId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    lines: norm.lines,
    rawPayload: args.payload,
    adapterVersion: adapterVersionFor(args.kind),
    warnings: norm.warnings,
    aggregates,
  });
}
