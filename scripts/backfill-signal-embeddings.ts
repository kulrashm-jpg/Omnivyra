/**
 * Backfill topic_embedding for intelligence_signals
 *
 * Processes signals where topic_embedding IS NULL in batches.
 * Uses OpenAI text-embedding-3-small (1536 dims).
 *
 * Run: npx ts-node scripts/backfill-signal-embeddings.ts
 * Or:  npx tsx scripts/backfill-signal-embeddings.ts
 *
 * Env: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabase } from '../backend/db/supabaseClient';
import { generateTopicEmbedding, embeddingToPgVector } from '../backend/services/signalEmbeddingService';

const BATCH_SIZE = 50;
const DELAY_MS = 100;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('Starting signal embedding backfill...');

  let totalProcessed = 0;
  let totalUpdated = 0;

  while (true) {
    const { data: signals, error } = await supabase
      .from('intelligence_signals')
      .select('id, topic')
      .is('topic_embedding', null)
      .not('topic', 'is', null)
      .limit(BATCH_SIZE);

    if (error) {
      console.error('Failed to fetch signals:', error.message);
      process.exit(1);
    }

    if (!signals?.length) {
      console.log('No more signals to process.');
      break;
    }

    for (const s of signals as { id: string; topic: string }[]) {
      const topic = (s.topic ?? '').trim();
      if (!topic) continue;

      try {
        const embedding = await generateTopicEmbedding(topic);
        const vecStr = embeddingToPgVector(embedding);

        const { error: updErr } = await supabase
          .from('intelligence_signals')
          .update({ topic_embedding: vecStr } as any)
          .eq('id', s.id);

        if (updErr) {
          console.warn(`Failed to update signal ${s.id}:`, updErr.message);
        } else {
          totalUpdated++;
        }
      } catch (e) {
        console.warn(`Failed to embed signal ${s.id}:`, (e as Error).message);
      }
      totalProcessed++;
    }

    console.log(`Processed ${totalProcessed} signals, updated ${totalUpdated}`);
    await sleep(DELAY_MS);
  }

  console.log(`Signals backfill complete. Processed: ${totalProcessed}, updated: ${totalUpdated}`);

  // Backfill signal_clusters.topic_embedding
  let clusterProcessed = 0;
  let clusterUpdated = 0;

  const { data: clusters } = await supabase
    .from('signal_clusters')
    .select('cluster_id, cluster_topic')
    .is('topic_embedding', null)
    .not('cluster_topic', 'is', null);

  for (const c of (clusters ?? []) as { cluster_id: string; cluster_topic: string }[]) {
    const topic = (c.cluster_topic ?? '').trim();
    if (!topic) continue;

    try {
      const embedding = await generateTopicEmbedding(topic);
      const vecStr = embeddingToPgVector(embedding);
      const { error: updErr } = await supabase
        .from('signal_clusters')
        .update({ topic_embedding: vecStr } as any)
        .eq('cluster_id', c.cluster_id);

      if (!updErr) clusterUpdated++;
    } catch (e) {
      console.warn(`Failed to embed cluster ${c.cluster_id}:`, (e as Error).message);
    }
    clusterProcessed++;
    await sleep(DELAY_MS);
  }

  console.log(`Clusters backfill complete. Processed: ${clusterProcessed}, updated: ${clusterUpdated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
