/**
 * Stable, deterministic lead key for deep-linking a unified-list row to its profile.
 *
 * Mirrors `dedupeViews` identity exactly so a row in the list resolves 1:1 to the
 * same view server-side — no DB id is required (the unified set is mostly legacy-
 * bridged and carries no durable row id). Pure; safe in both the browser (href) and
 * the server (profile resolution). The `::` delimiter never collides: sources are a
 * lowercase enum, table names are snake_case, ids are UUID/numeric, and ISO
 * timestamps contain only single `:`.
 */

import type { CanonicalLeadView } from './types';

const DELIM = '::';
const lc = (v: unknown): string => String(v ?? '').toLowerCase();

export function leadKeyFor(
  v: Pick<CanonicalLeadView, 'source' | 'sourceRef' | 'unifiedPersonId' | 'identity' | 'occurredAt'>,
): string {
  if (v.sourceRef?.id) return ['id', v.source, v.sourceRef.table, v.sourceRef.id].join(DELIM);
  const ident = v.unifiedPersonId ?? v.identity?.email ?? v.identity?.contactId ?? '';
  return ['up', v.source, lc(ident), v.occurredAt ?? ''].join(DELIM);
}
