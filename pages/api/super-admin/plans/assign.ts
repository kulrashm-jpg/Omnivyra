import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { createCredit, makeIdempotencyKey } from '../../../../backend/services/creditExecutionService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BILLING_PLAN_MANAGE } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Phase 2 mutation gate. Assigning a plan to an organization mints
  // billing-relevant credits and changes the org's monthly budget —
  // same blast radius as plan toggle / override.
  const guard = await requireCapability(req, res, {
    capability: BILLING_PLAN_MANAGE,
    reason: 'super-admin assigns plan to organization',
  });
  if (guard.ok !== true) return;

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

    // ── STEP 5: Grant plan credits if plan includes them ─────────────────────
    // Idempotent on (orgId, planId) — re-assigning the same plan is a no-op.
    // Upgrading to a different plan uses a different planId → new grant.
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
          note:           `Plan credits — ${planKey} (${creditsIncluded} credits included)`,
          performedBy:    organizationId,
          idempotencyKey: makeIdempotencyKey(organizationId, 'plan_credit_grant', plan.id),
        });
        creditsGranted = creditsIncluded;
      } catch (creditErr: any) {
        // Non-fatal — assignment succeeded; credit grant may already exist (idempotent key)
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/plans/assign' });
