/**
 * PI-LDB: the ONE validation of a mapping-approval request body, shared by the
 * tenant route (/api/lead-ingestion/mapping-approval) and the Super Admin
 * platform route (/api/super-admin/mapping-profiles). Extracted unchanged from
 * the tenant route in step E (2026-11-11) so the two cannot drift; each route
 * passes the sources and mapping methods its caller may use.
 *
 * Every destination is checked twice: `isCanonicalFieldKey` (does the registry
 * know it?) and `isSubmittableTarget` (can the ingestion contract carry it?).
 * The store re-validates everything; this layer exists so the caller gets a
 * clear 4xx with a machine-readable code instead of a constraint name.
 */
import { isCanonicalFieldKey } from './canonicalFieldRegistry';
import { isSubmittableTarget } from '../../../lib/prospects/import/submittableTargets';
import type { SaveProfileEntry } from './mappingProfileStore';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const FINGERPRINT = /^[a-f0-9]{64}$/;
export const MAX_MAPPING_HEADERS = 200;

/** The decisions the profile-entry table accepts. */
const DECISIONS = new Set(['approved', 'rejected', 'ignored']);

/** The closed transformation vocabulary the engine may propose. */
const TRANSFORMATIONS = new Set([
  'none',
  'trim',
  'lowercase_email',
  'digits_only_phone',
  'url_to_domain',
  'split_full_name',
  'parse_integer',
  'parse_date',
  'split_delimited_list',
  'match_enum_value',
]);

export interface ValidatedApproval {
  source: string;
  schemaFingerprint: string;
  headers: string[];
  entries: SaveProfileEntry[];
}

export type ApprovalValidation =
  | { ok: true; value: ValidatedApproval }
  | { ok: false; status: 400 | 413; body: { error: string; code?: string } };

export interface ApprovalRules {
  /** Accept this source? (`source` is already trimmed and non-empty-checked by the rule.) */
  sourceAllowed: (source: string) => boolean;
  /** The message when the source is refused. */
  sourceMessage: string;
  /** The mapping methods this caller may use. */
  methods: ReadonlySet<string>;
}

const fail = (status: 400 | 413, error: string, code?: string): ApprovalValidation =>
  ({ ok: false, status, body: code ? { error, code } : { error } });

export function validateMappingApprovalBody(body: Record<string, unknown>, rules: ApprovalRules): ApprovalValidation {
  const source = typeof body.source === 'string' ? body.source.trim() : '';
  if (!source || !rules.sourceAllowed(source)) return fail(400, rules.sourceMessage);

  const schemaFingerprint =
    typeof body.schemaFingerprint === 'string' ? body.schemaFingerprint.trim() : '';
  if (!FINGERPRINT.test(schemaFingerprint)) {
    return fail(400, 'schemaFingerprint must be a 64-character hex digest');
  }

  if (!Array.isArray(body.headers) || body.headers.length === 0) {
    return fail(400, 'headers must be a non-empty array');
  }
  if (body.headers.length > MAX_MAPPING_HEADERS) {
    return fail(413, `headers exceeds the ${MAX_MAPPING_HEADERS} column limit`);
  }
  if (!body.headers.every((h) => typeof h === 'string' && h.trim() !== '')) {
    return fail(400, 'every header must be a non-empty string');
  }
  const headers = body.headers as string[];

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return fail(400, 'entries must be a non-empty array');
  }
  if (body.entries.length > MAX_MAPPING_HEADERS) {
    return fail(413, `entries exceeds the ${MAX_MAPPING_HEADERS} column limit`);
  }

  const knownHeaders = new Set(headers);
  const seen = new Set<string>();
  const entries: SaveProfileEntry[] = [];

  for (const raw of body.entries) {
    if (!isRecord(raw)) return fail(400, 'every entry must be an object');

    const sourceField = typeof raw.sourceField === 'string' ? raw.sourceField : '';
    if (!knownHeaders.has(sourceField)) {
      return fail(400, 'every entry.sourceField must be one of the submitted headers', 'UNKNOWN_SOURCE_FIELD');
    }
    // One decision per column. Two entries for one heading is a client bug, and
    // the table's unique indexes would refuse it anyway - better a clear 400.
    if (seen.has(sourceField)) {
      return fail(400, `entries contains more than one decision for '${sourceField}'`, 'DUPLICATE_ENTRY');
    }
    seen.add(sourceField);

    const decision = typeof raw.decision === 'string' ? raw.decision : '';
    if (!DECISIONS.has(decision)) {
      return fail(400, `entry.decision must be one of: ${[...DECISIONS].join(', ')}`);
    }

    const mappingMethod = typeof raw.mappingMethod === 'string' ? raw.mappingMethod : '';
    if (!rules.methods.has(mappingMethod)) {
      return fail(400, `entry.mappingMethod must be one of: ${[...rules.methods].join(', ')}`);
    }

    const transformation = typeof raw.transformation === 'string' ? raw.transformation : 'none';
    if (!TRANSFORMATIONS.has(transformation)) {
      return fail(400, 'entry.transformation is not a recognised transformation', 'UNKNOWN_TRANSFORMATION');
    }

    // THE BOUNDARY THAT MATTERS: `target: null` is a legitimate decision (an
    // approved IGNORE). Anything else must be a destination the registry knows
    // AND the ingestion contract can carry.
    const target = raw.target === null || raw.target === undefined ? null : raw.target;
    if (target !== null) {
      if (typeof target !== 'string' || !isCanonicalFieldKey(target)) {
        return fail(400, 'entry.target is not a canonical destination', 'UNKNOWN_TARGET');
      }
      if (!isSubmittableTarget(target)) {
        return fail(400, `'${target}' is a recognised destination but imports cannot write to it yet`, 'TARGET_NOT_SUBMITTABLE');
      }
    }

    // An ignore decision must not carry a destination, and an approval must.
    if (decision === 'ignored' && target !== null) {
      return fail(400, "an 'ignored' decision cannot name a target", 'INCONSISTENT_DECISION');
    }
    if (decision === 'approved' && target === null) {
      return fail(400, "an 'approved' decision must name a target — use 'ignored' to skip a column", 'INCONSISTENT_DECISION');
    }

    entries.push({
      sourceField,
      target,
      transformation,
      decision,
      mappingMethod,
    } as unknown as SaveProfileEntry);
  }

  return { ok: true, value: { source, schemaFingerprint, headers, entries } };
}
