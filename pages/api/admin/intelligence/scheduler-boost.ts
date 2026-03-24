/**
 * POST /api/admin/intelligence/scheduler-boost
 *
 * Apply or remove a new-account boost for a company.
 *
 * Body:
 * {
 *   company_id:      string,
 *   action:          'apply' | 'remove',
 *   duration_hours?: number,   // default 48 — only for action=apply
 *   job_types?:      string[], // default = all job types
 * }
 *
 * Auth: super_admin_session cookie
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import {
  getAllGlobalConfigs,
  applyNewAccountBoost,
  upsertCompanyOverride,
  getCompanyOverride,
} from '../../../../backend/services/intelligenceConfigService';

function isSuperAdmin(req: NextApiRequest): boolean {
  return req.cookies?.super_admin_session === '1';
}

async function resolveUser(req: NextApiRequest): Promise<string> {
  const { getSupabaseUserFromRequest } = await import('../../../../backend/services/supabaseAuthService');
  const { user } = await getSupabaseUserFromRequest(req);
  return user?.email ?? user?.id ?? 'super_admin';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id, action, duration_hours = 48, job_types } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (action !== 'apply' && action !== 'remove') {
    return res.status(400).json({ error: 'action must be "apply" or "remove"' });
  }

  const updatedBy = await resolveUser(req);

  try {
    if (action === 'apply') {
      const hours = Math.min(168, Math.max(1, Number(duration_hours) || 48)); // cap at 1 week

      if (Array.isArray(job_types) && job_types.length > 0) {
        // Selective boost — only specified job types
        const globals = await getAllGlobalConfigs();
        const boostUntil = new Date(Date.now() + hours * 3_600_000).toISOString();

        await Promise.all(
          job_types.map(async (jt: string) => {
            const global = globals.find(g => g.job_type === jt);
            if (!global) return;
            await upsertCompanyOverride(company_id, jt, {
              boost_until:             boostUntil,
              boost_priority:          1,
              boost_frequency_minutes: Math.max(5, Math.floor(global.frequency_minutes / 2)),
              reason:                  `Selective boost — ${hours}h (applied by ${updatedBy})`,
            }, updatedBy);
          }),
        );
      } else {
        // Full boost — all job types
        await applyNewAccountBoost(company_id, updatedBy, hours);
      }

      return res.status(200).json({
        ok:          true,
        action:      'applied',
        duration_h:  hours,
        expires_at:  new Date(Date.now() + hours * 3_600_000).toISOString(),
      });
    }

    // action === 'remove' — clear boost fields
    const targets = Array.isArray(job_types) && job_types.length > 0
      ? job_types as string[]
      : (await getAllGlobalConfigs()).map(g => g.job_type);

    await Promise.all(
      targets.map(async (jt: string) => {
        const existing = await getCompanyOverride(company_id, jt);
        if (!existing) return;
        // Clear boost fields only — leave other overrides intact
        await upsertCompanyOverride(company_id, jt, {
          boost_until:             null,
          boost_priority:          null,
          boost_frequency_minutes: null,
        }, updatedBy);
      }),
    );

    return res.status(200).json({ ok: true, action: 'removed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Boost operation failed' });
  }
}
