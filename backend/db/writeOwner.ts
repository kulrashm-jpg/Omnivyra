import { supabase } from './supabaseClient';
import { observeTable } from '../observability/dbObservability';

export function ownedDbTable(table: string) {
  // HARDEN-001: transparent, fail-safe timing proxy. observeTable returns the
  // raw builder unchanged when observability is disabled/unsampled or if the
  // proxy would misbehave — queries, filters, and results are identical.
  return observeTable(table, supabase.from(table));
}

/**
 * The same owned seam, for a database FUNCTION rather than a table.
 *
 * Some writes have to be atomic across several tables, and PostgREST offers no
 * transaction control: every `ownedDbTable` call is its own committed statement.
 * A plpgsql function invoked as a single statement is a single transaction, so
 * an invariant that must hold at every committed instant across more than one
 * table is expressed as a function and called through here.
 *
 * It lives beside `ownedDbTable` deliberately. Both are THE write seam, and a
 * test that doubles one usually has to double the other.
 */
export function ownedDbRpc(fn: string, args: Record<string, unknown>) {
  return supabase.rpc(fn, args);
}
