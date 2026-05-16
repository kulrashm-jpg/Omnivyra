/**
 * Creator Rendering — Step-R2 projection sanitizer (PURE).
 * ──────────────────────────────────────────────────────────────────────────
 * Defense-in-depth between the workspace task and the RenderSpec. It
 * NEVER trusts the assembled projection: it deep-scans for forbidden
 * leakage, rejects non-serialization-safe / non-deterministic values,
 * and deep-freezes the result.
 *
 * Fail-closed: any detected forbidden key, function/symbol/Date/Map/Set,
 * non-finite number, or cyclic structure → throw (no silent strip of a
 * forbidden key — its mere presence is a boundary breach to surface).
 *
 * PURE: no DB, no network, no clock, no mutation of the input.
 */

import { RENDER_FORBIDDEN_FIELDS } from '../contracts';

export class RenderProjectionError extends Error {
  readonly code: string;
  readonly path?: string;
  constructor(code: string, message: string, path?: string) {
    super(message);
    this.code = code;
    this.path = path;
    this.name = 'RenderProjectionError';
  }
}

const FORBIDDEN = new Set<string>(RENDER_FORBIDDEN_FIELDS as readonly string[]);

/** Extra volatile/internal keys that must never ride into a RenderSpec
 *  even if they slip past the structural projection (revision / billing
 *  / execution / moderation-history / scheduler identifiers). */
const VOLATILE_FORBIDDEN = new Set<string>([
  'workspace_revision', 'updated_at', 'last_editor', 'change_source',
  'override_provenance', 'synced_from_core_revision', 'uploaded_asset_ref',
  'billing_operation_id', 'execution_hash', 'idempotency_key',
  'scheduler_row', 'scheduler_eligible', 'render_envelope',
  'creator_planning_source', 'creator_workspace_meta',
  'card_id', 'task_id', 'continuity_context',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

/**
 * Recursively assert the value is render-safe + JSON-deterministic, then
 * return a frozen structural clone. Throws RenderProjectionError on the
 * first violation (fail-closed).
 */
export function sanitizeRenderProjection<T>(value: T, rootPath = '$'): T {
  const seen = new WeakSet<object>();

  const walk = (v: unknown, path: string): unknown => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'number') {
      if (!Number.isFinite(v as number)) {
        throw new RenderProjectionError(
          'UNSAFE_SERIALIZATION', `non-finite number at ${path}`, path,
        );
      }
      return v;
    }
    if (t === 'undefined') return undefined; // dropped by parent
    if (t === 'function' || t === 'symbol' || t === 'bigint') {
      throw new RenderProjectionError(
        'NON_DETERMINISTIC', `non-deterministic ${t} at ${path}`, path,
      );
    }
    if (v instanceof Date || v instanceof Map || v instanceof Set || v instanceof RegExp) {
      throw new RenderProjectionError(
        'NON_DETERMINISTIC', `non-serialization-safe ${v.constructor.name} at ${path}`, path,
      );
    }
    if (Array.isArray(v)) {
      if (seen.has(v)) throw new RenderProjectionError('NON_DETERMINISTIC', `cycle at ${path}`, path);
      seen.add(v);
      // arrays are order-preserving (semantic) — keep nulls positionally
      const out = v.map((el, i) => {
        const r = walk(el, `${path}[${i}]`);
        return r === undefined ? null : r;
      });
      seen.delete(v);
      return Object.freeze(out);
    }
    if (isPlainObject(v)) {
      if (seen.has(v)) throw new RenderProjectionError('NON_DETERMINISTIC', `cycle at ${path}`, path);
      seen.add(v);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        if (FORBIDDEN.has(key) || VOLATILE_FORBIDDEN.has(key)) {
          throw new RenderProjectionError(
            'FORBIDDEN_LEAKAGE',
            `forbidden key "${key}" reached the render projection at ${path}`,
            `${path}.${key}`,
          );
        }
        const r = walk((v as Record<string, unknown>)[key], `${path}.${key}`);
        if (r !== undefined) out[key] = r;
      }
      seen.delete(v);
      return Object.freeze(out);
    }
    // class instances / exotic objects are not serialization-safe
    throw new RenderProjectionError(
      'NON_DETERMINISTIC', `unsupported value type at ${path}`, path,
    );
  };

  return walk(value, rootPath) as T;
}

/** Pure deep-freeze (used for the final RenderSpec wrapper). */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.values(v as Record<string, unknown>).forEach((x) => deepFreeze(x));
    Object.freeze(v);
  }
  return v;
}
