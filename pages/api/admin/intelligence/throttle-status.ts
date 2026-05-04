
/**
 * GET  /api/admin/intelligence/throttle-status
 *   Returns current system load + throttle config + live throttle level.
 *
 * PUT  /api/admin/intelligence/throttle-status
 *   Body: { cpu_medium_threshold?, cpu_high_threshold?, queue_medium_threshold?,
 *           queue_high_threshold?, enabled? }
 *   Updates the singleton intelligence_throttle_config row.
 *
 * Auth: super_admin_session cookie
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import {
  getSystemThrottleLevel,
  invalidateThrottleCache,
} from '../../../../backend/services/intelligenceHealthService';

const ALLOWED_FIELDS = new Set([
  'cpu_medium_threshold',
  'cpu_high_threshold',
  'queue_medium_threshold',
  'queue_high_threshold',
  'enabled',
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireAdminScope(req, res, 'intelligence:throttle-status');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/intelligence/throttle-status', 'intelligence:throttle-status');
  }

  // â”€â”€ GET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    try {
      const load = await getSystemThrottleLevel();
      return res.status(200).json(load);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read system load' });
    }
  }

  // â”€â”€ PUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'PUT') {
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(k)) updates[k] = v;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    try {
      const { error } = await supabase
        .from('intelligence_throttle_config')
        .update({ ...updates, updated_at: new Date().toISOString(), updated_by: 'super_admin' })
        .eq('id', 1);

      if (error) throw new Error(error.message);

      invalidateThrottleCache();

      // Return updated system load immediately
      const load = await getSystemThrottleLevel();
      return res.status(200).json(load);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
