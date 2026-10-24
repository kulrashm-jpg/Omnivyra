/**
 * Closure-009 — validate caller-supplied `manual_results` for
 * POST /api/super-admin/serp-acquisition against the established contract
 * (SerpProviderResult → SerpResultInput), BEFORE anything is acquired or
 * written. Rows that pass are returned exactly as supplied: this validates the
 * accepted data model, it does not reshape it.
 *
 * The route previously cast the body straight to SerpProviderResult[] and wrote
 * whatever arrived as SERP observations.
 */
import { SERP_RESULT_TYPES } from './serpResultTypes';
import type { SerpProviderResult } from '../serpAcquisitionService';

/** Upper bounds on one import. A run consumes at most maxQueriesAllowed() queries anyway. */
export const MANUAL_SERP_MAX_QUERIES = 100;
export const MANUAL_SERP_MAX_RESULTS_PER_QUERY = 100;
const MAX_QUERY_LENGTH = 512;
const MAX_URL_LENGTH = 2048;
const MAX_DOMAIN_LENGTH = 253;
const MAX_TEXT_LENGTH = 4000;

export type ManualSerpValidation =
  | { ok: true; rows: SerpProviderResult[] }
  | { ok: false; error: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const optionalText = (v: unknown, max: number) =>
  v === undefined || v === null || (typeof v === 'string' && v.length <= max);

function resultRowError(row: unknown, at: string): string | null {
  if (!isPlainObject(row)) return `${at} must be an object`;
  const { position, url, domain } = row;
  if (!(position === null || (typeof position === 'number' && Number.isInteger(position) && position > 0))) {
    return `${at}.position must be a positive integer or null`;
  }
  if (url !== null) {
    if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) return `${at}.url must be an http(s) URL or null`;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return `${at}.url must be an http(s) URL or null`; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `${at}.url must be an http(s) URL or null`;
  }
  if (!(domain === null || (typeof domain === 'string' && domain.trim().length > 0 && domain.length <= MAX_DOMAIN_LENGTH))) {
    return `${at}.domain must be a non-empty string or null`;
  }
  if (!optionalText(row.title, MAX_TEXT_LENGTH)) return `${at}.title must be a string or null`;
  if (!optionalText(row.snippet, MAX_TEXT_LENGTH)) return `${at}.snippet must be a string or null`;
  if (row.result_type !== undefined && !(SERP_RESULT_TYPES as readonly unknown[]).includes(row.result_type)) {
    return `${at}.result_type is not a known SERP result type`;
  }
  if (row.feature_metadata !== undefined && !isPlainObject(row.feature_metadata)) return `${at}.feature_metadata must be an object`;
  return null;
}

/**
 * `undefined` / absent → no manual import (ok, zero rows). Anything else must
 * be a non-empty array of valid SerpProviderResult rows.
 */
export function validateManualSerpResults(input: unknown): ManualSerpValidation {
  if (input === undefined || input === null) return { ok: true, rows: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'manual_results must be an array' };
  if (input.length === 0) return { ok: true, rows: [] };
  if (input.length > MANUAL_SERP_MAX_QUERIES) return { ok: false, error: `manual_results may hold at most ${MANUAL_SERP_MAX_QUERIES} queries` };
  for (let i = 0; i < input.length; i += 1) {
    const at = `manual_results[${i}]`;
    const entry = input[i];
    if (!isPlainObject(entry)) return { ok: false, error: `${at} must be an object` };
    if (typeof entry.query !== 'string' || entry.query.trim().length === 0 || entry.query.length > MAX_QUERY_LENGTH) {
      return { ok: false, error: `${at}.query must be a non-empty string` };
    }
    if (!optionalText(entry.geography, 64)) return { ok: false, error: `${at}.geography must be a string or null` };
    if (!optionalText(entry.device, 32)) return { ok: false, error: `${at}.device must be a string or null` };
    if (entry.provider_metadata !== undefined && !isPlainObject(entry.provider_metadata)) {
      return { ok: false, error: `${at}.provider_metadata must be an object` };
    }
    if (!Array.isArray(entry.results)) return { ok: false, error: `${at}.results must be an array` };
    if (entry.results.length > MANUAL_SERP_MAX_RESULTS_PER_QUERY) {
      return { ok: false, error: `${at}.results may hold at most ${MANUAL_SERP_MAX_RESULTS_PER_QUERY} rows` };
    }
    for (let j = 0; j < entry.results.length; j += 1) {
      const rowError = resultRowError(entry.results[j], `${at}.results[${j}]`);
      if (rowError) return { ok: false, error: rowError };
    }
  }
  return { ok: true, rows: input as SerpProviderResult[] };
}
