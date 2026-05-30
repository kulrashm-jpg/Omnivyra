/**
 * Strategic theme structural validator.
 *
 * BOLT pipeline `runSourceRecommendation` and `runAiPlan` both assume the
 * `sourceStrategicTheme` payload is at least an object and that core
 * blueprint fields exist before they pass it to the orchestrator. When
 * a caller hands in a malformed payload the failure surfaces deep in
 * ai/plan or campaign_versions persistence with a generic message.
 *
 * This validator runs BEFORE enqueue so a bad payload short-circuits
 * with a precise BoltError instead of reaching a worker.
 *
 * Validation rules (intentionally tight — relax only with evidence):
 *
 *   1. Theme is a non-null plain object.
 *   2. JSON.stringify(theme) succeeds (no cycles / unserialisable values).
 *   3. At least ONE of the canonical "title" fields is a non-empty
 *      string — otherwise the planner can't even name the campaign.
 *      Recognised: title, polished_title, topic, blueprint.topic,
 *      core.topic, core.polished_title.
 *   4. When the recommendation card schema is detected (presence of a
 *      `blueprint` sub-object), the blueprint must carry at least one
 *      of: progression_summary, primary_recommendations[],
 *      supporting_recommendations[]. Empty blueprint → reject.
 *   5. context_payload, when present, must be a plain object (NOT an
 *      array, NOT a primitive). Required because runAiPlan spreads it:
 *      `{ ...basePayload, ...payload.sourceStrategicTheme }`. Spreading
 *      an array silently loses fields; spreading a string crashes.
 *   6. metadata, when present, must also be a plain object (same
 *      reason — it's spread into the snapshot at source-recommendation).
 */

import { BoltError, BOLT_ERROR_CODES } from './boltErrorCodes';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(obj: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function readNonEmptyArray(obj: Record<string, unknown> | null | undefined, key: string): unknown[] | null {
  if (!obj) return null;
  const v = obj[key];
  return Array.isArray(v) && v.length > 0 ? v : null;
}

export interface StrategicThemeValidationResult {
  ok: boolean;
  /** Populated when `ok=false`. Thrown as BoltError by the strict wrapper. */
  errors: Array<{ code: keyof typeof BOLT_ERROR_CODES; message: string; field?: string }>;
}

/**
 * Pure validator. Never throws. Returns a structured result so callers
 * can decide whether to short-circuit with a BoltError or collect errors.
 */
export function validateStrategicTheme(theme: unknown): StrategicThemeValidationResult {
  const errors: StrategicThemeValidationResult['errors'] = [];

  if (theme == null) {
    errors.push({
      code: 'THEME_MISSING',
      message: 'sourceStrategicTheme is required.',
    });
    return { ok: false, errors };
  }
  if (!isPlainObject(theme)) {
    errors.push({
      code: 'THEME_INVALID_SHAPE',
      message: 'sourceStrategicTheme must be a JSON object (received ' + (Array.isArray(theme) ? 'array' : typeof theme) + ').',
    });
    return { ok: false, errors };
  }

  // Rule 2 — serialisation safety.
  try {
    JSON.stringify(theme);
  } catch (serErr) {
    errors.push({
      code: 'THEME_SERIALIZATION_FAILED',
      message: `sourceStrategicTheme cannot be serialised: ${(serErr as Error)?.message ?? 'unknown error'}`,
    });
    return { ok: false, errors };
  }

  // Rule 3 — at least one recognised title field.
  const core = isPlainObject(theme.core) ? theme.core : null;
  const blueprint = isPlainObject(theme.blueprint) ? theme.blueprint : null;
  const hasTitle =
    readNonEmptyString(theme, 'title') ??
    readNonEmptyString(theme, 'polished_title') ??
    readNonEmptyString(theme, 'topic') ??
    readNonEmptyString(core, 'topic') ??
    readNonEmptyString(core, 'polished_title') ??
    readNonEmptyString(blueprint, 'topic');
  if (!hasTitle) {
    errors.push({
      code: 'THEME_MISSING_REQUIRED_FIELD',
      message: 'sourceStrategicTheme is missing a title (one of: title, polished_title, topic, core.topic, core.polished_title, blueprint.topic).',
      field: 'title',
    });
  }

  // Rule 4 — blueprint sub-object, when present, must not be empty.
  if (blueprint) {
    const hasProgression = readNonEmptyString(blueprint, 'progression_summary');
    const hasPrimary = readNonEmptyArray(blueprint, 'primary_recommendations');
    const hasSupporting = readNonEmptyArray(blueprint, 'supporting_recommendations');
    if (!hasProgression && !hasPrimary && !hasSupporting) {
      errors.push({
        code: 'THEME_MISSING_REQUIRED_FIELD',
        message: 'sourceStrategicTheme.blueprint must contain progression_summary, primary_recommendations, or supporting_recommendations.',
        field: 'blueprint',
      });
    }
  }

  // Rule 5 — context_payload shape.
  const contextPayload = theme.context_payload;
  if (contextPayload !== undefined && contextPayload !== null && !isPlainObject(contextPayload)) {
    errors.push({
      code: 'THEME_INVALID_SHAPE',
      message: `sourceStrategicTheme.context_payload must be a JSON object when present (received ${Array.isArray(contextPayload) ? 'array' : typeof contextPayload}).`,
      field: 'context_payload',
    });
  }

  // Rule 6 — metadata shape.
  const metadata = theme.metadata;
  if (metadata !== undefined && metadata !== null && !isPlainObject(metadata)) {
    errors.push({
      code: 'THEME_INVALID_SHAPE',
      message: `sourceStrategicTheme.metadata must be a JSON object when present (received ${Array.isArray(metadata) ? 'array' : typeof metadata}).`,
      field: 'metadata',
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Strict variant — throws BoltError on first error. Useful at boundaries
 * where the caller wants a fast-failing exception.
 */
export function assertValidStrategicTheme(theme: unknown): void {
  const result = validateStrategicTheme(theme);
  if (result.ok) return;
  const first = result.errors[0];
  throw new BoltError(BOLT_ERROR_CODES[first.code], first.message, {
    details: { all_errors: result.errors },
  });
}
