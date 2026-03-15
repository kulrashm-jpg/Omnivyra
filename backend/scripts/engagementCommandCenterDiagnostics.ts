/**
 * Engagement Command Center – Backend Diagnostic Script
 *
 * Invokes getThreads directly to capture the REAL backend error.
 * Run: npx ts-node -r dotenv/config backend/scripts/engagementCommandCenterDiagnostics.ts
 * Or:  node --loader ts-node/esm backend/scripts/engagementCommandCenterDiagnostics.ts
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { supabase } from '../db/supabaseClient';
import { getThreads } from '../services/engagementThreadService';

async function run(): Promise<void> {
  console.log('=== Engagement Command Center Backend Diagnostics ===\n');

  // 1. Get a company_id for testing
  const { data: companies, error: companiesErr } = await supabase
    .from('companies')
    .select('id, name')
    .limit(5);

  if (companiesErr) {
    console.error('FAIL: companies table access failed');
    console.error('Error:', JSON.stringify(companiesErr, null, 2));
    process.exit(1);
  }

  const companyId = companies?.[0]?.id;
  if (!companyId) {
    console.log('SKIP: No companies found in DB. Create a company first.');
    process.exit(0);
  }

  console.log(`Using company_id: ${companyId} (${companies?.[0]?.name || 'N/A'})\n`);

  // 2. Invoke getThreads (same path as API route)
  console.log('Invoking getThreads({ organization_id, limit, exclude_ignored })...\n');
  try {
    const threads = await getThreads({
      organization_id: companyId,
      limit: 10,
      exclude_ignored: true,
    });
    console.log('SUCCESS: getThreads returned without throwing');
    console.log('threads count:', Array.isArray(threads) ? threads.length : 'N/A');
  } catch (err: unknown) {
    console.error('FAIL: getThreads threw');
    console.error('Error type:', err instanceof Error ? err.constructor.name : typeof err);
    console.error('Message:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      console.error('Stack:\n', err.stack);
    }
    process.exit(1);
  }

  console.log('\n=== Diagnostics complete ===');
}

run();
