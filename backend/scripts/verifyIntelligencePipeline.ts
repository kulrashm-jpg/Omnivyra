/**
 * Verify Intelligence Pipeline — End-to-end check
 * Run: npx ts-node backend/scripts/verifyIntelligencePipeline.ts
 * Or: npm run script:verify-intelligence
 *
 * Requires: COMPANY_ID env or pass as arg. Uses first company if none provided.
 */

import { supabase } from '../db/supabaseClient';
import { runIntelligenceCycle } from '../services/intelligenceCoreEngine';

const REQUIRED_TABLES = [
  'companies',
  'intelligence_signals',
  'signal_clusters',
  'company_intelligence_signals',
  'intelligence_recommendations',
  'intelligence_outcomes',
  'recommendation_feedback',
  'company_strategic_themes',
  'strategic_memory',
  'intelligence_optimization_metrics',
  'intelligence_simulation_runs',
  'intelligence_execution_metrics',
  'intelligence_execution_logs',
  'company_execution_priority',
];

async function checkTables(): Promise<{ missing: string[]; ok: string[] }> {
  const missing: string[] = [];
  const ok: string[] = [];
  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase.from(table).select('id').limit(1);
    if (error && (error.code === '42P01' || /does not exist|relation.*does not exist/i.test(error.message))) {
      missing.push(table);
    } else {
      ok.push(table);
    }
  }
  return { missing, ok };
}

async function getFirstCompanyId(): Promise<string | null> {
  const { data } = await supabase.from('companies').select('id').limit(1).maybeSingle();
  return data?.id ?? null;
}

async function main() {
  const companyId = process.env.COMPANY_ID ?? process.argv[2] ?? null;

  console.log('=== Intelligence Pipeline Verification ===\n');

  const { missing, ok } = await checkTables();
  if (missing.length > 0) {
    console.log('Missing tables:', missing.join(', '));
    console.log('Run migrations first. See docs/INTELLIGENCE-MIGRATION-ORDER.md');
  }
  console.log('Tables OK:', ok.length, '/', REQUIRED_TABLES.length);

  const cid = companyId ?? (await getFirstCompanyId());
  if (!cid) {
    console.log('\nNo company found. Create companies or set COMPANY_ID env.');
    process.exit(1);
  }
  console.log('\nUsing company:', cid);

  console.log('\nRunning intelligence cycle (analysis, strategy, learning)...');
  const start = Date.now();
  try {
    const result = await runIntelligenceCycle({
      companyId: cid,
      runIngestion: false,
      runAnalysis: true,
      runStrategy: true,
      runLearning: true,
      runOptimization: false,
      runSimulation: false,
    });

    const duration = Date.now() - start;
    console.log('\nCycle completed in', duration, 'ms');

    if (result.cycle_skipped) {
      console.log('Cycle skipped:', result.cycle_skipped);
      process.exit(0);
    }

    console.log('Analysis:', result.analysis ? 'OK' : 'skipped/failed');
    console.log('Strategy:', result.strategy ? 'OK' : 'skipped/failed');
    if (result.strategy) {
      console.log('  - Opportunities:', result.strategy.opportunities?.length ?? 0);
      console.log('  - Recommendations:', result.strategy.recommendations?.length ?? 0);
    }
    console.log('Learning:', result.learning ? 'OK' : 'skipped/failed');

    console.log('\n=== Verification Complete ===');
    process.exit(0);
  } catch (err) {
    console.error('Cycle failed:', (err as Error)?.message);
    process.exit(1);
  }
}

main();
