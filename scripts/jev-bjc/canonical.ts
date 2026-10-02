/**
 * BJC canonical serialization + input hash (spec §2.6).
 *
 * Canonical form: object keys sorted (by UTF-16 code units, as RFC 8785/JCS),
 * arrays order-preserving, `undefined` dropped, non-finite numbers rejected.
 * For the value domain the contract admits (strings, finite numbers, booleans,
 * null, arrays, plain objects) this is byte-identical to JCS, because JCS
 * number/string serialization is ECMAScript JSON serialization.
 *
 * Deliberately not reusing creator/rendering/contracts/deterministicHash: that
 * helper strips render-domain volatile keys, which would silently change what
 * a BJC hash covers.
 */
import { createHash } from 'node:crypto';
import { CONTRACT_VERSION, QUESTIONS_VERSION, type BjcRequest } from './contract';

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : canonicalize(v)));
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonical JSON: non-finite number');
      return value;
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as object).sort()) {
        const v = (value as Record<string, unknown>)[key];
        if (v !== undefined) out[key] = canonicalize(v);
      }
      return out;
    }
    default:
      throw new Error(`canonical JSON: unsupported type ${typeof value}`);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The judgment-relevant projection of a request. Identifiers that do not
 * change what is being judged (request_id, task_id, invoked_by) and the hash
 * itself are excluded, so re-asking the same question yields the same hash.
 * The contract and question-template versions are included: changing either
 * changes what JEV is asked.
 */
export function inputHashProjection(req: Omit<BjcRequest, 'input_hash'> | BjcRequest): Record<string, unknown> {
  return {
    contract: CONTRACT_VERSION,
    questions_version: QUESTIONS_VERSION,
    work_item: req.work_item,
    acceptance_criterion: req.acceptance_criterion,
    invariants: req.invariants,
    deterministic_summary: req.deterministic_summary,
    evidence: req.evidence,
    model: req.model,
  };
}

/** `sha256:<hex>` over the canonical projection. Callers use this to fill `input_hash`. */
export function computeInputHash(req: Omit<BjcRequest, 'input_hash'> | BjcRequest): string {
  return `sha256:${sha256Hex(canonicalJson(inputHashProjection(req)))}`;
}
