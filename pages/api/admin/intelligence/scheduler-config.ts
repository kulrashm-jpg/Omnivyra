
/**
 * GET  /api/admin/intelligence/scheduler-config
 *   Returns all global intelligence job configs + recent execution logs per job.
 *
 * PUT  /api/admin/intelligence/scheduler-config
 *   Body: { job_type, ...fields }
 *   Updates a single global config row.
 *
 * Auth: super_admin_session cookie (same as /api/admin/config/:type)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  getAllGlobalConfigs,
  updateGlobalConfig,
  getRecentExecutionLogs,
} from '../../../../backend/services/intelligenceConfigService';

import { requireAdminScope } from '../../../../backend/services/requestAccessService';

async function resolveUser(req: NextApiRequest): Promise<string> {
  const { getSupabaseUserFromRequest } = await import('../../../../backend/services/supabaseAuthService');
  const { user } = await getSupabaseUserFromRequest(req);
  return user?.email ?? user?.id ?? 'super_admin';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireAdminScope(req, res, 'intelligence:scheduler-config');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/intelligence/scheduler-config', 'intelligence:scheduler-config');
  }

  // â”€â”€ GET â€” full global config listing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    try {
      const [configs, logs] = await Promise.all([
        getAllGlobalConfigs(),
        getRecentExecutionLogs(undefined, undefined, 200),
      ]);

      // Attach last_run per job_type
      const lastRun = new Map<string, unknown>();
      for (const log of logs as Array<{ job_type: string; started_at: string; status: string; duration_ms: number | null }>) {
        if (!lastRun.has(log.job_type)) lastRun.set(log.job_type, log);
      }

      const enriched = configs.map(c => ({
        ...c,
        last_run: lastRun.get(c.job_type) ?? null,
      }));

      return res.status(200).json({ configs: enriched });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load configs' });
    }
  }

  // â”€â”€ PUT â€” update a single global config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'PUT') {
    const body = req.body ?? {};
    const { job_type, ...rest } = body as Record<string, unknown>;

    if (!job_type || typeof job_type !== 'string') {
      return res.status(400).json({ error: 'job_type required' });
    }

    // Whitelist updatable fields
    const ALLOWED = new Set([
      'priority', 'frequency_minutes', 'enabled',
      'max_concurrent', 'timeout_seconds', 'retry_count', 'model', 'description',
    ]);
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (ALLOWED.has(k)) updates[k] = v;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    try {
      const updatedBy = await resolveUser(req);
      const config = await updateGlobalConfig(job_type, updates as Parameters<typeof updateGlobalConfig>[1], updatedBy);
      return res.status(200).json({ config });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
