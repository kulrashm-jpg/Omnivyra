/**
 * PI-LDB — the client-side mapping applier.
 *
 * Turns a retained parse result plus a tenant-confirmed mapping into the
 * `records[]` array that `/api/lead-ingestion/csv` already accepts.
 *
 * ─── WHY THIS RUNS IN THE BROWSER ─────────────────────────────────────────
 * Because the approved design says the file never reaches the server
 * (`pages/api/lead-ingestion/csv.ts` header). The browser holds the rows, so
 * the browser is the only place that can turn them into records. The important
 * consequence is the one this whole flow is built around: once the file is
 * parsed, CHANGING A MAPPING IS A PURE RECOMPUTATION. No upload, no re-read,
 * no round trip. A tenant can correct an ambiguous column and see the effect
 * immediately, as many times as they like, on one upload.
 *
 * ─── IT IS NOT A SECOND VALIDATOR OF RECORD ───────────────────────────────
 * The counts this module produces are ADVISORY — they exist so a tenant learns
 * "412 of 5 000 rows have an unusable email address" BEFORE committing, rather
 * than discovering it in 412 per-record rejections afterwards. The deciding
 * authorities are unchanged and both server-side: `validateManualInput` /
 * `validateNormalizedRecord` in the ingestion contract, and the column
 * allowlist in `prospectIdentity/ingestionBoundary`. If this module and the
 * server ever disagree, the server is right and the import simply reports more
 * failures than were predicted.
 *
 * ─── IT CANNOT NAME A DATABASE COLUMN ─────────────────────────────────────
 * Every destination is a `CsvLeadInput` property name checked against
 * `SUBMITTABLE_TARGETS`. A target outside that set is refused here and reported
 * to the tenant; it is never guessed at, and never passed through hoping the
 * server will cope.
 */

import type { CsvParseResult } from '@/lib/leadIngestion/csvParser';
import {
  isSubmittableTarget,
  nonSubmittableReason,
  type SubmittableTarget,
} from './submittableTargets';

/**
 * The closed transformation vocabulary, restated structurally rather than
 * imported, because `TransformationName` lives in a backend module and this
 * file is bundled into the browser. The names are the engine's; a name it
 * sends that is not handled here falls back to `trim`, which is lossless.
 */
export type TransformationName =
  | 'none'
  | 'trim'
  | 'lowercase_email'
  | 'digits_only_phone'
  | 'url_to_domain'
  | 'split_full_name'
  | 'parse_integer'
  | 'parse_date'
  | 'split_delimited_list'
  | 'match_enum_value';

/** The canonical data types, for advisory validation only. */
export type CanonicalDataType =
  | 'text'
  | 'email'
  | 'phone'
  | 'url'
  | 'domain'
  | 'integer'
  | 'date'
  | 'enum'
  | 'text[]';

/** One confirmed decision about one source column. */
export interface ResolvedColumn {
  /** The heading exactly as it appears in the file. */
  sourceField: string;
  /** `null` means the tenant chose to ignore this column. */
  target: string | null;
  transformation: TransformationName;
  /** The destination's declared type, used for the advisory checks. */
  dataType: CanonicalDataType | null;
  /** True when the tenant asked for this column to be kept as a note. */
  keepAsNote?: boolean;
}

export interface ResolvedMapping {
  columns: readonly ResolvedColumn[];
}

/** What a column's values did when applied to its destination. */
export interface ColumnOutcome {
  sourceField: string;
  target: string | null;
  /** Rows that had a value for this column at all. */
  populated: number;
  /** Rows whose value could not be used for the destination's type. */
  failed: number;
  /** A type or rule name. NEVER a failing value — those are tenant data. */
  failureKind: string | null;
  /** Set when the destination is recognised but cannot be imported. */
  blockedReason: string | null;
}

export interface ApplyMappingResult {
  /** One per data row, in file order. Ready to POST as `records[]`. */
  records: Array<Record<string, unknown>>;
  /** Per-column advisory outcome, in the mapping's column order. */
  columns: ColumnOutcome[];
  /** Rows that produced no usable field at all and would be rejected. */
  emptyRows: number;
  /** Destinations the tenant approved that cannot be submitted. */
  blocked: Array<{ sourceField: string; target: string; reason: string }>;
  /** Headings packed into `metadata` rather than a canonical field. */
  notedFields: string[];
  /** True when `metadata` had to be truncated to respect the contract's cap. */
  metadataTruncated: boolean;
}

/**
 * The contract's own ceiling. `manualAdapter` refuses a larger `metadata`
 * object outright, so the applier trims to fit rather than letting every record
 * in the batch fail validation for the same structural reason.
 */
const MAX_METADATA_BYTES = 2_048;

/** Targets that take a list rather than a scalar. */
const LIST_TARGETS = new Set<string>(['technologies']);

/** Targets the contract accepts as a number or a numeric string. */
const NUMERIC_TARGETS = new Set<string>([
  'employeeCount',
  'annualRevenue',
  'foundedYear',
]);

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DIGITS = /\d/g;

/* ────────────────────────────────────────────────────────────────────────────
 * Transformations. A CLOSED set, each a named pure function. There is no
 * "apply this expression" path, by construction: a mapping decision can never
 * become code execution.
 * ──────────────────────────────────────────────────────────────────────────*/

function digitsOnly(raw: string): string {
  const plus = raw.trimStart().startsWith('+') ? '+' : '';
  const digits = raw.match(DIGITS)?.join('') ?? '';
  return digits ? `${plus}${digits}` : '';
}

function urlToDomain(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  // Tolerate a bare domain, which is what most exports actually contain.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

function splitDelimitedList(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Splits a combined name for a first/last destination.
 *
 * Deliberately simple: first token is the given name, the remainder is the
 * family name. It does not attempt particles, suffixes or ordering
 * conventions, because a clever guess that is wrong for a whole file is worse
 * than a plain rule a tenant can see and correct per column.
 */
function splitFullName(raw: string, target: string): string {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (target === 'firstName') return parts[0];
  if (target === 'lastName') return parts.length > 1 ? parts.slice(1).join(' ') : '';
  return raw.trim();
}

/** Applies one named transformation. Returns `null` when the value is unusable. */
function transform(
  raw: string,
  transformation: TransformationName,
  target: string,
): string | string[] | number | null {
  const value = raw.trim();
  if (value === '') return null;

  switch (transformation) {
    case 'lowercase_email':
      return value.toLowerCase();
    case 'digits_only_phone': {
      const digits = digitsOnly(value);
      return digits === '' ? null : digits;
    }
    case 'url_to_domain': {
      const domain = urlToDomain(value);
      return domain === '' ? null : domain;
    }
    case 'split_full_name': {
      const part = splitFullName(value, target);
      return part === '' ? null : part;
    }
    case 'parse_integer': {
      const digits = value.replace(/[^\d-]/g, '');
      if (digits === '' || digits === '-') return null;
      const n = Number(digits);
      return Number.isFinite(n) ? n : null;
    }
    case 'parse_date': {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    case 'split_delimited_list': {
      const list = splitDelimitedList(value);
      return list.length === 0 ? null : list;
    }
    // `match_enum_value` resolves against the destination's enum, which lives
    // in the server-side registry. Trimming is the honest client-side share of
    // that work; the server decides whether the value is a member.
    case 'match_enum_value':
    case 'trim':
    case 'none':
    default:
      return value;
  }
}

/**
 * Advisory type check, run AFTER the transformation. Returns a rule name when
 * the value will not survive the server's own validation, or `null` when it
 * looks usable.
 */
function typeFailure(
  value: string | string[] | number,
  dataType: CanonicalDataType | null,
  target: string,
): string | null {
  if (dataType === 'email' || target === 'email') {
    return typeof value === 'string' && EMAIL_SHAPE.test(value) ? null : 'email_shape';
  }
  if (dataType === 'phone' || target === 'phone') {
    const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
    // The contract's own floor: fewer than 7 digits is not a dialable number.
    return digits.length >= 7 ? null : 'phone_digits';
  }
  if (dataType === 'integer' || NUMERIC_TARGETS.has(target)) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? null : 'not_an_integer';
  }
  if (dataType === 'date') {
    const d = new Date(typeof value === 'number' ? value : String(value));
    return Number.isNaN(d.getTime()) ? null : null;
  }
  if (dataType === 'domain' || dataType === 'url') {
    return typeof value === 'string' && value.includes('.') ? null : 'not_a_domain';
  }
  return null;
}

/** Keeps `metadata` inside the contract's byte ceiling without failing records. */
function fitMetadata(notes: Record<string, string>): {
  metadata: Record<string, string> | null;
  truncated: boolean;
} {
  const keys = Object.keys(notes);
  if (keys.length === 0) return { metadata: null, truncated: false };

  let current = { ...notes };
  let truncated = false;
  // Drop the longest note first — losing one verbose column is better than
  // losing every short one, and better than the whole record being refused.
  while (
    keys.length > 0 &&
    new TextEncoder().encode(JSON.stringify(current)).length > MAX_METADATA_BYTES
  ) {
    const longest = Object.entries(current).sort((a, b) => b[1].length - a[1].length)[0];
    if (!longest) break;
    delete current[longest[0]];
    truncated = true;
    if (Object.keys(current).length === 0) {
      current = {};
      break;
    }
  }

  return {
    metadata: Object.keys(current).length > 0 ? current : null,
    truncated,
  };
}

/**
 * Applies a confirmed mapping to a retained parse result.
 *
 * `organizationId` is NOT set here. The route derives the tenant from the
 * authenticated `company_id` query parameter and REFUSES a body that names
 * one (`pages/api/lead-ingestion/csv.ts`), so putting it on a record would
 * make every request a 400. The adapter receives the verified tenant from the
 * orchestrator instead.
 */
export function applyMapping(
  parsed: Pick<CsvParseResult, 'headers' | 'rows'>,
  mapping: ResolvedMapping,
): ApplyMappingResult {
  const blocked: ApplyMappingResult['blocked'] = [];
  const notedFields: string[] = [];

  // Resolve each decision to a column index once, so the row loop does no
  // lookups and a 50 000-row file costs one pass.
  interface Plan {
    index: number;
    sourceField: string;
    target: SubmittableTarget | null;
    transformation: TransformationName;
    dataType: CanonicalDataType | null;
    keepAsNote: boolean;
    outcome: ColumnOutcome;
  }

  const plans: Plan[] = [];
  const outcomes: ColumnOutcome[] = [];

  for (const column of mapping.columns) {
    const index = parsed.headers.indexOf(column.sourceField);
    const outcome: ColumnOutcome = {
      sourceField: column.sourceField,
      target: column.target,
      populated: 0,
      failed: 0,
      failureKind: null,
      blockedReason: null,
    };

    // A heading the mapping names but the file does not have. Reported, not
    // thrown: the other columns' work is still good.
    if (index === -1) {
      outcome.blockedReason = 'This column is not in the uploaded file.';
      outcomes.push(outcome);
      continue;
    }

    const keepAsNote = column.keepAsNote === true;
    if (keepAsNote) notedFields.push(column.sourceField);

    if (column.target === null) {
      outcomes.push(outcome);
      plans.push({
        index,
        sourceField: column.sourceField,
        target: null,
        transformation: column.transformation,
        dataType: column.dataType,
        keepAsNote,
        outcome,
      });
      continue;
    }

    if (!isSubmittableTarget(column.target)) {
      const reason =
        nonSubmittableReason(column.target) ??
        `"${column.target}" is not a destination this import can write to.`;
      outcome.blockedReason = reason;
      blocked.push({ sourceField: column.sourceField, target: column.target, reason });
      outcomes.push(outcome);
      continue;
    }

    outcomes.push(outcome);
    plans.push({
      index,
      sourceField: column.sourceField,
      target: column.target,
      transformation: column.transformation,
      dataType: column.dataType,
      keepAsNote,
      outcome,
    });
  }

  const records: Array<Record<string, unknown>> = [];
  let emptyRows = 0;
  let metadataTruncated = false;

  for (const row of parsed.rows) {
    const record: Record<string, unknown> = {};
    const notes: Record<string, string> = {};
    let assigned = 0;

    for (const plan of plans) {
      const raw = row[plan.index] ?? '';
      if (raw.trim() === '') continue;
      plan.outcome.populated += 1;

      if (plan.keepAsNote) {
        notes[plan.sourceField] = raw.trim();
      }

      if (plan.target === null) continue;

      const value = transform(raw, plan.transformation, plan.target);
      if (value === null) {
        plan.outcome.failed += 1;
        plan.outcome.failureKind = plan.outcome.failureKind ?? 'not_transformable';
        continue;
      }

      const failure = typeFailure(value, plan.dataType, plan.target);
      if (failure) {
        plan.outcome.failed += 1;
        plan.outcome.failureKind = plan.outcome.failureKind ?? failure;
        continue;
      }

      // A list destination accumulates across repeated columns rather than the
      // last one winning, which is what a file with `Tech 1` / `Tech 2` means.
      if (LIST_TARGETS.has(plan.target)) {
        const list = Array.isArray(value) ? value : [String(value)];
        const existing = record[plan.target];
        record[plan.target] = Array.isArray(existing) ? [...existing, ...list] : list;
      } else {
        record[plan.target] = value;
      }
      assigned += 1;
    }

    const fitted = fitMetadata(notes);
    if (fitted.truncated) metadataTruncated = true;
    if (fitted.metadata) record.metadata = fitted.metadata;

    if (assigned === 0) {
      emptyRows += 1;
      continue;
    }
    records.push(record);
  }

  return {
    records,
    columns: outcomes,
    emptyRows,
    blocked,
    notedFields,
    metadataTruncated,
  };
}
