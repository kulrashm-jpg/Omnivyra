/**
 * Activate Intelligence System
 * Run: npx ts-node backend/scripts/activateIntelligenceSystem.ts
 *
 * 1. Inserts external API sources (if not exist)
 * 2. Links companies to API sources via company_api_configs
 * 3. Ensures company_intelligence_topics for distribution targeting
 * 4. Triggers enqueueIntelligencePolling
 * 5. Outputs verification
 */

import { supabase } from '../db/supabaseClient';
import { enqueueIntelligencePolling } from '../scheduler/schedulerService';

const SOURCES = [
  { name: 'google_trends', base_url: 'https://trends.google.com/trending/rss', purpose: 'trends', is_active: true },
  { name: 'reddit_trends', base_url: 'https://www.reddit.com/r/trending.json', purpose: 'trends', is_active: true },
  { name: 'news_trends', base_url: 'https://newsapi.org/v2/top-headlines', purpose: 'trends', is_active: true },
];

async function safeCount(table: string, pkCol = 'id'): Promise<number> {
  const { count, error } = await supabase.from(table).select(pkCol, { count: 'exact', head: true });
  if (error) return -1;
  return count ?? -1;
}

async function main() {
  console.log('=== Intelligence System Activation ===\n');

  // 1. Insert external API sources
  for (const src of SOURCES) {
    const { data: existing } = await supabase
      .from('external_api_sources')
      .select('id')
      .eq('name', src.name)
      .maybeSingle();
    if (!existing) {
      const { error } = await supabase.from('external_api_sources').insert(src);
      if (error) {
        console.warn(`[activate] Failed to insert ${src.name}:`, error.message);
      } else {
        console.log(`[activate] Inserted source: ${src.name}`);
      }
    }
  }

  // 2. Get first company and all active sources
  const { data: companies } = await supabase.from('companies').select('id').order('created_at').limit(1);
  const { data: sources } = await supabase.from('external_api_sources').select('id').eq('is_active', true);

  if (companies?.length && sources?.length) {
    for (const s of sources) {
      const { error } = await supabase
        .from('company_api_configs')
        .upsert(
          { company_id: companies[0]!.id, api_source_id: s.id, enabled: true, polling_frequency: '2h' },
          { onConflict: 'company_id,api_source_id', ignoreDuplicates: false }
        );
      if (error) console.warn('[activate] company_api_configs upsert:', error.message);
    }
    console.log('[activate] company_api_configs: linked', companies[0]!.id, 'to', sources.length, 'sources');

    // 3. Phase-3 config for distribution
    const { data: hasTopic } = await supabase
      .from('company_intelligence_topics')
      .select('id')
      .eq('company_id', companies[0]!.id)
      .eq('topic', 'marketing')
      .maybeSingle();
    if (!hasTopic) {
      await supabase.from('company_intelligence_topics').insert({
        company_id: companies[0]!.id,
        topic: 'marketing',
        enabled: true,
      });
      console.log('[activate] company_intelligence_topics: added marketing for', companies[0]!.id);
    }
  }

  // 4. Enqueue intelligence polling
  const enqueueResult = await enqueueIntelligencePolling();
  console.log('[activate] enqueueIntelligencePolling:', enqueueResult);

  // 5. Counts
  const counts = {
    intelligence_signals: await safeCount('intelligence_signals'),
    signal_clusters: await safeCount('signal_clusters', 'cluster_id'),
    signal_intelligence: await safeCount('signal_intelligence'),
    strategic_themes: await safeCount('strategic_themes'),
    company_intelligence_signals: await safeCount('company_intelligence_signals'),
  };
  console.log('\n[activate] Table counts:', counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
