
/**
 * GET    /api/admin/intelligence/scheduler-overrides?company_id=xxx
 *   Returns all overrides for a company + resolved effective config per job.
 *
 * POST   /api/admin/intelligence/scheduler-overrides
 *   Body: { company_id, job_type, ...override_fields }
 *   Upserts an override for a company+job_type.
 *
 * DELETE /api/admin/intelligence/scheduler-overrides
 *   Body: { company_id, job_type }
 *   Removes the override (company falls back to global).
 *
 * Auth: super_admin_session cookie
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import {
  getAllGlobalConfigs,
  getCompanyOverrides,
  upsertCompanyOverride,
  deleteCompanyOverride,
  resolveConfig,
  type GlobalConfig,
  type CompanyOverride,
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

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : null;
    if (!companyId) return res.status(400).json({ error: 'company_id required' });

    try {
      const [globals, overrides] = await Promise.all([
        getAllGlobalConfigs(),
        getCompanyOverrides(companyId),
      ]);

      const overrideMap = new Map<string, CompanyOverride>(
        overrides.map(o => [o.job_type, o]),
      );

      const resolved = globals.map(g => ({
        ...resolveConfig(g as GlobalConfig, overrideMap.get(g.job_type) ?? null),
        override: overrideMap.get(g.job_type) ?? null,
        global:   g,
      }));

      return res.status(200).json({ company_id: companyId, jobs: resolved });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load overrides' });
    }
  }

  // ── POST — upsert override ────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { company_id, job_type, ...rest } = req.body ?? {};

    if (!company_id || typeof company_id !== 'string') {
      return res.status(400).json({ error: 'company_id required' });
    }
    if (!job_type || typeof job_type !== 'string') {
      return res.status(400).json({ error: 'job_type required' });
    }

    const ALLOWED = new Set([
      'priority', 'frequency_minutes', 'enabled',
      'max_concurrent', 'timeout_seconds', 'retry_count', 'model', 'reason',
      'boost_until', 'boost_priority', 'boost_frequency_minutes',
    ]);
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest as Record<string, unknown>)) {
      if (ALLOWED.has(k)) fields[k] = v;
    }
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'No valid override fields provided' });
    }

    try {
      const updatedBy = await resolveUser(req);
      const override = await upsertCompanyOverride(company_id, job_type, fields as Parameters<typeof upsertCompanyOverride>[2], updatedBy);
      return res.status(200).json({ override });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Upsert failed' });
    }
  }

  // ── DELETE — remove override ──────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { company_id, job_type } = req.body ?? {};

    if (!company_id || !job_type) {
      return res.status(400).json({ error: 'company_id and job_type required' });
    }

    try {
      await deleteCompanyOverride(company_id, job_type);
      return res.status(200).json({ deleted: true });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
