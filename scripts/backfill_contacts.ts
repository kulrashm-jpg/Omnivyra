import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { supabase } from '../backend/db/supabaseClient';
import { buildContactKey } from '../backend/services/canonicalLeadSignalService';

type Row = {
  id: string;
  organization_id: string;
  thread_id: string | null;
  platform: string | null;
  platform_user_id: string | null;
  contact_id: string | null;
  metadata: Record<string, unknown> | null;
};

function isMissingTable(error: { message?: string; code?: string } | null | undefined, relation: string): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    error?.code === '42P01' ||
    message.includes(`relation "${relation}" does not exist`) ||
    message.includes(`could not find the table 'public.${relation.toLowerCase()}'`)
  );
}

function isMissingColumn(error: { message?: string; code?: string } | null | undefined, column: string): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes(`could not find the '${column.toLowerCase()}' column`) || message.includes(`column "${column.toLowerCase()}" does not exist`);
}

async function main() {
  const { data, error } = await supabase
    .from('lead_signals')
    .select('id, organization_id, thread_id, platform, platform_user_id, contact_id, metadata')
    .not('platform_user_id', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingTable(error, 'lead_signals')) {
      console.log(
        JSON.stringify(
          {
            status: 'NOT_READY',
            reason: 'lead_signals table is missing',
            processed: 0,
            contacts_created: 0,
            signals_linked: 0,
            threads_linked: 0,
            unresolved: 0,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (isMissingColumn(error, 'contact_id')) {
      console.log(
        JSON.stringify(
          {
            status: 'NOT_READY',
            reason: 'lead_signals.contact_id column is missing',
            processed: 0,
            contacts_created: 0,
            signals_linked: 0,
            threads_linked: 0,
            unresolved: 0,
          },
          null,
          2,
        ),
      );
      return;
    }
    throw new Error(error.message || 'Failed to read canonical lead signals');
  }

  let processed = 0;
  let contactUpserts = 0;
  let signalsLinked = 0;
  let threadsLinked = 0;
  let unresolved = 0;

  for (const row of (data ?? []) as Row[]) {
    processed++;
    const platform = (row.platform ?? '').trim().toLowerCase();
    const platformUserId = (row.platform_user_id ?? '').trim();
    const contactKey = buildContactKey(platform, platformUserId);
    if (!platform || !platformUserId || !contactKey) {
      unresolved++;
      continue;
    }

    const metadata = row.metadata ?? {};
    const { data: contact, error: upsertError } = await supabase
      .from('contacts')
      .upsert(
        {
          organization_id: row.organization_id,
          platform,
          platform_user_id: platformUserId,
          contact_key: contactKey,
          display_name:
            typeof metadata.display_name === 'string'
              ? metadata.display_name
              : typeof metadata.author_handle === 'string'
                ? metadata.author_handle
                : null,
          profile_url: typeof metadata.profile_url === 'string' ? metadata.profile_url : null,
        },
        { onConflict: 'organization_id,platform,platform_user_id' },
      )
      .select('id')
      .single();

    if (upsertError) {
      if (isMissingTable(upsertError, 'contacts')) {
        console.log(
          JSON.stringify(
            {
              status: 'NOT_READY',
              reason: 'contacts table is missing',
              processed,
              contacts_created: contactUpserts,
              signals_linked: signalsLinked,
              threads_linked: threadsLinked,
              unresolved,
            },
            null,
            2,
          ),
        );
        return;
      }
      throw new Error(upsertError.message || 'Failed to upsert contact');
    }

    const contactId = (contact as { id?: string | null } | null)?.id ?? null;
    if (!contactId) {
      unresolved++;
      continue;
    }
    contactUpserts++;

    if (!row.contact_id) {
      const { error: signalUpdateError } = await supabase
        .from('lead_signals')
        .update({ contact_id: contactId })
        .eq('id', row.id);
      if (signalUpdateError) {
        throw new Error(signalUpdateError.message || `Failed to link signal ${row.id}`);
      }
      signalsLinked++;
    }

    if (row.thread_id) {
      const { error: threadUpdateError } = await supabase
        .from('engagement_threads')
        .update({ contact_id: contactId })
        .eq('id', row.thread_id)
        .is('contact_id', null);

      if (threadUpdateError && !String(threadUpdateError.message ?? '').toLowerCase().includes('contact_id')) {
        throw new Error(threadUpdateError.message || `Failed to link thread ${row.thread_id}`);
      }
      if (!threadUpdateError) threadsLinked++;
    }
  }

  const { count: linkedCount } = await (supabase as any)
    .from('lead_signals')
    .select('*', { count: 'exact', head: true })
    .not('contact_id', 'is', null);

  const totalSignals = (data ?? []).length;
  const coverage = totalSignals > 0 ? Number(((linkedCount ?? 0) / totalSignals).toFixed(4)) : 0;

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        processed,
        contacts_created: contactUpserts,
        signals_linked: signalsLinked,
        threads_linked: threadsLinked,
        unresolved,
        signal_contact_coverage: coverage,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[backfill_contacts]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
