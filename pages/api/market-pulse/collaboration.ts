import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  acknowledgeMarketPulseEntity,
  addMarketPulseInvestigationComment,
  createMarketPulseAnnotation,
  createMarketPulseInvestigationThread,
  getMarketPulseCollaborationContext,
  saveMarketPulseDecisionMemory,
  updateMarketPulseInvestigationThread,
} from '../../../backend/services/marketPulseCollaborationService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function actorUserId(value: string): string | null {
  return UUID_RE.test(value) ? value : null;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId = (req.query.companyId as string | undefined) || (body.companyId as string | undefined);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;
  const userId = actorUserId(access.userId);

  try {
    if (req.method === 'GET') {
      const context = await getMarketPulseCollaborationContext({
        companyId,
        entityType: req.query.entityType as string | undefined,
        entityId: req.query.entityId as string | undefined,
        viewerUserId: userId,
        viewerRole: access.role,
      });
      return res.status(200).json(context);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const action = String(body.action || '').trim();
    if (!action) return res.status(400).json({ error: 'action is required' });

    if (action === 'create_thread') {
      const entityType = String(body.entityType || body.entity_type || '').trim() as any;
      const entityId = String(body.entityId || body.entity_id || '').trim();
      const title = String(body.title || '').trim();
      if (!entityType || !entityId || !title) return res.status(400).json({ error: 'entityType, entityId, and title are required' });
      const result = await createMarketPulseInvestigationThread({
        companyId,
        entityType,
        entityId,
        title,
        createdBy: userId,
        assignedTo: typeof body.assignedTo === 'string' ? body.assignedTo : typeof body.assigned_to === 'string' ? body.assigned_to : null,
        assignedDepartment: typeof body.assignedDepartment === 'string' ? body.assignedDepartment : typeof body.assigned_department === 'string' ? body.assigned_department : null,
        priority: typeof body.priority === 'string' ? body.priority : 'normal',
        assignmentNote: typeof body.assignmentNote === 'string' ? body.assignmentNote : typeof body.assignment_note === 'string' ? body.assignment_note : null,
      });
      return res.status(200).json(result);
    }

    if (action === 'update_thread') {
      const threadId = String(body.threadId || body.thread_id || '').trim();
      if (!threadId) return res.status(400).json({ error: 'threadId is required' });
      const thread = await updateMarketPulseInvestigationThread({
        companyId,
        threadId,
        actorUserId: userId,
        investigationStatus: typeof body.investigationStatus === 'string' ? body.investigationStatus as any : typeof body.investigation_status === 'string' ? body.investigation_status as any : undefined,
        assignedTo: typeof body.assignedTo === 'string' ? body.assignedTo : typeof body.assigned_to === 'string' ? body.assigned_to : undefined,
        assignedDepartment: typeof body.assignedDepartment === 'string' ? body.assignedDepartment : typeof body.assigned_department === 'string' ? body.assigned_department : undefined,
        priority: typeof body.priority === 'string' ? body.priority : undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
        assignmentNote: typeof body.assignmentNote === 'string' ? body.assignmentNote : typeof body.assignment_note === 'string' ? body.assignment_note : undefined,
      });
      return res.status(200).json({ thread });
    }

    if (action === 'comment') {
      const threadId = String(body.threadId || body.thread_id || '').trim();
      const comment = String(body.comment || '').trim();
      if (!threadId || !comment) return res.status(400).json({ error: 'threadId and comment are required' });
      const item = await addMarketPulseInvestigationComment({
        companyId,
        threadId,
        authorId: userId,
        comment,
        evidencePayload: jsonObject(body.evidencePayload || body.evidence_payload),
      });
      return res.status(200).json({ comment: item });
    }

    if (action === 'acknowledge') {
      const entityType = String(body.entityType || body.entity_type || '').trim() as any;
      const entityId = String(body.entityId || body.entity_id || '').trim();
      const acknowledgmentType = String(body.acknowledgmentType || body.acknowledgment_type || '').trim() as any;
      if (!entityType || !entityId || !acknowledgmentType) return res.status(400).json({ error: 'entityType, entityId, and acknowledgmentType are required' });
      const acknowledgment = await acknowledgeMarketPulseEntity({
        companyId,
        entityType,
        entityId,
        acknowledgedBy: userId,
        acknowledgmentType,
        notes: typeof body.notes === 'string' ? body.notes : null,
        ownerUserId: typeof body.ownerUserId === 'string' ? body.ownerUserId : typeof body.owner_user_id === 'string' ? body.owner_user_id : null,
      });
      return res.status(200).json({ acknowledgment });
    }

    if (action === 'decision_memory') {
      const entityType = String(body.entityType || body.entity_type || '').trim() as any;
      const entityId = String(body.entityId || body.entity_id || '').trim();
      const decisionSummary = String(body.decisionSummary || body.decision_summary || '').trim();
      if (!entityType || !entityId || !decisionSummary) return res.status(400).json({ error: 'entityType, entityId, and decisionSummary are required' });
      const decision = await saveMarketPulseDecisionMemory({
        companyId,
        entityType,
        entityId,
        decisionSummary,
        rationale: typeof body.rationale === 'string' ? body.rationale : null,
        decisionOwner: typeof body.decisionOwner === 'string' ? body.decisionOwner : typeof body.decision_owner === 'string' ? body.decision_owner : null,
        outcomeStatus: typeof body.outcomeStatus === 'string' ? body.outcomeStatus : typeof body.outcome_status === 'string' ? body.outcome_status : 'proposed',
        actorUserId: userId,
        contextSnapshot: jsonObject(body.contextSnapshot || body.context_snapshot),
      });
      return res.status(200).json({ decision });
    }

    if (action === 'annotate') {
      const entityType = String(body.entityType || body.entity_type || '').trim() as any;
      const entityId = String(body.entityId || body.entity_id || '').trim();
      const annotationType = String(body.annotationType || body.annotation_type || '').trim();
      const content = String(body.content || '').trim();
      if (!entityType || !entityId || !annotationType || !content) return res.status(400).json({ error: 'entityType, entityId, annotationType, and content are required' });
      const result = await createMarketPulseAnnotation({
        companyId,
        entityType,
        entityId,
        annotationType,
        content,
        visibility: typeof body.visibility === 'string' ? body.visibility : 'company',
        createdBy: userId,
      });
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Unsupported collaboration action' });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'MarketPulse collaboration request failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/market-pulse/collaboration' });
