/**
 * User-Friendly Error Service
 *
 * Reads error mappings from user_friendly_error_mappings table.
 * Cached in memory; falls back to built-in defaults if DB fails.
 */

import { supabase } from '../db/supabaseClient';

export type ErrorContext =
  | 'login'
  | 'company'
  | 'campaign'
  | 'strategic_themes'
  | 'recommendations'
  | 'publish'
  | 'external_api'
  | 'generic';

type DbRow = {
  match_type: string;
  match_value: string | null;
  context: string;
  user_message: string;
  suggest_retry: boolean;
  guidance: string | null;
  priority: number;
};

let cache: DbRow[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

async function loadMappings(): Promise<DbRow[]> {
  if (cache && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cache;
  }
  try {
    const { data, error } = await supabase
      .from('user_friendly_error_mappings')
      .select('match_type, match_value, context, user_message, suggest_retry, guidance, priority')
      .eq('is_active', true)
      .order('priority', { ascending: true });
    if (error) throw error;
    cache = (data ?? []) as DbRow[];
    cacheTimestamp = Date.now();
    return cache;
  } catch {
    return [];
  }
}

/** Clear cache (e.g. after admin updates mappings) */
export function clearUserFriendlyErrorCache(): void {
  cache = null;
}

/**
 * Find a matching row for the given error and context.
 * Tries pattern matches first (code, contains, regex); falls back to context fallback.
 */
export async function resolveUserFriendlyMessage(
  err: unknown,
  context: ErrorContext
): Promise<{ message: string; suggestRetry: boolean } | null> {
  const rows = await loadMappings();
  let errMsg = String((err as Error)?.message ?? err ?? '').toLowerCase();
  const errCode = (err as NodeJS.ErrnoException)?.code ?? '';

  if (err instanceof AggregateError && (err as AggregateError).errors?.length > 0) {
    const first = (err as AggregateError).errors[0];
    errMsg = String((first as Error)?.message ?? first ?? errMsg);
  }

  let fallbackRow: DbRow | null = null;

  for (const row of rows) {
    if (row.match_type === 'fallback') {
      if (row.match_value === context) fallbackRow = row;
      continue;
    }

    if (row.context !== context && row.context !== 'generic') continue;

    let matches = false;
    if (row.match_type === 'code') {
      matches = errCode === (row.match_value ?? '').toUpperCase();
    } else if (row.match_type === 'contains') {
      const needle = (row.match_value ?? '').toLowerCase();
      matches = !!needle && errMsg.includes(needle);
    } else if (row.match_type === 'regex') {
      try {
        const re = new RegExp(row.match_value ?? '', 'i');
        matches = re.test(errMsg) || re.test(errCode);
      } catch {
        matches = false;
      }
    }

    if (matches) {
      const guidance = row.guidance?.trim();
      const message = guidance ? `${row.user_message} ${guidance}` : row.user_message;
      return { message, suggestRetry: row.suggest_retry };
    }
  }

  if (fallbackRow) {
    const guidance = fallbackRow.guidance?.trim();
    const message = guidance
      ? `${fallbackRow.user_message} ${guidance}`
      : fallbackRow.user_message;
    return { message, suggestRetry: fallbackRow.suggest_retry };
  }

  return null;
}
