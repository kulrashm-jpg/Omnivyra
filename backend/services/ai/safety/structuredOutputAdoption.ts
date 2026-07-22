/**
 * WAVE-1C-001 — Structured-output adoption wrapper (composes the ONE canonical
 * parser `parseStructured` — NOT a second parser). One glue path so every AI
 * response boundary parses identically (fence-strip + typed AiError + graceful
 * failure) and emits the §C1/§X1 observability.
 *
 * Reuses: parseStructured/ParseResult (safeParse.ts) + the HARDEN-001 registry.
 * Never throws across a subsystem boundary.
 */
import { parseStructured, type ParseResult } from './safeParse';
import { newReasoningId } from './promptSafetyAdoption';
import { recordRawCounter, recordRawHistogram } from '../../../observability';

/** The one parser's version (for observability + version-aware consumers). */
export const PARSER_VERSION = '1.0.0';

function observe(surface: string, ok: boolean, durationMs: number, errorCode?: string, schemaId?: string): void {
  try {
    recordRawCounter('ai.structured_output.parse', 1, {
      surface, outcome: ok ? 'ok' : 'fail', parser_version: PARSER_VERSION, schema: schemaId ?? 'none',
    });
    recordRawHistogram('ai.structured_output.latency_ms', Math.max(0, durationMs), { surface });
    if (!ok && errorCode) recordRawCounter('ai.structured_output.error', 1, { surface, code: errorCode });
  } catch { /* observability is fail-safe */ }
}

export interface ParseCtx<T = unknown> {
  surface: string;                                   // schema identifier / call-site label
  correlationId?: string;
  reasoningId?: string;
  validate?: (v: unknown) => v is T;                 // optional typed schema guard
  schemaId?: string;
}

/**
 * Parse an AI response into a typed Result. Emits observability; never throws.
 * Use when the caller wants to branch on the failure (surface an AiError).
 */
export function parseModelOutput<T = unknown>(output: string | null | undefined, ctx: ParseCtx<T>): ParseResult<T> {
  const started = Date.now();
  const reasoningId = ctx.reasoningId ?? newReasoningId();
  const r = parseStructured<T>(output ?? '', {
    correlationId: ctx.correlationId, label: ctx.schemaId ?? ctx.surface,
    ...(ctx.validate ? { validate: ctx.validate } : {}),
  });
  // reasoningId is available for artifact↔parse correlation via the surface label.
  void reasoningId;
  const errCode = 'error' in r ? r.error.code : undefined;
  observe(ctx.surface, r.ok, Date.now() - started, errCode, ctx.schemaId);
  return r;
}

/**
 * Parse an AI response, returning the value or a caller-supplied fallback
 * (graceful degradation — replaces `output ? JSON.parse(output) : fallback`).
 * Emits observability; never throws. Fence-stripping + typed failure included.
 */
export function parseModelOutputOr<T>(output: string | null | undefined, fallback: T, ctx: ParseCtx<T>): T {
  const r = parseModelOutput<T>(output, ctx);
  return r.ok ? r.value : fallback;
}
