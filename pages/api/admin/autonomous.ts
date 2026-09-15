import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET  /api/admin/autonomous?company_id=   — get autonomous settings
 * POST /api/admin/autonomous               — update autonomous settings
 *
 * Auth: requireAuth + requireCompanyAccess (company membership required);
 *       POST additionally requires COMPANY_ADMIN (or platform super admin).
 *
 * Controls:
 *   autonomous_mode    boolean   — enable/disable self-driving mode
 *   approval_required  boolean   — require human sign-off before campaign activates
 *   risk_tolerance     string    — 'aggressive' | 'balanced' | 'conservative'
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireAuth, requireCompanyAccess } from '@/backend/middleware/authMiddleware';
import { logDecision } from '@/backend/services/autonomousDecisionLogger';
import { getUserRole, isPlatformSuperAdmin, Role } from '@/backend/services/rbacService';

const VALID_RISK = new Set(['aggressive', 'balanced', 'conservative']);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth(req, res);
  if (!auth) return;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const companyId = req.query.company_id as string;

    const allowed = await requireCompanyAccess(auth.user.id, companyId, res);
    if (!allowed) return;

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

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const { company_id, autonomous_mode, approval_required, risk_tolerance } = body as {
      company_id?: string;
      autonomous_mode?: boolean;
      approval_required?: boolean;
      risk_tolerance?: string;
    };

    const allowed = await requireCompanyAccess(auth.user.id, company_id, res);
    if (!allowed) return;

    // SEC-91 W2-A (STEP 3AH-91, W2A-1) — changing autonomous settings is a
    // company-admin action. Membership alone used to be enough, so a VIEW_ONLY
    // member could switch on self-driving mode and turn off approvals, after
    // which the autonomous scheduler generates AND auto-activates campaigns for
    // the whole company. The policy is the repository's own: the settings UI
    // (components/admin/AutonomousControlPanel) exists to let COMPANY ADMINS
    // toggle it, and what it drives — CAMPAIGN_EXECUTE / AUTOMATION_EXECUTE —
    // are admin-only capabilities (capabilityRegistry). Platform super admins
    // keep their override. Reading the settings (GET) stays membership-only.
    const [platformAdmin, companyRole] = await Promise.all([
      isPlatformSuperAdmin(auth.user.id),
      getUserRole(auth.user.id, company_id as string),
    ]);
    const isCompanyAdmin =
      companyRole.role === Role.COMPANY_ADMIN || companyRole.role === Role.SUPER_ADMIN;
    if (!platformAdmin && !isCompanyAdmin) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE', code: 'FORBIDDEN_ROLE' });
    }

    if (risk_tolerance !== undefined && !VALID_RISK.has(risk_tolerance)) {
      return res.status(400).json({ error: `risk_tolerance must be one of: ${[...VALID_RISK].join(', ')}` });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (autonomous_mode   !== undefined) updates.autonomous_mode   = autonomous_mode;
    if (approval_required !== undefined) updates.approval_required = approval_required;
    if (risk_tolerance    !== undefined) updates.risk_tolerance    = risk_tolerance;

    // Single upsert — eliminates the read-then-write race condition
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/autonomous' });
