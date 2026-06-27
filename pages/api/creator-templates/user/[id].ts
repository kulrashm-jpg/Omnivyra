import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import {
  getUserTemplate,
  updateUserTemplate,
  listUserTemplateVersions,
  restoreUserTemplateVersion,
  publishUserTemplate,
  archiveUserTemplate,
  resolveRole,
  getUserTemplateCompanyId,
} from '../../../../backend/services/creator/userTemplateService';

/**
 * GET    /api/creator-templates/user/:id          — one template (?include=versions adds history)
 * PATCH  /api/creator-templates/user/:id          — edit (whitelisted props only) → new version
 * POST   /api/creator-templates/user/:id          — { action: 'publish' | 'restore' | 'archive', ... }
 *
 * Only owner/editor may modify; system templates are never editable (they don't
 * resolve here). Publish is gated on the deterministic diagnostic report.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ error: 'template id required' });

  // Tenant boundary: authorize on the template's OWNING company before any read
  // or write. Ownership (owner vs editor) is then enforced via resolveRole below.
  const companyId = await getUserTemplateCompanyId(id);
  if (!companyId) return res.status(404).json({ error: 'template not found' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const template = await getUserTemplate(id);
    if (!template) return res.status(404).json({ error: 'template not found' });
    if (req.query.include === 'versions') {
      const versions = await listUserTemplateVersions(id);
      return res.status(200).json({ template, versions });
    }
    return res.status(200).json({ template });
  }

  const role = await resolveRole({ templateId: id, userId: user.userId });

  if (req.method === 'PATCH') {
    const edits = ((req.body || {}) as Record<string, unknown>).edits;
    if (!edits || typeof edits !== 'object') return res.status(400).json({ error: 'edits object required' });
    const updated = await updateUserTemplate({ id, edits: edits as Record<string, unknown>, role, actorUserId: user.userId });
    if (!updated) return res.status(403).json({ error: 'Not permitted or update failed' });
    return res.status(200).json({ template: updated });
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Record<string, unknown>;
    const action = String(body.action || '');
    if (action === 'publish') {
      const { template, gate } = await publishUserTemplate({ id, diagnostic: body.diagnostic, role, actorUserId: user.userId });
      if (!gate.ok) return res.status(422).json({ error: 'Publish blocked', gate });
      return res.status(200).json({ template, gate });
    }
    if (action === 'restore') {
      const version = Number(body.version);
      if (!Number.isInteger(version)) return res.status(400).json({ error: 'version required' });
      const restored = await restoreUserTemplateVersion({ id, version, role, actorUserId: user.userId });
      if (!restored) return res.status(403).json({ error: 'Not permitted or restore failed' });
      return res.status(200).json({ template: restored });
    }
    if (action === 'archive') {
      const archived = await archiveUserTemplate({ id, role, actorUserId: user.userId });
      if (!archived) return res.status(403).json({ error: 'Not permitted or archive failed' });
      return res.status(200).json({ template: archived });
    }
    return res.status(400).json({ error: 'unknown action' });
  }

  res.setHeader('Allow', 'GET, PATCH, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
