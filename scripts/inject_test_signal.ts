import * as dotenv from 'dotenv';
import * as path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { supabase } from '../backend/db/supabaseClient';
import { resolveLeadSignalWriteMode, writeLeadSignal } from '../backend/services/canonicalLeadSignalService';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function resolveOrganizationId(requestedId: string | undefined): Promise<string> {
  if (requestedId) {
    const { data } = await supabase.from('companies').select('id').eq('id', requestedId).maybeSingle();
    if ((data as { id?: string } | null)?.id) return requestedId;
  }

  const { data, error } = await supabase.from('companies').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error || !(data as { id?: string } | null)?.id) {
    throw new Error('No valid organization_id found; provide TEST_ORGANIZATION_ID or create a company record');
  }
  return String((data as { id: string }).id);
}

async function main() {
  const sourceType = (arg('source-type') ?? 'listening') as 'engagement' | 'listening';
  const sourceId = arg('source-id') ?? `test_${sourceType}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const platform = arg('platform') ?? 'linkedin';
  const organizationId = await resolveOrganizationId(arg('organization-id') ?? process.env.TEST_ORGANIZATION_ID);
  const platformUserId = arg('platform-user-id') ?? `test-user-${randomUUID().slice(0, 8)}`;
  const threadId = arg('thread-id') ?? null;
  const messageId = arg('message-id') ?? sourceId;
  const content = arg('content') ?? `Synthetic ${sourceType} signal ${sourceId}`;
  const totalScore = Number(arg('score') ?? '0.81');
  const mode = resolveLeadSignalWriteMode();

  const result = await writeLeadSignal({
    debugContext: 'scripts.inject_test_signal',
    canonical: {
      organization_id: organizationId,
      source_type: sourceType,
      source_id: sourceType === 'engagement' ? messageId : sourceId,
      thread_id: sourceType === 'engagement' ? threadId : null,
      platform,
      platform_user_id: platformUserId,
      content_text: content,
      intent_score: totalScore,
      urgency_score: sourceType === 'listening' ? 0.55 : null,
      icp_score: sourceType === 'listening' ? 0.74 : null,
      confidence_score: 0.93,
      total_score: totalScore,
      detected_at: new Date().toISOString(),
      migration_source: 'native',
      metadata: {
        synthetic: true,
        injected_by: 'scripts/inject_test_signal.ts',
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        mode,
        source_type: sourceType,
        source_id: sourceType === 'engagement' ? messageId : sourceId,
        canonical_id: result.canonical?.id ?? null,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        status: 'FAIL',
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
