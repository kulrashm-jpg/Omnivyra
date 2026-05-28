/**
 * Shared streaming hooks for downstream generation phases.
 *
 * The planner-drafting path already uses the gateway's `stream: true` +
 * `onChunk` hooks (see `aiGateway.callOpenAi` streaming branch). This file
 * exposes those same primitives as a reusable wrapper for other phases:
 *
 *   - daily-plan generation
 *   - weekly-expansion (post → carousel → CTA)
 *   - CTA enrichment
 *   - "optimization" phases (alignment refinements, etc.)
 *
 * Each phase wraps its LLM call with `withProgressiveStream` so it gets:
 *   - progressive chunk-by-chunk parsing via the caller's parser hook
 *   - streamed-salvage on mid-stream abort
 *   - partial recovery: when the abort fires, the caller's parser receives
 *     the accumulated buffer one last time so it can persist what it has
 *   - planner-budget compatibility: respects any outer AbortSignal
 *
 * IMPORTANT: This module is opt-in per call site. We are NOT migrating every
 * generation pipeline to streaming in this pass — daily/weekly/CTA paths
 * still default to non-streaming. The function signature is here so each
 * pipeline can adopt streaming incrementally with a one-line change.
 *
 * Example call site:
 *
 *   const { fullText, partialOnAbort } = await withProgressiveStream({
 *     phase: 'daily_plan',
 *     callOptions: { ... gateway request ... },
 *     onChunk: (delta, accumulated) => { runIncrementalParse(accumulated); },
 *     onPartial: (accumulated) => { persistPartialState(accumulated); },
 *     signal: outerSignal,
 *   });
 */

import { runCompletionWithOperation } from './aiGateway';
import { logger } from './logger';
import { getRequestContext } from './requestContext';

export type StreamingPhase =
  | 'daily_plan'
  | 'weekly_expansion'
  | 'cta_enrichment'
  | 'optimization';

export interface ProgressiveStreamOptions {
  phase: StreamingPhase;
  /** Gateway request, minus the streaming options (we set them). */
  callOptions: Omit<Parameters<typeof runCompletionWithOperation>[0], 'stream' | 'onChunk'>;
  /** Optional caller signal — passed through to the gateway. */
  signal?: AbortSignal;
  /** Called on every streamed chunk. */
  onChunk?: (delta: string, accumulated: string) => void;
  /** Called once with the accumulated text on abort, BEFORE we re-throw the
   *  GatewayPartialStreamError. Use this to persist partial state so the
   *  caller's salvage layer can read it back. */
  onPartial?: (accumulated: string) => void;
}

export interface ProgressiveStreamResult {
  fullText: string;
  partialOnAbort: string | null;
  durationMs: number;
}

/**
 * Wrap a gateway call in the streaming pattern used across the planner.
 * Either returns `{ fullText }` on success OR re-throws on non-abort error.
 * On caller abort: the caller's `onPartial` is invoked synchronously with
 * the accumulated buffer, then the error is re-thrown so the call site can
 * apply its own salvage.
 */
export async function withProgressiveStream(
  opts: ProgressiveStreamOptions,
): Promise<ProgressiveStreamResult> {
  const startedAt = Date.now();
  let accumulated = '';
  try {
    const result = await runCompletionWithOperation({
      ...opts.callOptions,
      signal: opts.signal,
      stream: true,
      onChunk: (delta: string, accum: string) => {
        accumulated = accum;
        try { opts.onChunk?.(delta, accum); } catch { /* observer error swallowed */ }
      },
    });
    return {
      fullText: result.output,
      partialOnAbort: null,
      durationMs: Date.now() - startedAt,
    };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const partialFromErr = (err as { partialOutput?: string })?.partialOutput;
    const partial = (typeof partialFromErr === 'string' && partialFromErr.length > accumulated.length)
      ? partialFromErr
      : accumulated;
    if (code === 'PROVIDER_PARTIAL_STREAM' || code === 'PROVIDER_ABORTED') {
      if (partial.length > 0 && opts.onPartial) {
        try { opts.onPartial(partial); } catch { /* observer error swallowed */ }
      }
      logger.info('streaming_generation_partial', {
        request_id: getRequestContext().requestId,
        phase: opts.phase,
        partial_chars: partial.length,
        duration_ms: Date.now() - startedAt,
      });
    }
    throw err;
  }
}
