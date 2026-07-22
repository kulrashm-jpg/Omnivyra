/**
 * WAVE-1 — Canonical structured-output parsing (realizes AI-CONTRACT-000 §C1
 * "structured outputs" + §S9 `Result`). The ONE safe-parse for model output.
 *
 * Replaces raw `JSON.parse(model.output)` (OMNI-AI-001 found 17 unguarded sites).
 * Handles the real-world failure modes: markdown code fences, leading/trailing
 * prose, truncated JSON, and non-JSON completions — never throws; returns a typed
 * Result carrying an AiError on failure.
 */
import { AiError } from './aiError';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AiError };

/** Strip ```json ... ``` fences and surrounding prose to the outermost JSON value. */
export function extractJsonText(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  // Remove a leading ```json / ``` fence and its trailing counterpart.
  const fence = s.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  // If still not starting with a JSON opener, slice to the outermost { } or [ ].
  if (s[0] !== '{' && s[0] !== '[') {
    const firstObj = s.indexOf('{');
    const firstArr = s.indexOf('[');
    const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
    if (start === -1) return null;
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    const end = s.lastIndexOf(close);
    if (end <= start) return null;
    s = s.slice(start, end + 1);
  }
  return s;
}

/**
 * Parse model output into a typed value. `validate` is an optional structural
 * guard (typed extraction); on any failure a typed AiError is returned.
 */
export function parseStructured<T = unknown>(
  raw: string,
  opts: { validate?: (v: unknown) => v is T; correlationId?: string; label?: string } = {},
): ParseResult<T> {
  const text = extractJsonText(raw);
  if (text === null) {
    return {
      ok: false,
      error: new AiError('VALIDATION_BAD_OUTPUT', {
        devDetail: `${opts.label ?? 'output'}: no JSON found in model output`,
        correlationId: opts.correlationId,
      }),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: new AiError('VALIDATION_BAD_OUTPUT', {
        devDetail: `${opts.label ?? 'output'}: JSON.parse failed — ${(e as Error).message}`,
        correlationId: opts.correlationId,
      }),
    };
  }
  if (opts.validate && !opts.validate(parsed)) {
    return {
      ok: false,
      error: new AiError('VALIDATION_REJECTED', {
        devDetail: `${opts.label ?? 'output'}: parsed JSON failed schema validation`,
        correlationId: opts.correlationId,
      }),
    };
  }
  return { ok: true, value: parsed as T };
}

/**
 * Convenience: parse or return a caller-supplied fallback (graceful failure).
 * Prefer `parseStructured` where the failure must be surfaced/observed.
 */
export function parseStructuredOr<T>(raw: string, fallback: T, validate?: (v: unknown) => v is T): T {
  const r = parseStructured<T>(raw, validate ? { validate } : {});
  return r.ok ? r.value : fallback;
}
