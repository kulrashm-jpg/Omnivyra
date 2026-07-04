import { ownedDbTable } from '../db/writeOwner';
import { trackEvent } from './telemetry/telemetryDispatcher';

type MarketPulseEntityType = 'pressure' | 'impact' | 'narrative' | 'consequence' | 'escalation' | 'digest_item' | 'investigation';
type InvestigationStatus = 'open' | 'investigating' | 'monitoring' | 'blocked' | 'resolved' | 'archived';
type AcknowledgmentType = 'reviewed' | 'monitoring' | 'action_planned' | 'escalated' | 'resolved' | 'dismissed';

const ACTIVE_INVESTIGATION_STATUSES = new Set(['open', 'investigating', 'monitoring', 'blocked']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function actorId(value?: string | null): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

function normalizePriority(value?: string | null): string {
  return ['low', 'normal', 'high', 'critical'].includes(String(value)) ? String(value) : 'normal';
}

function duplicateKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function lifecycleStateForAcknowledgment(type: AcknowledgmentType): string {
  if (type === 'monitoring') return 'monitored';
  if (type === 'escalated') return 'escalating';
  if (type === 'resolved') return 'resolved';
  if (type === 'dismissed') return 'muted';
  return 'acknowledged';
}

function visibilityAllowed(row: any, viewerUserId?: string | null, viewerRole?: string | null): boolean {
  if (row.visibility === 'company') return true;
  if (row.visibility === 'private') return row.created_by && row.created_by === actorId(viewerUserId);
  const role = String(viewerRole ?? '').toUpperCase();
  if (row.visibility === 'leadership') return ['SUPER_ADMIN', 'CONTENT_ARCHITECT', 'COMPANY_ADMIN', 'ADMIN'].includes(role);
  if (row.visibility === 'department') return ['SUPER_ADMIN', 'CONTENT_ARCHITECT', 'COMPANY_ADMIN', 'ADMIN', 'MEMBER'].includes(role);
  return false;
}

async function recordAudit(params: {
  companyId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorUserId?: string | null;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  governanceFlags?: Record<string, unknown>;
}) {
  await ownedDbTable('marketpulse_collaboration_audit_events').insert({
    company_id: params.companyId,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    actor_id: actorId(params.actorUserId),
    previous_state: params.previousState ?? {},
    new_state: params.newState ?? {},
    governance_flags: params.governanceFlags ?? {},
  });
}

async function createActionLink(params: {
  companyId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  targetArtifactType: string;
  targetArtifactId: string;
  relationshipType: string;
  actorUserId?: string | null;
  tracePayload?: Record<string, unknown>;
}) {
  const result = await ownedDbTable('marketpulse_intelligence_action_links').insert({
    company_id: params.companyId,
    source_entity_type: params.sourceEntityType,
    source_entity_id: params.sourceEntityId,
    target_artifact_type: params.targetArtifactType,
    target_artifact_id: params.targetArtifactId,
    relationship_type: params.relationshipType,
    trace_payload: params.tracePayload ?? {},
    created_by: actorId(params.actorUserId),
  }).select('*').single();
  return result.data ?? null;
}

async function createWorkflowReadinessHook(params: {
  companyId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  hookType: string;
  hookPayload?: Record<string, unknown>;
}) {
  const result = await ownedDbTable('marketpulse_workflow_hooks').insert({
    company_id: params.companyId,
    source_entity_type: params.sourceEntityType,
    source_entity_id: params.sourceEntityId,
    hook_type: params.hookType,
    readiness_state: 'prepared',
    hook_payload: params.hookPayload ?? {},
  }).select('*').single();
  return result.data ?? null;
}

async function markStaleInvestigations(companyId: string) {
  const now = new Date().toISOString();
  const rows = await ownedDbTable('marketpulse_investigation_threads')
    .select('*')
    .eq('company_id', companyId)
    .lt('stale_at', now)
    .order('updated_at', { ascending: true })
    .limit(25);
  const stale = (rows.data ?? []).filter((row: any) => ACTIVE_INVESTIGATION_STATUSES.has(row.investigation_status));
  await Promise.all(stale.map((row: any) =>
    ownedDbTable('marketpulse_investigation_threads')
      .update({
        governance_flags: {
          ...(row.governance_flags ?? {}),
          stale_unresolved: true,
          stale_detected_at: now,
        },
      })
      .eq('id', row.id)
  ));
  return stale.map((row: any) => row.id);
}

export async function getMarketPulseCollaborationContext(params: {
  companyId: string;
  entityType?: string | null;
  entityId?: string | null;
  viewerUserId?: string | null;
  viewerRole?: string | null;
}) {
  const staleThreadIds = await markStaleInvestigations(params.companyId);
  const filterEntity = (query: any) => {
    let out = query.eq('company_id', params.companyId);
    if (params.entityType) out = out.eq('entity_type', params.entityType);
    if (params.entityId) out = out.eq('entity_id', params.entityId);
    return out;
  };
  const [threads, acknowledgments, decisions, annotations, links, audit] = await Promise.all([
    filterEntity(ownedDbTable('marketpulse_investigation_threads').select('*')).order('updated_at', { ascending: false }).limit(30),
    filterEntity(ownedDbTable('marketpulse_entity_acknowledgments').select('*')).order('created_at', { ascending: false }).limit(30),
    filterEntity(ownedDbTable('marketpulse_decision_memory').select('*')).order('updated_at', { ascending: false }).limit(30),
    filterEntity(ownedDbTable('marketpulse_annotations').select('*')).order('created_at', { ascending: false }).limit(30),
    params.entityType && params.entityId
      ? ownedDbTable('marketpulse_intelligence_action_links')
        .select('*')
        .eq('company_id', params.companyId)
        .eq('source_entity_type', params.entityType)
        .eq('source_entity_id', params.entityId)
        .order('created_at', { ascending: false })
        .limit(30)
      : ownedDbTable('marketpulse_intelligence_action_links').select('*').eq('company_id', params.companyId).order('created_at', { ascending: false }).limit(30),
    params.entityType && params.entityId
      ? ownedDbTable('marketpulse_collaboration_audit_events')
        .select('*')
        .eq('company_id', params.companyId)
        .eq('entity_type', params.entityType)
        .eq('entity_id', params.entityId)
        .order('created_at', { ascending: false })
        .limit(50)
      : ownedDbTable('marketpulse_collaboration_audit_events').select('*').eq('company_id', params.companyId).order('created_at', { ascending: false }).limit(50),
  ]);
  const threadRows = threads.data ?? [];
  const comments = threadRows.length
    ? await ownedDbTable('marketpulse_investigation_comments')
      .select('*')
      .in('thread_id', threadRows.map((row: any) => row.id))
      .order('created_at', { ascending: true })
    : { data: [] };
  const assignmentHistory = threadRows.length
    ? await ownedDbTable('marketpulse_assignment_history')
      .select('*')
      .in('thread_id', threadRows.map((row: any) => row.id))
      .order('created_at', { ascending: false })
    : { data: [] };
  return {
    investigationThreads: threadRows,
    investigationComments: comments.data ?? [],
    acknowledgments: acknowledgments.data ?? [],
    decisionMemory: decisions.data ?? [],
    annotations: (annotations.data ?? []).filter((row: any) => visibilityAllowed(row, params.viewerUserId, params.viewerRole)),
    intelligenceActionLinks: links.data ?? [],
    auditEvents: audit.data ?? [],
    assignmentHistory: assignmentHistory.data ?? [],
    governance: {
      staleThreadIds,
      activeThreadCount: threadRows.filter((row: any) => ACTIVE_INVESTIGATION_STATUSES.has(row.investigation_status)).length,
    },
  };
}

export async function createMarketPulseInvestigationThread(params: {
  companyId: string;
  entityType: MarketPulseEntityType;
  entityId: string;
  title: string;
  createdBy?: string | null;
  assignedTo?: string | null;
  assignedDepartment?: string | null;
  priority?: string | null;
  assignmentNote?: string | null;
}) {
  const key = duplicateKey(params.entityType, params.entityId);
  const existing = await ownedDbTable('marketpulse_investigation_threads')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('duplicate_key', key)
    .order('updated_at', { ascending: false })
    .limit(5);
  const active = (existing.data ?? []).find((row: any) => ACTIVE_INVESTIGATION_STATUSES.has(row.investigation_status));
  if (active) {
    await recordAudit({
      companyId: params.companyId,
      eventType: 'duplicate_investigation_suppressed',
      entityType: params.entityType,
      entityId: params.entityId,
      actorUserId: params.createdBy,
      newState: { existing_thread_id: active.id },
      governanceFlags: { duplicate_investigation: true },
    });
    return { thread: active, duplicate: true };
  }
  const result = await ownedDbTable('marketpulse_investigation_threads').insert({
    company_id: params.companyId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    title: params.title,
    investigation_status: 'open',
    created_by: actorId(params.createdBy),
    assigned_to: actorId(params.assignedTo),
    assigned_department: params.assignedDepartment ?? null,
    assignment_note: params.assignmentNote ?? null,
    priority: normalizePriority(params.priority),
    duplicate_key: key,
    governance_flags: {},
  }).select('*').single();
  if (result.error) throw new Error(`Failed to create MarketPulse investigation thread: ${result.error.message}`);
  await createActionLink({
    companyId: params.companyId,
    sourceEntityType: params.entityType,
    sourceEntityId: params.entityId,
    targetArtifactType: 'investigation_thread',
    targetArtifactId: result.data.id,
    relationshipType: 'investigated_by',
    actorUserId: params.createdBy,
    tracePayload: { status: 'open', priority: normalizePriority(params.priority) },
  });
  await createWorkflowReadinessHook({
    companyId: params.companyId,
    sourceEntityType: params.entityType,
    sourceEntityId: params.entityId,
    hookType: 'investigation_candidate',
    hookPayload: {
      investigation_thread_id: result.data.id,
      status: 'open',
      priority: normalizePriority(params.priority),
      automation_allowed: false,
    },
  });
  await recordAudit({
    companyId: params.companyId,
    eventType: 'investigation_created',
    entityType: params.entityType,
    entityId: params.entityId,
    actorUserId: params.createdBy,
    newState: result.data,
  });
  return { thread: result.data, duplicate: false };
}

export async function updateMarketPulseInvestigationThread(params: {
  companyId: string;
  threadId: string;
  actorUserId?: string | null;
  investigationStatus?: InvestigationStatus;
  assignedTo?: string | null;
  assignedDepartment?: string | null;
  priority?: string | null;
  title?: string | null;
  assignmentNote?: string | null;
}) {
  const existing = await ownedDbTable('marketpulse_investigation_threads')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('id', params.threadId)
    .maybeSingle();
  if (!existing.data) throw new Error('MarketPulse investigation thread not found');
  const conflictingOwnership = params.assignedTo !== undefined
    && existing.data.assigned_to
    && actorId(params.assignedTo) !== existing.data.assigned_to;
  const updatePayload: Record<string, unknown> = {
    last_activity_at: new Date().toISOString(),
    stale_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    governance_flags: {
      ...(existing.data.governance_flags ?? {}),
      conflicting_ownership: Boolean(conflictingOwnership),
    },
  };
  if (params.investigationStatus) updatePayload.investigation_status = params.investigationStatus;
  if (params.assignedTo !== undefined) updatePayload.assigned_to = actorId(params.assignedTo);
  if (params.assignedDepartment !== undefined) updatePayload.assigned_department = params.assignedDepartment;
  if (params.assignmentNote !== undefined) updatePayload.assignment_note = params.assignmentNote;
  if (params.priority) updatePayload.priority = normalizePriority(params.priority);
  if (params.title) updatePayload.title = params.title;
  const result = await ownedDbTable('marketpulse_investigation_threads')
    .update(updatePayload)
    .eq('company_id', params.companyId)
    .eq('id', params.threadId)
    .select('*')
    .single();
  if (result.error) throw new Error(`Failed to update MarketPulse investigation thread: ${result.error.message}`);
  if (params.assignedTo !== undefined || params.assignedDepartment !== undefined) {
    await ownedDbTable('marketpulse_assignment_history').insert({
      company_id: params.companyId,
      thread_id: params.threadId,
      previous_assigned_to: existing.data.assigned_to ?? null,
      new_assigned_to: params.assignedTo !== undefined ? actorId(params.assignedTo) : existing.data.assigned_to ?? null,
      previous_department: existing.data.assigned_department ?? null,
      new_department: params.assignedDepartment !== undefined ? params.assignedDepartment : existing.data.assigned_department ?? null,
      changed_by: actorId(params.actorUserId),
      change_reason: params.assignmentNote ?? 'Investigation ownership updated.',
      governance_flags: {
        conflicting_ownership: Boolean(conflictingOwnership),
        orphan_investigation: !actorId(params.assignedTo) && !params.assignedDepartment,
      },
    });
  }
  await recordAudit({
    companyId: params.companyId,
    eventType: params.assignedTo !== undefined ? 'investigation_reassigned' : 'investigation_updated',
    entityType: result.data.entity_type,
    entityId: result.data.entity_id,
    actorUserId: params.actorUserId,
    previousState: existing.data,
    newState: result.data,
    governanceFlags: { conflicting_ownership: Boolean(conflictingOwnership) },
  });
  return result.data;
}

export async function addMarketPulseInvestigationComment(params: {
  companyId: string;
  threadId: string;
  authorId?: string | null;
  comment: string;
  evidencePayload?: Record<string, unknown>;
}) {
  const thread = await ownedDbTable('marketpulse_investigation_threads')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('id', params.threadId)
    .maybeSingle();
  if (!thread.data) throw new Error('MarketPulse investigation thread not found');
  const result = await ownedDbTable('marketpulse_investigation_comments').insert({
    thread_id: params.threadId,
    author_id: actorId(params.authorId),
    comment: params.comment,
    evidence_payload: params.evidencePayload ?? {},
  }).select('*').single();
  if (result.error) throw new Error(`Failed to add MarketPulse investigation comment: ${result.error.message}`);
  await ownedDbTable('marketpulse_investigation_threads')
    .update({
      last_activity_at: new Date().toISOString(),
      stale_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq('id', params.threadId);
  await recordAudit({
    companyId: params.companyId,
    eventType: 'investigation_comment_added',
    entityType: thread.data.entity_type,
    entityId: thread.data.entity_id,
    actorUserId: params.authorId,
    newState: { comment_id: result.data.id, thread_id: params.threadId },
  });
  // Canonical telemetry (append-only, fail-soft): a collaboration comment was
  // added. Deduped per comment id (each insert is unique).
  trackEvent({
    type: 'collaboration.comment_added',
    organizationId: params.companyId,
    actorId: params.authorId ?? null,
    entityId: result.data.id,
    metadata: { entityType: thread.data.entity_type },
  });
  return result.data;
}

export async function acknowledgeMarketPulseEntity(params: {
  companyId: string;
  entityType: MarketPulseEntityType;
  entityId: string;
  acknowledgedBy?: string | null;
  acknowledgmentType: AcknowledgmentType;
  notes?: string | null;
  ownerUserId?: string | null;
}) {
  const lifecycleState = lifecycleStateForAcknowledgment(params.acknowledgmentType);
  const result = await ownedDbTable('marketpulse_entity_acknowledgments').insert({
    company_id: params.companyId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    acknowledged_by: actorId(params.acknowledgedBy),
    acknowledgment_type: params.acknowledgmentType,
    notes: params.notes ?? null,
    ownership_payload: {
      owner_user_id: actorId(params.ownerUserId),
      lifecycle_state: lifecycleState,
      source: 'manual_acknowledgment',
    },
  }).select('*').single();
  if (result.error) throw new Error(`Failed to acknowledge MarketPulse entity: ${result.error.message}`);
  if (['pressure', 'impact', 'consequence', 'narrative', 'digest_item'].includes(params.entityType)) {
    await ownedDbTable('marketpulse_lifecycle_states').upsert({
      company_id: params.companyId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      lifecycle_state: lifecycleState,
      acknowledged_by: actorId(params.acknowledgedBy),
      acknowledged_at: new Date().toISOString(),
      resolved_at: params.acknowledgmentType === 'resolved' ? new Date().toISOString() : null,
      last_transition_reason: `Manual acknowledgment: ${params.acknowledgmentType}`,
    }, { onConflict: 'company_id,entity_type,entity_id' });
  }
  await createActionLink({
    companyId: params.companyId,
    sourceEntityType: params.entityType,
    sourceEntityId: params.entityId,
    targetArtifactType: 'acknowledgment',
    targetArtifactId: result.data.id,
    relationshipType: 'acknowledged_by',
    actorUserId: params.acknowledgedBy,
    tracePayload: { acknowledgment_type: params.acknowledgmentType, lifecycle_state: lifecycleState },
  });
  await recordAudit({
    companyId: params.companyId,
    eventType: 'entity_acknowledged',
    entityType: params.entityType,
    entityId: params.entityId,
    actorUserId: params.acknowledgedBy,
    newState: result.data,
  });
  return result.data;
}

export async function saveMarketPulseDecisionMemory(params: {
  companyId: string;
  entityType: MarketPulseEntityType;
  entityId: string;
  decisionSummary: string;
  rationale?: string | null;
  decisionOwner?: string | null;
  outcomeStatus?: string | null;
  actorUserId?: string | null;
  contextSnapshot?: Record<string, unknown>;
}) {
  const result = await ownedDbTable('marketpulse_decision_memory').insert({
    company_id: params.companyId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    decision_summary: params.decisionSummary,
    rationale: params.rationale ?? null,
    decision_owner: actorId(params.decisionOwner),
    outcome_status: params.outcomeStatus ?? 'proposed',
    context_snapshot: params.contextSnapshot ?? {},
  }).select('*').single();
  if (result.error) throw new Error(`Failed to save MarketPulse decision memory: ${result.error.message}`);
  await createActionLink({
    companyId: params.companyId,
    sourceEntityType: params.entityType,
    sourceEntityId: params.entityId,
    targetArtifactType: 'decision_memory',
    targetArtifactId: result.data.id,
    relationshipType: 'decision_recorded_for',
    actorUserId: params.actorUserId,
    tracePayload: { outcome_status: result.data.outcome_status },
  });
  await createWorkflowReadinessHook({
    companyId: params.companyId,
    sourceEntityType: params.entityType,
    sourceEntityId: params.entityId,
    hookType: 'strategic_review_context',
    hookPayload: {
      decision_memory_id: result.data.id,
      outcome_status: result.data.outcome_status,
      automation_allowed: false,
    },
  });
  await recordAudit({
    companyId: params.companyId,
    eventType: 'decision_memory_recorded',
    entityType: params.entityType,
    entityId: params.entityId,
    actorUserId: params.actorUserId,
    newState: result.data,
  });
  return result.data;
}

export async function createMarketPulseAnnotation(params: {
  companyId: string;
  entityType: MarketPulseEntityType;
  entityId: string;
  annotationType: string;
  content: string;
  visibility?: string | null;
  createdBy?: string | null;
}) {
  const recent = await ownedDbTable('marketpulse_annotations')
    .select('id, created_at')
    .eq('company_id', params.companyId)
    .eq('entity_type', params.entityType)
    .eq('entity_id', params.entityId)
    .eq('created_by', actorId(params.createdBy))
    .order('created_at', { ascending: false })
    .limit(6);
  const noisyCollaboration = (recent.data ?? []).length >= 5;
  const result = await ownedDbTable('marketpulse_annotations').insert({
    company_id: params.companyId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    annotation_type: params.annotationType,
    content: params.content,
    visibility: params.visibility ?? 'company',
    created_by: actorId(params.createdBy),
  }).select('*').single();
  if (result.error) throw new Error(`Failed to create MarketPulse annotation: ${result.error.message}`);
  await createActionLink({
    companyId: params.companyId,
    sourceEntityType: params.entityType,
    sourceEntityId: params.entityId,
    targetArtifactType: 'annotation',
    targetArtifactId: result.data.id,
    relationshipType: 'annotated_by',
    actorUserId: params.createdBy,
    tracePayload: { visibility: result.data.visibility, annotation_type: result.data.annotation_type },
  });
  await recordAudit({
    companyId: params.companyId,
    eventType: 'annotation_created',
    entityType: params.entityType,
    entityId: params.entityId,
    actorUserId: params.createdBy,
    newState: result.data,
    governanceFlags: { noisy_collaboration: noisyCollaboration },
  });
  return { annotation: result.data, governance: { noisyCollaboration } };
}
