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

/**
 * Built-in category-keyed mappings for BOLT failures.
 *
 * Without these, every classified BOLT failure that doesn't have a
 * specific contains/regex row in user_friendly_error_mappings collapses
 * to the generic "Your campaign plan was disrupted due to a technical
 * glitch" fallback in BUILTIN_FALLBACKS.campaign. With these, an
 * operator-classified UNSUPPORTED_FORMAT / PROVIDER_TIMEOUT / etc.
 * gets a category-specific message instead — see Part 4 of the BOLT
 * failure-observability spec.
 *
 * These do NOT replace the DB-driven mappings. The resolver tries
 * DB rows first; this map only fires when the DB lookup didn't
 * match anything specific AND the catch path supplied a category
 * hint. Operators can still override any of these via the database
 * by adding a higher-priority `contains` row for the same phrase.
 */
const BOLT_CATEGORY_FRIENDLY_MAP: Record<string, { message: string; suggestRetry: boolean }> = {
  UNSUPPORTED_FORMAT: {
    message:
      'One of the selected content formats isn\'t supported for this campaign. Remove the unsupported format from your strategy and try again.',
    suggestRetry: false,
  },
  PROVIDER_TIMEOUT: {
    message:
      'Generation timed out while waiting on the AI provider. Please try again in a minute — this usually resolves on retry.',
    suggestRetry: true,
  },
  PROVIDER_RATE_LIMIT: {
    message:
      'The AI provider is temporarily rate-limited. Please wait a minute and try again.',
    suggestRetry: true,
  },
  PLAN_PARSE_FAILURE: {
    message:
      'The campaign plan came back in an unexpected shape and couldn\'t be saved. Please try again.',
    suggestRetry: true,
  },
  BLUEPRINT_FAILURE: {
    message:
      'We couldn\'t save the campaign blueprint. Please try again. If the problem persists, contact support.',
    suggestRetry: true,
  },
  DAILY_PLAN_FAILURE: {
    message:
      'We couldn\'t generate the daily plan for one or more weeks. Please try again.',
    suggestRetry: true,
  },
  SCHEDULING_FAILURE: {
    message:
      'We couldn\'t schedule the generated content. Please try again. If the problem persists, contact support.',
    suggestRetry: true,
  },
  SUPABASE_ERROR: {
    message:
      'A database error interrupted your campaign plan. Please try again. If the problem persists, contact support.',
    suggestRetry: true,
  },
  VALIDATION_ERROR: {
    message:
      'Some of the inputs for this campaign didn\'t pass validation. Please review the strategy and try again.',
    suggestRetry: false,
  },
};

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

/** Optional context hint the BOLT pipeline supplies so the resolver
 *  can pick a category-specific built-in message when no DB row matches. */
export interface ResolveOptions {
  /** Operator-facing failure category from classifyBoltFailure. */
  boltCategory?: string;
}

/**
 * Find a matching row for the given error and context.
 * Tries pattern matches first (code, contains, regex); falls back to context fallback.
 */
export async function resolveUserFriendlyMessage(
  err: unknown,
  context: ErrorContext,
  options?: ResolveOptions
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

  // Category-specific built-in mapping. Inserted BEFORE the context
  // fallback so an UNSUPPORTED_FORMAT failure never collapses to the
  // generic "technical glitch" message. Operators can still override
  // this by adding a contains/regex row at a higher priority in DB.
  const category = options?.boltCategory;
  if (category && BOLT_CATEGORY_FRIENDLY_MAP[category]) {
    return BOLT_CATEGORY_FRIENDLY_MAP[category];
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
