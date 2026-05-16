import { ownedDbTable } from '../db/writeOwner';
import type {
  ListeningSource,
  ListeningSourceStatus,
  ListeningSourceType,
  MonitoringMode,
} from '../types/listeningSource';
import { invalidateCapabilityAggregate } from './capabilityCacheService';

// Phase 2 — deterministic transition table for the listening_sources.status
// column. Narrower than the full SourceLifecycleState machine because the
// table's status column carries fewer states; we still enforce that every
// requested transition is on the explicit allow-list. Anything else is
// rejected before the DB write.
const ALLOWED_SOURCE_STATUS_TRANSITIONS: Record<ListeningSourceStatus, ListeningSourceStatus[]> = {
  inactive: ['approved', 'revoked'],
  approved: ['active', 'paused', 'inactive', 'revoked'],
  active: ['paused', 'revoked'],
  paused: ['active', 'revoked'],
  revoked: [],
};

function canTransitionListeningSourceStatus(
  from: ListeningSourceStatus,
  to: ListeningSourceStatus,
): { allowed: boolean; reason?: string } {
  if (from === to) return { allowed: false, reason: 'no_op_same_state' };
  const allowed = (ALLOWED_SOURCE_STATUS_TRANSITIONS[from] ?? []).includes(to);
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `transition_${from}_to_${to}_not_permitted` };
}

export class ListeningSourceTransitionError extends Error {
  constructor(public readonly fromStatus: ListeningSourceStatus, public readonly toStatus: ListeningSourceStatus, message: string) {
    super(message);
    this.name = 'ListeningSourceTransitionError';
  }
}

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
  invalidateCapabilityAggregate(input.organizationId);
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
 * layer reads this status to decide what to do; today nothing in this
 * codebase reads it for execution.
 *
 * Phase 2 — deterministic transition enforcement. Every status change MUST
 * be in the allow-list; revoked is terminal. Throws ListeningSourceTransitionError
 * on invalid transitions BEFORE the DB write so a caller cannot bypass the
 * state machine by writing a status with no corresponding consent.
 */
export async function updateListeningSourceStatus(
  organizationId: string,
  id: string,
  status: ListeningSourceStatus,
): Promise<ListeningSource | null> {
  const existing = await getListeningSource(organizationId, id);
  if (!existing) return null;

  const transition = canTransitionListeningSourceStatus(existing.status, status);
  if (!transition.allowed) {
    throw new ListeningSourceTransitionError(
      existing.status,
      status,
      `Invalid listening-source transition: ${transition.reason}`,
    );
  }

  const { data, error } = await ownedDbTable('listening_sources')
    .update({ status })
    .eq('organization_id', organizationId)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update listening source status: ${error.message}`);
  }
  if (data) {
    invalidateCapabilityAggregate(organizationId);
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
  if (data) {
    invalidateCapabilityAggregate(organizationId);
  }
  return (data as ListeningSource | null) ?? null;
}
