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

  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !(data as { id?: string } | null)?.id) {
    throw new Error('No valid organization_id found; provide TEST_ORGANIZATION_ID or create a company record');
  }
  return String((data as { id: string }).id);
}

async function countExact(
  table: 'lead_signals',
  filter: { column: string; value: string }
): Promise<number> {
  const { count, error } = await (supabase as any)
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(filter.column, filter.value);

  if (error) throw new Error(`Failed reading ${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const organizationId = await resolveOrganizationId(arg('organization-id') ?? process.env.TEST_ORGANIZATION_ID);
  const mode = resolveLeadSignalWriteMode();
  const sourceType = (arg('source-type') ?? 'listening') as 'engagement' | 'listening';
  const idSeed = `flow_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const canonicalSourceId = sourceType === 'engagement' ? `msg_${idSeed}` : `synthetic://${idSeed}`;
  const platformUserId = `flow-user-${randomUUID().slice(0, 8)}`;

  await writeLeadSignal({
    debugContext: 'scripts.validate_signal_flow',
    canonical: {
      organization_id: organizationId,
      source_type: sourceType,
      source_id: canonicalSourceId,
      thread_id: sourceType === 'engagement' ? `thread_${idSeed}` : null,
      platform: 'linkedin',
      platform_user_id: platformUserId,
      content_text: `Validation flow ${idSeed}`,
      intent_score: 0.82,
      urgency_score: sourceType === 'listening' ? 0.53 : null,
      icp_score: sourceType === 'listening' ? 0.76 : null,
      confidence_score: 0.94,
      total_score: 0.82,
      detected_at: new Date().toISOString(),
      migration_source: 'native',
      metadata: {
        synthetic: true,
        validation_run: idSeed,
      },
    },
  });

  const canonicalCount = await countExact('lead_signals', {
    column: 'source_id',
    value: canonicalSourceId,
  });

  const assertions: string[] = [];
  if (canonicalCount < 1) assertions.push('canonical row missing in canonical-only mode');

  const result = {
    status: assertions.length === 0 ? 'PASS' : 'FAIL',
    mode,
    source_type: sourceType,
    ids: {
      source_id: canonicalSourceId,
    },
    counts: {
      lead_signals: canonicalCount,
    },
    assertions,
  };

  console.log(JSON.stringify(result, null, 2));

  if (assertions.length > 0) {
    process.exit(1);
  }
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
