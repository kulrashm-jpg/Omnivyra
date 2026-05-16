/**
 * Phase 10 — Enterprise onboarding endpoint.
 *
 *   GET    ?companyId=...&templates=1                — list templates (incl. shared)
 *   GET    ?companyId=...                            — list applications
 *
 *   POST   { companyId, action:'upsert_template', id?, templateKind, name, industry?, description?, payload, recommendedExplanation?, shared? }
 *   POST   { companyId, action:'preview', templateId?, templateKind, previewPayload, metadata? }
 *   POST   { companyId, action:'approve', applicationId }
 *   POST   { companyId, action:'apply',   applicationId, appliedPayload }
 *   POST   { companyId, action:'rollback', applicationId, failureReason? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  approveOnboardingApplication,
  listOnboardingApplications,
  listOnboardingTemplates,
  markApplicationApplied,
  previewOnboardingApplication,
  rollbackOnboardingApplication,
  upsertOnboardingTemplate,
} from '../../../backend/services/enterpriseOnboardingService';
import {
  ONBOARDING_APPLICATION_STATUSES,
  ONBOARDING_TEMPLATE_KINDS,
  type OnboardingApplicationStatus,
  type OnboardingTemplateKind,
} from '../../../backend/types/enterpriseOnboarding';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.templates) {
      const kind = typeof req.query.templateKind === 'string' && ONBOARDING_TEMPLATE_KINDS.includes(req.query.templateKind as OnboardingTemplateKind) ? (req.query.templateKind as OnboardingTemplateKind) : undefined;
      const items = await listOnboardingTemplates(companyId, {
        templateKind: kind,
        industry: typeof req.query.industry === 'string' ? req.query.industry : undefined,
      });
      return res.status(200).json({ items, total: items.length });
    }
    const status = typeof req.query.status === 'string' && ONBOARDING_APPLICATION_STATUSES.includes(req.query.status as OnboardingApplicationStatus) ? (req.query.status as OnboardingApplicationStatus) : undefined;
    const items = await listOnboardingApplications(companyId, { status });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[enterprise-onboarding GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load onboarding' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['upsert_template', 'preview', 'approve', 'apply', 'rollback'].includes(action)) {
    return res.status(400).json({ error: 'companyId and valid action required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'upsert_template') {
      const templateKind = ONBOARDING_TEMPLATE_KINDS.includes(body.templateKind as OnboardingTemplateKind) ? (body.templateKind as OnboardingTemplateKind) : null;
      if (!templateKind) return res.status(400).json({ error: 'valid templateKind required' });
      const template = await upsertOnboardingTemplate({
        organizationId: companyId,
        id: typeof body.id === 'string' ? body.id : undefined,
        templateKind,
        name: String(body.name ?? ''),
        industry: typeof body.industry === 'string' ? body.industry : null,
        description: typeof body.description === 'string' ? body.description : null,
        payload: (body.payload as Record<string, unknown>) ?? {},
        recommendedExplanation: typeof body.recommendedExplanation === 'string' ? body.recommendedExplanation : null,
        shared: Boolean(body.shared),
        ownerUserId: ctx.userId,
      });
      return res.status(200).json({ ok: true, template });
    }
    if (action === 'preview') {
      const templateKind = ONBOARDING_TEMPLATE_KINDS.includes(body.templateKind as OnboardingTemplateKind) ? (body.templateKind as OnboardingTemplateKind) : null;
      if (!templateKind) return res.status(400).json({ error: 'valid templateKind required' });
      const app = await previewOnboardingApplication({
        organizationId: companyId,
        templateId: typeof body.templateId === 'string' ? body.templateId : null,
        templateKind,
        previewPayload: (body.previewPayload as Record<string, unknown>) ?? {},
        createdBy: ctx.userId,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, application: app });
    }
    if (action === 'approve') {
      const app = await approveOnboardingApplication({
        organizationId: companyId,
        applicationId: String(body.applicationId ?? ''),
        approverUserId: ctx.userId,
      });
      return res.status(200).json({ ok: true, application: app });
    }
    if (action === 'apply') {
      const app = await markApplicationApplied({
        organizationId: companyId,
        applicationId: String(body.applicationId ?? ''),
        appliedPayload: (body.appliedPayload as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, application: app });
    }
    const app = await rollbackOnboardingApplication({
      organizationId: companyId,
      applicationId: String(body.applicationId ?? ''),
      failureReason: typeof body.failureReason === 'string' ? body.failureReason : null,
    });
    return res.status(200).json({ ok: true, application: app });
  } catch (err: any) {
    console.error('[enterprise-onboarding POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'onboarding_action_failed' });
  }
}
