/**
 * longFormEngineTelemetry.ts
 *
 * Structured telemetry for the unified long-form engine.
 *
 * Emits machine-parseable events so operators can:
 *   - tell which engine actually generated a result (planned vs compatibility-core)
 *   - see every silent fallback with the original error + stack
 *   - audit context-fidelity and section-assignment shape across runs
 *
 * This module deliberately has zero dependencies beyond `console`.
 * Downstream log scrapers can pick up the `[longform-engine]` tag.
 */

import type { LongFormContentType } from './longFormContentTypeConfig';

// ── Event types ──────────────────────────────────────────────────────────────

export type LongFormEngineEvent =
  | 'LONGFORM_ENGINE_FALLBACK'
  | 'LONGFORM_ENGINE_SELECTED'
  | 'LONGFORM_CONTEXT_USAGE_REPORT'
  | 'LONGFORM_IDENTITY_CONSISTENCY_WARNING';

export interface LongFormEngineFallbackPayload {
  event: 'LONGFORM_ENGINE_FALLBACK';
  attempted_engine: 'planned-sectionwise-v1';
  final_engine: 'compatibility-core';
  fallback_triggered: true;
  fallback_reason: string;
  fallback_stack?: string;
  request: {
    company_id?: string;
    content_type: LongFormContentType;
    mode: string;
    topic: string;
    format_type?: string;
    target_word_count?: number;
    template_name?: string;
  };
  timestamp: string;
}

export interface LongFormEngineSelectedPayload {
  event: 'LONGFORM_ENGINE_SELECTED';
  attempted_engine: string;
  final_engine: string;
  fallback_triggered: boolean;
  request: {
    company_id?: string;
    content_type: LongFormContentType;
    mode: string;
    topic: string;
    format_type?: string;
  };
  timestamp: string;
}

// ── Emission ─────────────────────────────────────────────────────────────────

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Emit a structured long-form engine event.
 *
 * In all environments the event is written to `console.warn` (for fallbacks)
 * or `console.log` (for successful selections) as a single line of JSON,
 * prefixed with `[longform-engine]`. Production log pipelines can parse the
 * trailing JSON for dashboards/alerts.
 *
 * In non-production we additionally surface a human-readable banner so
 * developers see the fallback without grepping logs.
 */
function emit(level: 'warn' | 'log' | 'error', payload: Record<string, unknown>): void {
  const line = `[longform-engine] ${JSON.stringify(payload)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function emitEngineFallback(input: Omit<LongFormEngineFallbackPayload, 'event' | 'timestamp' | 'fallback_triggered' | 'attempted_engine' | 'final_engine'> & {
  attempted_engine?: LongFormEngineFallbackPayload['attempted_engine'];
  final_engine?: LongFormEngineFallbackPayload['final_engine'];
}): LongFormEngineFallbackPayload {
  const payload: LongFormEngineFallbackPayload = {
    event: 'LONGFORM_ENGINE_FALLBACK',
    attempted_engine: input.attempted_engine ?? 'planned-sectionwise-v1',
    final_engine: input.final_engine ?? 'compatibility-core',
    fallback_triggered: true,
    fallback_reason: input.fallback_reason,
    fallback_stack: input.fallback_stack,
    request: input.request,
    timestamp: new Date().toISOString(),
  };
  emit('warn', payload as unknown as Record<string, unknown>);
  if (isDev()) {
    // Developer-visible banner: fallback was silent before; now it shouts.
    console.warn(
      `\n  ⚠️  [longform-engine] FALLBACK: ${payload.attempted_engine} → ${payload.final_engine}\n` +
      `      reason: ${payload.fallback_reason}\n` +
      `      content_type: ${payload.request.content_type}  topic: ${payload.request.topic}\n`
    );
  }
  return payload;
}

export function emitEngineSelected(input: Omit<LongFormEngineSelectedPayload, 'event' | 'timestamp'>): LongFormEngineSelectedPayload {
  const payload: LongFormEngineSelectedPayload = {
    event: 'LONGFORM_ENGINE_SELECTED',
    ...input,
    timestamp: new Date().toISOString(),
  };
  emit('log', payload as unknown as Record<string, unknown>);
  return payload;
}

export function emitContextUsageReport(payload: Record<string, unknown>): void {
  emit('log', { event: 'LONGFORM_CONTEXT_USAGE_REPORT', ...payload, timestamp: new Date().toISOString() });
}

export function emitIdentityConsistencyWarning(payload: Record<string, unknown>): void {
  emit('warn', { event: 'LONGFORM_IDENTITY_CONSISTENCY_WARNING', ...payload, timestamp: new Date().toISOString() });
}
