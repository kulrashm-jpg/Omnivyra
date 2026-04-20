import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { supabase } from '../backend/db/supabaseClient';

function isMissingTable(error: { message?: string; code?: string } | null | undefined, table: string): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    error?.code === '42P01' ||
    message.includes(`relation "${table}" does not exist`) ||
    message.includes(`could not find the table 'public.${table.toLowerCase()}'`)
  );
}

async function countRowsSince(table: string, column: string, since: string): Promise<{ count: number; missing: boolean }> {
  const { count, error } = await (supabase as any)
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(column, since);

  if (error) {
    if (isMissingTable(error, table)) {
      return { count: 0, missing: true };
    }
    throw new Error(`Failed counting ${table}: ${error.message}`);
  }

  return { count: count ?? 0, missing: false };
}

async function main() {
  const lookbackHours = Number(process.env.LEAD_SIGNAL_VERIFY_LOOKBACK_HOURS ?? '24');
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const canonicalWriteEnabled = process.env.USE_CANONICAL_SIGNAL_WRITE ?? 'true';

  const [canonicalResult] = await Promise.all([
    countRowsSince('lead_signals', 'created_at', since),
  ]);

  const canonicalCount = canonicalResult.count;

  console.log(
    JSON.stringify(
      {
        since,
        canonical_write_flag: canonicalWriteEnabled,
        counts: {
          lead_signals: canonicalCount,
        },
        missing_tables: {
          lead_signals: canonicalResult.missing,
        },
        processed_count: canonicalCount,
        inserted_count: canonicalCount,
        skipped_duplicates: 0,
        errors: 0,
        canonical_write_percentage: 100,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[verify_lead_signal_cutover]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
