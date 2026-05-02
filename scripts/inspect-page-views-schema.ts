import { supabase } from '../backend/db/supabaseClient';

async function main() {
  const { data, error } = await supabase.rpc('exec_sql_admin', {
    sql: `
      SELECT
        i.indexname,
        i.indexdef,
        idx.indisunique AS is_unique
      FROM pg_indexes i
      JOIN pg_class c ON c.relname = i.indexname
      JOIN pg_index idx ON idx.indexrelid = c.oid
      WHERE i.tablename = 'canonical_page_views'
      ORDER BY idx.indisunique DESC, i.indexname;
    `,
  }).single();
  if (error) {
    // fallback: just read the table info via supabase
    console.log('RPC unavailable, falling back to information_schema query');
    const { data: cons } = await supabase
      .schema('information_schema' as any)
      .from('table_constraints')
      .select('*')
      .eq('table_name', 'canonical_page_views');
    console.log(cons);
    return;
  }
  console.log(data);
}

main().catch(console.error);
