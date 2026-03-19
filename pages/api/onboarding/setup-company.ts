/**
 * POST /api/onboarding/setup-company
 * Authorization: Bearer <supabase_access_token>
 *
 * Creates a company record + links the authenticated user as ADMIN.
 * Idempotent: if user already has a company, returns the existing one.
 *
 * Body: { companyName, website, industry, companySize }
 * Returns: { companyId }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

type Result = { companyId: string } | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    companyName = '',
    website     = '',
    industry    = '',
    companySize = '',
  } = body as {
    companyName?: string;
    website?: string;
    industry?: string;
    companySize?: string;
  };

  if (!companyName.trim()) return res.status(400).json({ error: 'companyName is required' });

  try {
    // ── 1. Check for existing company membership (idempotent) ────────────────
    const { data: existing } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existing?.company_id) {
      return res.status(200).json({ companyId: existing.company_id });
    }

    const companyId = randomUUID();
    const now = new Date().toISOString();

    // ── 2. Create companies row ───────────────────────────────────────────────
    const { error: companyErr } = await supabase.from('companies').insert({
      id:         companyId,
      name:       companyName.trim(),
      website:    website.trim() || null,
      status:     'active',
      created_at: now,
      updated_at: now,
    });
    if (companyErr) throw companyErr;

    // ── 3. Create user_company_roles row (owner / admin) ─────────────────────
    const { error: roleErr } = await supabase.from('user_company_roles').insert({
      user_id:    user.id,
      company_id: companyId,
      role:       'ADMIN',
      status:     'active',
      created_at: now,
      updated_at: now,
      invited_at: now,
    });
    if (roleErr) throw roleErr;

    // ── 4. Create company_profiles row ────────────────────────────────────────
    await supabase.from('company_profiles').insert({
      company_id:  companyId,
      name:        companyName.trim(),
      website_url: website.trim() || null,
      industry:    industry.trim() || null,
      geography:   companySize.trim() || null, // repurpose for team size hint
      created_at:  now,
      updated_at:  now,
    });
    // Non-fatal if profile insert fails — company + role are sufficient

    // ── 5. Update free_credit_profiles with org_id (if exists) ───────────────
    await supabase
      .from('free_credit_profiles')
      .update({ organization_id: companyId, updated_at: now })
      .eq('user_id', user.id);

    return res.status(200).json({ companyId });
  } catch (err: any) {
    console.error('[onboarding/setup-company]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
