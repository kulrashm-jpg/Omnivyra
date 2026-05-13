import { ownedDbTable } from '../db/writeOwner';
import type {
  ListeningSource,
  ListeningSourceStatus,
  ListeningSourceType,
  MonitoringMode,
} from '../types/listeningSource';

export type CreateListeningSourceInput = {
  organizationId: string;
  integrationId?: string | null;
  sourceType: ListeningSourceType;
  sourceIdentifier: string;
  displayName: string;
  monitoringModes?: MonitoringMode[];
  metadata?: Record<string, unknown>;
  createdBy: string | null;
};

export async function createListeningSource(
  input: CreateListeningSourceInput,
): Promise<ListeningSource> {
  const { data, error } = await ownedDbTable('listening_sources')
    .insert({
      organization_id: input.organizationId,
      integration_id: input.integrationId ?? null,
      source_type: input.sourceType,
      source_identifier: input.sourceIdentifier,
      display_name: input.displayName,
      monitoring_modes: input.monitoringModes ?? [],
      status: 'inactive' as ListeningSourceStatus,
      metadata: input.metadata ?? {},
      created_by: input.createdBy,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create listening source: ${error?.message ?? 'unknown error'}`);
  }
  return data as ListeningSource;
}

export async function getListeningSource(
  organizationId: string,
  id: string,
): Promise<ListeningSource | null> {
  const { data, error } = await ownedDbTable('listening_sources')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load listening source: ${error.message}`);
  }
  return (data as ListeningSource | null) ?? null;
}

export async function listListeningSourcesForOrg(
  organizationId: string,
  options?: { status?: ListeningSourceStatus; sourceType?: ListeningSourceType },
): Promise<ListeningSource[]> {
  let query = ownedDbTable('listening_sources')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (options?.status) {
    query = query.eq('status', options.status);
  }
  if (options?.sourceType) {
    query = query.eq('source_type', options.sourceType);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list listening sources: ${error.message}`);
  }
  return (data as ListeningSource[]) ?? [];
}

/**
 * Update status only — does not start or stop any monitoring. The orchestration
 * layer that will exist in a later phase reads this status to decide what to
 * do; today nothing reads it for execution.
 */
export async function updateListeningSourceStatus(
  organizationId: string,
  id: string,
  status: ListeningSourceStatus,
): Promise<ListeningSource | null> {
  const { data, error } = await ownedDbTable('listening_sources')
    .update({ status })
    .eq('organization_id', organizationId)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update listening source status: ${error.message}`);
  }
  return (data as ListeningSource | null) ?? null;
}

export async function updateListeningSourceModes(
  organizationId: string,
  id: string,
  monitoringModes: MonitoringMode[],
): Promise<ListeningSource | null> {
  const { data, error } = await ownedDbTable('listening_sources')
    .update({ monitoring_modes: monitoringModes })
    .eq('organization_id', organizationId)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update listening source modes: ${error.message}`);
  }
  return (data as ListeningSource | null) ?? null;
}
