/**
 * Phase 2 — Black-Hole Cost Capture (telemetry only, NO billing)
 *
 * Some AI paths call providers via direct SDK/HTTP and never reach the
 * metered gateway, so provider USD cost is invisible (CREDIT_COVERAGE_AUDIT
 * Appendix G, Task 5). This helper records that cost into the EXISTING
 * usage_events pipeline as `source_type: 'system'` (variable-cost background
 * work, NOT user-billed) so margin/profitability becomes visible.
 *
 * STRICT (Phase 2 Task 2):
 *   - Additive + best-effort. NEVER throws — a capture failure must not change
 *     the caller's behavior or result. Wrap-and-swallow.
 *   - No billing, no HOLD, no credits, no pricing enforcement. `source_type`
 *     is always 'system'.
 *   - Reuses logUsageEvent (same dedup/anomaly/linkage rules as the gateway).
 *   - Cost is a deterministic STATIC ESTIMATE (public list prices, versioned
 *     as rate_source so it can be reconciled later — Gap #5). It is explicitly
 *     NOT provider-invoice-exact.
 *
 * Rollback: delete this file + the call sites (no schema, no data migration,
 * no behavior depends on it).
 */

import { logUsageEvent } from '../usageLedgerService';
import { logger } from '../logger';
import { incrCounter } from './billingMetrics';

/** Static public list-price estimates. Versioned for later reconciliation. */
const RATE_SOURCE = 'static_estimate_v1';

/** USD per 1K tokens (input, output). */
const TOKEN_RATES: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini':       { in: 0.00015, out: 0.00060 },
  'gpt-4o':            { in: 0.00250, out: 0.01000 },
  'gpt-4.1-mini':      { in: 0.00040, out: 0.00160 },
  'gemini-1.5-flash':  { in: 0.000075, out: 0.00030 },
};
const DEFAULT_TOKEN_RATE = TOKEN_RATES['gpt-4o-mini'];

function tokenCostUsd(model: string, inTok: number, outTok: number): number {
  const r = TOKEN_RATES[model] ?? DEFAULT_TOKEN_RATE;
  return (inTok / 1000) * r.in + (outTok / 1000) * r.out;
}

/** Static per-image USD estimates (conservative public list prices). */
const IMAGE_RATES: Record<string, number> = {
  'gpt-image-1': 0.02, // low-quality 1024 ≈ $0.011–0.02 (conservative upper)
  'dall-e-3':    0.04, // standard 1024
};
const DEFAULT_IMAGE_RATE = 0.04;

function imageCostUsd(model: string, count: number): number {
  const r = IMAGE_RATES[model] ?? DEFAULT_IMAGE_RATE;
  return Math.max(0, count) * r;
}

export interface BlackHoleCaptureInput {
  organizationId: string;
  /** A process_type already known to resolveActionKey (avoids anomaly/refusal). */
  processType: string;
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  userId?: string | null;
  referenceId?: string | null;
  /** Semantic activity type for consumption correlation; defaults to 'black_hole_capture'. */
  referenceType?: string | null;
  parentActivityId?: string | null;
  /** True if the underlying provider call failed (row still useful for ops). */
  errorFlag?: boolean;
  /** The real activity label, kept in metadata for attribution/audit. */
  activity: string;
}

/**
 * Capture a token-priced provider call's cost. Best-effort; never throws.
 */
export async function captureTokenProviderCost(input: BlackHoleCaptureInput): Promise<void> {
  try {
    if (!input.organizationId) return; // no org → cannot attribute; skip silently
    const inTok = Math.max(0, Math.round(input.inputTokens ?? 0));
    const outTok = Math.max(0, Math.round(input.outputTokens ?? 0));
    const costUsd = tokenCostUsd(input.model, inTok, outTok);

    await logUsageEvent({
      organization_id: input.organizationId,
      user_id:         input.userId ?? null,
      source_type:     'system', // visibility only — NOT user-billed
      provider:        input.provider,
      provider_name:   input.provider,
      model:           input.model,
      model_name:      input.model,
      source_name:     `${input.provider}:${input.model}`,
      process_type:    input.processType,
      input_tokens:    inTok,
      output_tokens:   outTok,
      total_tokens:    inTok + outTok,
      total_cost_usd:  costUsd,
      error_flag:      !!input.errorFlag,
      reference_id:    input.referenceId ?? null,
      reference_type:  input.referenceType ?? 'black_hole_capture',
      metadata: {
        capture:      'black_hole_v1',
        rate_source:  RATE_SOURCE,
        activity:     input.activity,
        cost_basis:   'static_estimate',
      },
    });
  } catch (err) {
    incrCounter('black_hole_cost_capture_failed_total');
    logger.warn('black_hole_cost_capture_failed', {
      activity: input.activity,
      org:      input.organizationId,
      message:  err instanceof Error ? err.message : String(err),
    });
  }
}

export interface FlatProviderCaptureInput {
  organizationId: string;
  processType: string;          // a catalog-known key (avoids anomaly/refusal)
  provider: string;
  model: string;
  /** Explicit provider USD estimate (caller computes; e.g. per-minute audio). */
  totalCostUsd: number;
  /** Free-form unit detail for audit (e.g. { audio_seconds: 73 }). */
  units?: Record<string, unknown>;
  userId?: string | null;
  referenceId?: string | null;
  referenceType?: string | null;
  parentActivityId?: string | null;
  errorFlag?: boolean;
  activity: string;
}

/**
 * Capture a provider call whose cost is a caller-supplied flat USD estimate
 * (non-tokenized, non-image — e.g. audio transcription per-minute).
 * Best-effort; never throws. Telemetry only — source_type:'system', no billing.
 * Phase 4.1 Task 3.
 */
export async function captureFlatProviderCost(input: FlatProviderCaptureInput): Promise<void> {
  try {
    if (!input.organizationId) return; // no org → skip (no fake attribution)
    await logUsageEvent({
      organization_id: input.organizationId,
      user_id:         input.userId ?? null,
      source_type:     'system',
      provider:        input.provider,
      provider_name:   input.provider,
      model:           input.model,
      model_name:      input.model,
      source_name:     `${input.provider}:${input.model}`,
      process_type:    input.processType,
      input_tokens:    0,
      output_tokens:   0,
      total_tokens:    0,
      total_cost_usd:  Math.max(0, input.totalCostUsd),
      error_flag:      !!input.errorFlag,
      reference_id:    input.referenceId ?? null,
      reference_type:  input.referenceType ?? 'black_hole_capture',
      metadata: {
        capture:     'black_hole_flat_v1',
        rate_source: RATE_SOURCE,
        activity:    input.activity,
        cost_basis:  'static_estimate',
        units:       input.units ?? null,
      },
    });
  } catch (err) {
    incrCounter('black_hole_cost_capture_failed_total');
    logger.warn('black_hole_cost_capture_failed', {
      activity: input.activity,
      org:      input.organizationId,
      message:  err instanceof Error ? err.message : String(err),
    });
  }
}

export interface ImageProviderCaptureInput {
  organizationId: string;
  processType: string;
  provider: string;
  model: string;
  imageCount: number;
  /** Optional size/quality for audit (e.g. "1024x1024"). */
  size?: string | null;
  userId?: string | null;
  campaignId?: string | null;
  referenceId?: string | null;
  referenceType?: string | null;
  parentActivityId?: string | null;
  errorFlag?: boolean;
  activity: string;
}

/**
 * Capture an image-generation provider call's cost (per-image, NOT tokenized).
 * Best-effort; never throws. Telemetry only — source_type:'system', no billing.
 * Phase 4.1 Task 1.
 */
export async function captureImageProviderCost(input: ImageProviderCaptureInput): Promise<void> {
  try {
    if (!input.organizationId) return; // no org → cannot attribute; skip (no fake attribution)
    const count = Math.max(0, Math.round(input.imageCount ?? 0));
    if (count === 0) return;
    const costUsd = imageCostUsd(input.model, count);

    await logUsageEvent({
      organization_id: input.organizationId,
      campaign_id:     input.campaignId ?? null,
      user_id:         input.userId ?? null,
      source_type:     'system', // visibility only — NOT user-billed
      provider:        input.provider,
      provider_name:   input.provider,
      model:           input.model,
      model_name:      input.model,
      source_name:     `${input.provider}:${input.model}`,
      process_type:    input.processType,
      input_tokens:    0,
      output_tokens:   0,
      total_tokens:    0,
      total_cost_usd:  costUsd,
      error_flag:      !!input.errorFlag,
      reference_id:    input.referenceId ?? null,
      reference_type:  input.referenceType ?? 'black_hole_capture',
      metadata: {
        capture:     'black_hole_image_v1',
        rate_source: RATE_SOURCE,
        activity:    input.activity,
        cost_basis:  'static_estimate',
        image_count: count,
        image_size:  input.size ?? null,
        ...(input.parentActivityId ? { parent_activity_id: input.parentActivityId } : {}),
      },
    });
  } catch (err) {
    incrCounter('black_hole_cost_capture_failed_total');
    logger.warn('black_hole_cost_capture_failed', {
      activity: input.activity,
      org:      input.organizationId,
      message:  err instanceof Error ? err.message : String(err),
    });
  }
}
