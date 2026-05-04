import { runWithServiceRole } from '../db/supabaseClient';

const REQUIRED_TABLES = [
  'scheduler_locks',
  'job_idempotency_keys',
  'scheduled_posts_execution_intent',
  'worker_dead_letter_queue',
  'scheduled_posts',
];

export async function assertExecutionEngineSchemaReady(): Promise<void> {
  await runWithServiceRole('Verify execution engine schema at startup', async (client) => {
    for (const table of REQUIRED_TABLES) {
      const { error } = await client.from(table).select('*').limit(1);
      if (error) {
        throw new Error(`EXECUTION_ENGINE_SCHEMA_MISSING:${table}:${error.message}`);
      }
    }

    const { error: scheduledPostColumnError } = await client
      .from('scheduled_posts')
      .select('execution_intent_id,idempotency_key')
      .limit(1);
    if (scheduledPostColumnError) {
      throw new Error(`EXECUTION_ENGINE_SCHEMA_MISSING:scheduled_posts.execution_intent_id/idempotency_key:${scheduledPostColumnError.message}`);
    }
  });
}
