import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 6 — Analyst workflow endpoint.
 *
 *   GET    ?companyId=...&opportunityId=...
 *     Returns { assignments, notes, tags, dispositions } for the opp.
 *
 *   GET    ?companyId=...&userId=...&assignedTo=1
 *     Returns active assignments for the user.
 *
 *   POST   { companyId, opportunityId, kind: 'assignment'|'note'|'tag'|'disposition', ... }
 *     Creates a workflow row. Validates per-kind payload.
 *
 *   DELETE ?companyId=...&assignmentId=...    — unassign
 *   DELETE ?companyId=...&opportunityId=...&tag=...   — remove tag
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  addOpportunityNote,
  addOpportunityTag,
  assignOpportunity,
  checkOpportunityInTenant,
  OpportunityNotInTenantError,
  listAssignmentsForOpportunity,
  listAssignmentsForUser,
  listDispositionsForOpportunity,
  listOpportunityNotes,
  listTagsForOpportunity,
  removeOpportunityTag,
  setOpportunityDisposition,
  unassignOpportunity,
} from '../../../backend/services/opportunityWorkflowService';
import {
  ASSIGNMENT_ROLES,
  DISPOSITIONS,
  NOTE_VISIBILITIES,
  type AssignmentRole,
  type Disposition,
  type NoteVisibility,
} from '../../../backend/types/opportunityWorkflow';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';
import { trackEvent } from '../../../backend/services/telemetry/telemetryDispatcher';
import { recordRawCounter } from '../../../backend/observability';

/**
 * OPS-C: the single answer for "this opportunity is not yours". Cross-tenant
 * and nonexistent items get the SAME status and body, so the response never
 * reveals whether another tenant's opportunity exists.
 */
function opportunityNotFound(res: NextApiResponse) {
  return res.status(404).json({ error: 'Opportunity not found', code: 'OPPORTUNITY_NOT_FOUND' });
}

/** Audit line for a denied tenant binding (same shape as CAMPAIGN_TENANT_MISMATCH). */
function auditOpportunityDenial(req: NextApiRequest, args: { companyId: string; userId: string; kind: string; reason: 'pre_check' | 'fk_violation' }) {
  console.warn('OPPORTUNITY_TENANT_MISMATCH', {
    path: req.url,
    companyId: args.companyId,
    userId: args.userId,
    kind: args.kind,
    reason: args.reason,
  });
  try { recordRawCounter('authz.opportunity_tenant_denied', 1, { route: 'active-leads/workflow', reason: args.reason }); } catch { /* fail-safe */ }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.assignedTo === '1' || req.query.assignedTo === 'true') {
      const userId = String(req.query.userId ?? ctx.userId);
      const items = await listAssignmentsForUser(companyId, userId);
      return res.status(200).json({ assignments: items });
    }
    const opportunityId = String(req.query.opportunityId ?? '');
    if (!opportunityId) return res.status(400).json({ error: 'opportunityId required' });
    const [assignments, notes, tags, dispositions] = await Promise.all([
      listAssignmentsForOpportunity(companyId, opportunityId),
      listOpportunityNotes(companyId, opportunityId),
      listTagsForOpportunity(companyId, opportunityId),
      listDispositionsForOpportunity(companyId, opportunityId),
    ]);
    return res.status(200).json({ assignments, notes, tags, dispositions });
  } catch (err: any) {
    console.error('[workflow GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load workflow' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const opportunityId = String(body.opportunityId ?? '');
  const kind = String(body.kind ?? '');
  if (!companyId || !opportunityId || !kind) {
    return res.status(400).json({ error: 'companyId, opportunityId, kind required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  // OPS-C: bind the opportunity to the authorized company BEFORE any write.
  // Membership was answered above (403); an item outside this company — or
  // one that does not exist — is a 404, never a database error.
  let binding: Awaited<ReturnType<typeof checkOpportunityInTenant>>;
  try {
    binding = await checkOpportunityInTenant(companyId, opportunityId);
  } catch {
    binding = 'lookup_error';
  }
  if (binding === 'lookup_error') {
    return res.status(503).json({
      error: 'Opportunity check is temporarily unavailable. Please try again.',
      code: 'OPPORTUNITY_LOOKUP_ERROR',
      retryable: true,
    });
  }
  if (binding === 'not_found') {
    auditOpportunityDenial(req, { companyId, userId: ctx.userId, kind, reason: 'pre_check' });
    return opportunityNotFound(res);
  }
  try {
    let result: unknown = null;
    if (kind === 'assignment') {
      const assignedTo = String(body.assignedToUserId ?? '');
      const r = (body.role ?? 'analyst') as AssignmentRole;
      if (!ASSIGNMENT_ROLES.includes(r)) return res.status(400).json({ error: 'invalid role' });
      if (!assignedTo) return res.status(400).json({ error: 'assignedToUserId required' });
      result = await assignOpportunity({
        organizationId: companyId,
        opportunityFeedItemId: opportunityId,
        assignedToUserId: assignedTo,
        assignedByUserId: ctx.userId,
        role: r,
      });
      // Canonical telemetry (append-only, fail-soft): a lead/opportunity was
      // assigned. Not deduped — reassignment is a distinct action.
      trackEvent({
        type: 'lead.assigned',
        organizationId: companyId,
        actorId: ctx.userId,
        entityId: opportunityId,
        metadata: { role: r },
        dedupKey: null,
      });
    } else if (kind === 'note') {
      const bodyText = String(body.body ?? '');
      const vis = (body.visibility ?? 'internal') as NoteVisibility;
      if (!NOTE_VISIBILITIES.includes(vis)) return res.status(400).json({ error: 'invalid visibility' });
      result = await addOpportunityNote({
        organizationId: companyId,
        opportunityFeedItemId: opportunityId,
        authorUserId: ctx.userId,
        body: bodyText,
        visibility: vis,
      });
    } else if (kind === 'tag') {
      const tag = String(body.tag ?? '');
      result = await addOpportunityTag({
        organizationId: companyId,
        opportunityFeedItemId: opportunityId,
        tag,
        createdBy: ctx.userId,
      });
    } else if (kind === 'disposition') {
      const d = body.disposition as Disposition;
      if (!DISPOSITIONS.includes(d)) return res.status(400).json({ error: 'invalid disposition' });
      result = await setOpportunityDisposition({
        organizationId: companyId,
        opportunityFeedItemId: opportunityId,
        disposition: d,
        reason: typeof body.reason === 'string' ? body.reason : null,
        setByUserId: ctx.userId,
      });
    } else {
      return res.status(400).json({ error: `unknown kind:${kind}` });
    }
    void publishRealtime({
      organizationId: companyId,
      topic: 'workflow',
      eventName: kind === 'note' ? 'analyst.note_added' : kind === 'assignment' ? 'opportunity.assigned' : `workflow.${kind}_added`,
      payload: { opportunity_feed_item_id: opportunityId, kind, actor_user_id: ctx.userId },
    });
    // Canonical telemetry (append-only, fail-soft): a lead workflow action was
    // triggered (assignment / note / tag / disposition). Not deduped — each
    // workflow action is a distinct event. (assignment also emits lead.assigned.)
    trackEvent({
      type: 'lead.workflow_triggered',
      organizationId: companyId,
      actorId: ctx.userId,
      entityId: opportunityId,
      metadata: { workflow: kind },
      dedupKey: null,
    });
    return res.status(200).json({ ok: true, [kind]: result });
  } catch (err: any) {
    // OPS-C: a residual item-FK 23503 (item removed after the pre-check) is
    // the same controlled 404 as the pre-check, never a 500.
    if (err instanceof OpportunityNotInTenantError) {
      auditOpportunityDenial(req, { companyId, userId: ctx.userId, kind, reason: 'fk_violation' });
      return opportunityNotFound(res);
    }
    console.error('[workflow POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Workflow write failed' });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const assignmentId = req.query.assignmentId ? String(req.query.assignmentId) : null;
    const opportunityId = req.query.opportunityId ? String(req.query.opportunityId) : null;
    const tag = req.query.tag ? String(req.query.tag) : null;
    if (assignmentId) {
      const result = await unassignOpportunity({ organizationId: companyId, assignmentId });
      return res.status(200).json({ ok: true, assignment: result });
    }
    if (opportunityId && tag) {
      const removed = await removeOpportunityTag({
        organizationId: companyId,
        opportunityFeedItemId: opportunityId,
        tag,
      });
      return res.status(200).json({ ok: true, removed });
    }
    return res.status(400).json({ error: 'assignmentId OR (opportunityId+tag) required' });
  } catch (err: any) {
    console.error('[workflow DELETE] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Workflow delete failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/workflow' });
