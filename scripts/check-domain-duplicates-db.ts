import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: '.env.local' });
dotenv.config();

const connectionString = process.env.SUPABASE_DB_URL || process.env.SUPABASE_POOLER_DB_URL;

if (!connectionString) {
  console.error('[check-domain-duplicates-db] FAIL - SUPABASE_DB_URL or SUPABASE_POOLER_DB_URL is required');
  process.exit(2);
}

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const result = await client.query<{
      final_domain: string;
      count: string;
    }>(`
      SELECT final_domain, COUNT(*)::text AS count
      FROM company_domains
      GROUP BY final_domain
      HAVING COUNT(*) > 1
    `);

    if (result.rows.length > 0) {
      console.error(`[check-domain-duplicates-db] FAIL - ${result.rows.length} duplicate domain(s) found`);
      for (const row of result.rows) {
        console.error(`  ${row.final_domain}: ${row.count}`);
      }
      process.exit(1);
    }

    console.log('[check-domain-duplicates-db] OK - no duplicate final_domain rows.');
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`[check-domain-duplicates-db] FAIL - ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
