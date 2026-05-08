import { supabase } from './supabaseClient';

export function ownedDbTable(table: string) {
  return supabase.from(table);
}
