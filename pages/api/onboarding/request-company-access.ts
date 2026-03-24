/**
 * POST /api/onboarding/request-company-access
 *
 * Called when a new user tries to sign up but their company already exists.
 * Stores an access request and notifies all COMPANY_ADMIN users of that org.
 *
 * Body: { companyId, fullName, department, email }
 * Auth: Bearer token (Supabase session)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { companyId, fullName, department, email } = body as {
    companyId:   string;
    fullName:    string;
    department?: string;
    email:       string;
  };

  if (!companyId)      return res.status(400).json({ error: 'companyId is required' });
  if (!fullName?.trim()) return res.status(400).json({ error: 'fullName is required' });
  if (!email?.trim())    return res.status(400).json({ error: 'email is required' });

  // Verify the company exists
  const { data: company } = await supabase
    .from('companies')
    .select('id, name')
    .eq('id', companyId)
    .maybeSingle();

  if (!company) return res.status(404).json({ error: 'Company not found' });

  // Idempotency: if a pending request already exists from this user for this company, skip insert
  const { data: existingReq } = await supabase
    .from('company_join_requests')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let requestId: string;

  if (existingReq && existingReq.status === 'pending') {
    requestId = existingReq.id;
  } else {
    const { data: newReq, error: insertErr } = await supabase
      .from('company_join_requests')
      .insert({
        user_id:    user.id,
        company_id: companyId,
        full_name:  fullName.trim(),
        department: department?.trim() || null,
        email:      email.trim().toLowerCase(),
        status:     'pending',
      })
      .select('id')
      .single();

    if (insertErr || !newReq) {
      console.error('[request-company-access] insert failed:', insertErr?.message);
      return res.status(500).json({ error: 'Failed to save request: ' + (insertErr?.message ?? 'unknown') });
    }
    requestId = newReq.id;
  }

  // Notify all COMPANY_ADMIN users of this org
  const { data: admins } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('role', 'COMPANY_ADMIN')
    .eq('status', 'active');

  if (admins && admins.length > 0) {
    const notifications = admins.map((a: any) => ({
      user_id: a.user_id,
      type:    'join_request',
      title:   'New access request',
      message: `${fullName.trim()} (${email.trim()})${department?.trim() ? ` from ${department.trim()}` : ''} is requesting access to ${company.name}.`,
      metadata: {
        request_id: requestId,
        requester_user_id:  user.id,
        requester_name:     fullName.trim(),
        requester_email:    email.trim(),
        requester_dept:     department?.trim() || null,
        company_id:         companyId,
        company_name:       company.name,
      },
      is_read: false,
    }));

    await supabase.from('notifications').insert(notifications).then(({ error: notifErr }) => {
      if (notifErr) console.warn('[request-company-access] notification insert failed:', notifErr.message);
    });
  }

  return res.status(200).json({ success: true, requestId });
}
