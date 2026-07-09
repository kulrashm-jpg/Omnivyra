import { supabase } from './supabaseClient';
import { observeTable } from '../observability/dbObservability';

export function ownedDbTable(table: string) {
  // HARDEN-001: transparent, fail-safe timing proxy. observeTable returns the
  // raw builder unchanged when observability is disabled/unsampled or if the
  // proxy would misbehave — queries, filters, and results are identical.
  return observeTable(table, supabase.from(table));
}
