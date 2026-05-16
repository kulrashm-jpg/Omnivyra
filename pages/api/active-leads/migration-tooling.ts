/**
 * Phase 11 — Migration tooling endpoint.
 *
 *   GET    ?companyId=...
 *
 *   POST   { companyId, action:'preview',    migrationKind, migrationIdentifier, metadata? }
 *   POST   { companyId, action:'transition', migrationId, newStatus, detail? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  listMigrationDryRuns,
  previewMigration,
  transitionMigration,
} from '../../../backend/services/migrationDryRunService';
import {
  MIGRATION_DRY_RUN_KINDS,
  MIGRATION_DRY_RUN_STATUSES,
  type MigrationDryRunKind,
  type MigrationDryRunStatus,
} from '../../../backend/types/migrationDryRun';

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
    const items = await listMigrationDryRuns(companyId, {
      migrationKind: typeof req.query.migrationKind === 'string' && MIGRATION_DRY_RUN_KINDS.includes(req.query.migrationKind as MigrationDryRunKind) ? (req.query.migrationKind as MigrationDryRunKind) : undefined,
      status: typeof req.query.status === 'string' && MIGRATION_DRY_RUN_STATUSES.includes(req.query.status as MigrationDryRunStatus) ? (req.query.status as MigrationDryRunStatus) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[migration-tooling GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load migration dry-runs' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['preview', 'transition'].includes(action)) {
    return res.status(400).json({ error: 'companyId and action ∈ preview|transition required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'preview') {
      const migrationKind = MIGRATION_DRY_RUN_KINDS.includes(body.migrationKind as MigrationDryRunKind) ? (body.migrationKind as MigrationDryRunKind) : null;
      if (!migrationKind) return res.status(400).json({ error: 'valid migrationKind required' });
      const dryRun = await previewMigration({
        organizationId: companyId,
        migrationKind,
        migrationIdentifier: String(body.migrationIdentifier ?? ''),
        requestedBy: ctx.userId,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, dryRun });
    }
    const newStatus = MIGRATION_DRY_RUN_STATUSES.includes(body.newStatus as MigrationDryRunStatus) ? (body.newStatus as MigrationDryRunStatus) : null;
    if (!newStatus) return res.status(400).json({ error: 'valid newStatus required' });
    const dryRun = await transitionMigration({
      organizationId: companyId,
      migrationId: String(body.migrationId ?? ''),
      newStatus,
      detail: typeof body.detail === 'string' ? body.detail : undefined,
      actorUserId: ctx.userId,
    });
    return res.status(200).json({ ok: true, dryRun });
  } catch (err: any) {
    console.error('[migration-tooling POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'migration_action_failed' });
  }
}
