import { createServiceRoleMigrationProxy } from '../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

async function main() {
  const { data, error } = await supabase
    .from('ingestion_runs').select('*')
    .eq('id', '653b9982-547e-4587-be22-7922ece95fc7').single();
  console.log('error:', error);
  console.log('row:', JSON.stringify(data, null, 2));
}
main().catch(console.error);
