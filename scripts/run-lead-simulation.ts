/**
 * Run one Active Leads REACTIVE mode simulation.
 *
 * Preferred: Use the UI (Recommendations → Lead tab) with a company selected:
 * 1. Select platform (e.g. Reddit)
 * 2. Enter region (e.g. US)
 * 3. Click "Run Social Listening"
 *
 * Or call the dev-only API (when NODE_ENV=development):
 *   curl http://localhost:3000/api/leads/simulate
 *
 * Standalone script (requires ts-node + env):
 *   node -r ts-node/register scripts/run-lead-simulation.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabase } from '../backend/db/supabaseClient';
import { processLeadJobV1 } from '../backend/services/leadJobProcessor';
import { getTopClusters } from '../backend/services/leadClusterService';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('--- Active Leads REACTIVE Simulation ---\n');

  // 1) Get a company_id
  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  let companyId: string;
  if (roleRow?.company_id) {
    companyId = roleRow.company_id;
    console.log(`Using company from user_company_roles: ${companyId}`);
  } else {
    const { data: jobRow } = await supabase
      .from('lead_jobs_v1')
      .select('company_id')
      .limit(1)
      .maybeSingle();
    if (jobRow?.company_id) {
      companyId = jobRow.company_id;
      console.log(`Using company from existing lead_jobs: ${companyId}`);
    } else {
      console.error('No company_id found. Ensure user_company_roles or lead_jobs_v1 has data.');
      process.exit(1);
    }
  }

  // 2) Create job
  const { data: job, error: insertErr } = await supabase
    .from('lead_jobs_v1')
    .insert({
      company_id: companyId,
      platforms: ['reddit'],
      regions: ['US'],
      keywords: ['service'],
      mode: 'REACTIVE',
      status: 'PENDING',
      total_found: 0,
      total_qualified: 0,
    })
    .select('id, status')
    .single();

  if (insertErr || !job) {
    console.error('Failed to create job:', insertErr?.message || 'Unknown');
    process.exit(1);
  }

  console.log(`Created job: ${job.id}\n`);

  // 3) Run processor
  await processLeadJobV1(job.id);

  // 4) Poll for completion (max 30s)
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const { data: updated } = await supabase
      .from('lead_jobs_v1')
      .select('status, total_found, total_qualified, confidence_index, error')
      .eq('id', job.id)
      .single();

    if (!updated) continue;
    console.log(`  [${i * 2}s] status=${updated.status} found=${updated.total_found} qualified=${updated.total_qualified}`);

    if (updated.status === 'COMPLETED' || updated.status === 'COMPLETED_WITH_WARNINGS' || updated.status === 'FAILED') {
      console.log('\n--- Result ---');
      console.log(JSON.stringify({ status: updated.status, total_found: updated.total_found, total_qualified: updated.total_qualified, confidence_index: updated.confidence_index, error: updated.error }, null, 2));

      if (updated.status === 'FAILED' && updated.error) {
        console.log('\nError:', updated.error);
      }

      // 5) Fetch leads (like the API)
      const { data: leads } = await supabase
        .from('lead_signals_v1')
        .select('id, platform, region, snippet, source_url, author_handle, icp_score, urgency_score, intent_score, total_score, problem_domain')
        .eq('job_id', job.id)
        .limit(10);

      if (leads && leads.length > 0) {
        console.log('\n--- Top Leads (up to 10) ---');
        leads.forEach((l, i) => {
          console.log(`\n${i + 1}. [${l.platform}] ${(l.snippet || '').slice(0, 80)}...`);
          console.log(`   Scores: ICP=${((l.icp_score ?? 0) * 100).toFixed(0)}% intent=${((l.intent_score ?? 0) * 100).toFixed(0)}% urgency=${((l.urgency_score ?? 0) * 100).toFixed(0)}% total=${((l.total_score ?? 0) * 100).toFixed(0)}%`);
          console.log(`   Domain: ${l.problem_domain ?? '—'}`);
        });
      }

      // 6) Clusters
      const clusters = await getTopClusters(companyId);
      if (clusters.length > 0) {
        console.log('\n--- Emerging Clusters ---');
        clusters.forEach((c, i) => {
          console.log(`${i + 1}. ${c.problem_domain} | signals=${c.signal_count} priority=${((c.priority_score ?? 0) * 100).toFixed(0)}%`);
        });
      }

      process.exit(0);
    }
  }

  console.log('\nTimed out waiting for job completion.');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
