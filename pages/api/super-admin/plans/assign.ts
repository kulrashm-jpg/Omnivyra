import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { createCredit, makeIdempotencyKey } from '../../../../backend/services/creditExecutionService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'plans:assign');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/plans/assign', 'plans:assign');
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const organizationId = body.organization_id ?? body.organizationId;
  const planKey = body.plan_key ?? body.planKey;

  if (!organizationId || !planKey) {
    return res.status(400).json({ error: 'organization_id and plan_key are required' });
  }

  try {
    const { data: plan, error: planErr } = await supabase
      .from('pricing_plans')
      .select('id, credits_included, validity_days')
      .eq('plan_key', planKey)
      .eq('is_active', true)
      .maybeSingle();

    if (planErr || !plan?.id) {
      return res.status(400).json({ error: 'Plan not found or inactive' });
    }

    const { error: upsertErr } = await supabase.from('organization_plan_assignments').upsert(
      {
        organization_id: organizationId,
        plan_id:         plan.id,
        assigned_at:     new Date().toISOString(),
        assigned_by:     null,
      },
      { onConflict: 'organization_id' }
    );

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });

    // â”€â”€ STEP 5: Grant plan credits if plan includes them â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Idempotent on (orgId, planId) â€” re-assigning the same plan is a no-op.
    // Upgrading to a different plan uses a different planId â†’ new grant.
    const creditsIncluded = (plan as any).credits_included ?? 0;
    let creditsGranted = 0;
    if (creditsIncluded > 0) {
      try {
        await createCredit({
          orgId:          organizationId,
          amount:         creditsIncluded,
          category:       'paid',
          referenceType:  'plan_assignment',
          referenceId:    plan.id,
          note:           `Plan credits â€” ${planKey} (${creditsIncluded} credits included)`,
          performedBy:    organizationId,
          idempotencyKey: makeIdempotencyKey(organizationId, 'plan_credit_grant', plan.id),
        });
        creditsGranted = creditsIncluded;
      } catch (creditErr: any) {
        // Non-fatal â€” assignment succeeded; credit grant may already exist (idempotent key)
        console.warn('[plans/assign] credit grant skipped or already done:', creditErr.message);
      }
    }

    return res.status(200).json({
      success:         true,
      organization_id: organizationId,
      plan_key:        planKey,
      credits_granted: creditsGranted,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
