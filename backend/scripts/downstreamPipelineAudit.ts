/**
 * Downstream Pipeline Activation Audit
 * Run: npx ts-node backend/scripts/downstreamPipelineAudit.ts
 * Counts: intelligence_signals → signal_clusters → signal_intelligence → strategic_themes → company_intelligence_signals
 */

import { supabase } from '../db/supabaseClient';

async function count(table: string): Promise<number> {
  const { count: n, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) return -1;
  return n ?? 0;
}

async function main() {
  const signals = await count('intelligence_signals');
  const clusters = await count('signal_clusters');
  const intelligence = await count('signal_intelligence');
  const themes = await count('strategic_themes');
  const companySignals = await count('company_intelligence_signals');

  console.log(JSON.stringify({
    signals,
    clusters,
    intelligence,
    themes,
    company_signals: companySignals,
  }));
}

main().catch(console.error);
