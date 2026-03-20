/**
 * GET  /api/admin/config/:type  — read config
 * POST /api/admin/config/:type  — update config (with audit log)
 *
 * :type = decision_engine_config | content_validation_config |
 *         platform_rules_config | tone_config | experiment_config | prediction_config
 *
 * Auth: super_admin_session cookie OR Authorization Bearer (super admin JWT)
 * Returns: { success, data } or { success, error }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import {
  updateConfig,
  rollbackConfig,
  invalidateConfigCache,
  type ConfigUpdateInput,
} from '@/backend/services/configService';

const VALID_TYPES = new Set([
  'decision_engine_config',
  'content_validation_config',
  'platform_rules_config',
  'tone_config',
  'experiment_config',
  'prediction_config',
]);

function isSuperAdmin(req: NextApiRequest): boolean {
  return req.cookies?.super_admin_session === '1';
}

async function resolveChangedBy(req: NextApiRequest): Promise<string> {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return 'super_admin';
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    return user?.email ?? user?.id ?? 'super_admin';
  } catch {
    return 'super_admin';
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Super admin access required' });
  }

  const { type } = req.query;
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    return res.status(400).json({
      success: false,
      error: `Invalid config type. Valid: ${[...VALID_TYPES].join(', ')}`,
    });
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from(type)
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, data: data ?? [] });
    } catch (err: unknown) {
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── POST — update config ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Rollback shortcut: { rollback_log_id: "<uuid>" }
    if (body?.rollback_log_id) {
      const changedBy = await resolveChangedBy(req);
      const result = await rollbackConfig(String(body.rollback_log_id), changedBy);
      if (!result.ok) return res.status(400).json({ success: false, error: result.error });
      invalidateConfigCache(type);
      return res.status(200).json({ success: true, message: 'Rollback applied' });
    }

    if (!body || typeof body !== 'object') {
      return res.status(400).json({ success: false, error: 'Request body must be a JSON object' });
    }

    const changedBy = await resolveChangedBy(req);
    const result = await updateConfig({
      config_type: type as ConfigUpdateInput['config_type'],
      payload: body as Record<string, unknown>,
      changed_by: changedBy,
      note: typeof body._note === 'string' ? body._note : undefined,
    });

    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    return res.status(200).json({ success: true, message: `${type} updated` });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
