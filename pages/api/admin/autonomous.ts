
/**
 * GET  /api/admin/autonomous?company_id=   â€” get autonomous settings
 * POST /api/admin/autonomous               â€” update autonomous settings
 *
 * Auth: requireAuth + requireCompanyAccess (company membership required)
 *
 * Controls:
 *   autonomous_mode    boolean   â€” enable/disable self-driving mode
 *   approval_required  boolean   â€” require human sign-off before campaign activates
 *   risk_tolerance     string    â€” 'aggressive' | 'balanced' | 'conservative'
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '@/backend/services/requestAccessService';
import { logDecision } from '@/backend/services/autonomousDecisionLogger';

const VALID_RISK = new Set(['aggressive', 'balanced', 'conservative']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // â”€â”€ GET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    const companyId = req.query.company_id as string;

    const ctx = await requireAdminScope(req, res, 'autonomous:decisions', { companyId });
    if (!ctx) return;
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ADMIN_SCOPE]', '/api/admin/autonomous', 'autonomous:decisions');
    }
    const auth = { user: { id: ctx.id, email: ctx.email ?? null } };

    const { data } = await supabase
      .from('company_settings')
      .select('autonomous_mode, approval_required, risk_tolerance')
      .eq('company_id', companyId)
      .maybeSingle();

    return res.status(200).json({
      success: true,
      data: {
        autonomous_mode:   (data as any)?.autonomous_mode   ?? false,
        approval_required: (data as any)?.approval_required ?? true,
        risk_tolerance:    (data as any)?.risk_tolerance    ?? 'balanced',
      },
    });
  }

  // â”€â”€ POST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const { company_id, autonomous_mode, approval_required, risk_tolerance } = body as {
      company_id?: string;
      autonomous_mode?: boolean;
      approval_required?: boolean;
      risk_tolerance?: string;
    };

    const ctx = await requireAdminScope(req, res, 'autonomous:decisions', { companyId: company_id });
    if (!ctx) return;
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ADMIN_SCOPE]', '/api/admin/autonomous', 'autonomous:decisions');
    }
    const auth = { user: { id: ctx.id, email: ctx.email ?? null } };

    if (risk_tolerance !== undefined && !VALID_RISK.has(risk_tolerance)) {
      return res.status(400).json({ error: `risk_tolerance must be one of: ${[...VALID_RISK].join(', ')}` });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (autonomous_mode   !== undefined) updates.autonomous_mode   = autonomous_mode;
    if (approval_required !== undefined) updates.approval_required = approval_required;
    if (risk_tolerance    !== undefined) updates.risk_tolerance    = risk_tolerance;

    // Single upsert â€” eliminates the read-then-write race condition
    const { error: upsertError } = await supabase
      .from('company_settings')
      .upsert({ company_id, ...updates }, { onConflict: 'company_id' });

    if (upsertError) return res.status(500).json({ error: upsertError.message });

    await logDecision({
      company_id:    company_id!,
      decision_type: autonomous_mode ? 'auto_activate' : 'pause',
      reason:        `Autonomous settings updated by ${auth.user.email ?? auth.user.id}`,
      metrics_used:  { ...updates, performed_by: auth.user.id },
    });

    return res.status(200).json({ success: true, data: updates });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
