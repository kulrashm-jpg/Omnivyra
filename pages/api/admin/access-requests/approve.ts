/**
 * POST /api/admin/access-requests/approve
 *
 * Super-admin only. Approves an access request:
 *  1. Updates request status → approved
 *  2. Adds domain to domain_whitelist
 *  3. Optionally grants credits to the user's org
 *  4. Invalidates domain eligibility cache
 *
 * Body: { requestId: string, creditsToGrant?: number, whitelistDomain?: boolean, adminNote?: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { invalidateDomainCache } from '@/backend/services/domainEligibilityService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.is_super_admin) return res.status(403).json({ error: 'Forbidden' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { requestId, creditsToGrant = 0, whitelistDomain = true, adminNote } = body as {
    requestId: string;
    creditsToGrant?: number;
    whitelistDomain?: boolean;
    adminNote?: string;
  };

  if (!requestId) return res.status(400).json({ error: 'requestId is required' });

  // Fetch the request
  const { data: request, error: fetchErr } = await supabase
    .from('access_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (fetchErr || !request) return res.status(404).json({ error: 'Access request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: `Request is already ${request.status}` });

  // 1. Update status
  await supabase
    .from('access_requests')
    .update({
      status: 'approved',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      admin_note: adminNote ?? null,
      credits_granted_amount: creditsToGrant > 0 ? creditsToGrant : null,
    })
    .eq('id', requestId);

  // 2. Whitelist domain
  if (whitelistDomain && request.domain) {
    await supabase.from('domain_whitelist').upsert({
      domain: request.domain,
      added_by: user.id,
      reason: adminNote ?? `Approved access request ${requestId}`,
    }, { onConflict: 'domain' });

    await invalidateDomainCache(request.domain);
  }

  // 3. Grant credits if requested
  if (creditsToGrant > 0 && request.organization_id) {
    const { error: creditErr } = await supabase.rpc('apply_credit_transaction', {
      p_organization_id:  request.organization_id,
      p_transaction_type: 'purchase',
      p_credits_delta:    creditsToGrant,
      p_usd_equivalent:   null,
      p_reference_type:   'free_credits',
      p_reference_id:     requestId,
      p_note:             `Access request approved — ${creditsToGrant} credits granted`,
      p_performed_by:     user.id,
    });
    if (creditErr) {
      console.error('[access-requests/approve] credit grant failed:', creditErr.message);
    }
  }

  return res.status(200).json({ success: true, requestId });
}
