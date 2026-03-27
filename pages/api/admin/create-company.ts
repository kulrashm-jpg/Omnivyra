/**
 * POST /api/admin/create-company
 *
 * Protected endpoint. Creates a company + company_domains records.
 * Requires SUPER_ADMIN role.
 *
 * Body: { name: string, website?: string, industry?: string, domains?: string[] }
 * Auth: Bearer <supabase_access_token>
 * Returns: { companyId: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireSuperAdmin } from '../../../backend/middleware/authMiddleware';

type SuccessResponse = { companyId: string };
type ErrorResponse   = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Require SUPER_ADMIN ────────────────────────────────────────────────
  const authResult = await requireSuperAdmin(req, res);
  if (!authResult) return; // 401 or 403 already sent

  // ── 2. Parse and validate body ────────────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { name, website, industry, domains } = body as {
    name?: string;
    website?: string;
    industry?: string;
    domains?: string[];
  };

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  // ── 3. Extract domain from website if no explicit domains provided ────────
  const domainList: string[] = [];

  if (domains && Array.isArray(domains)) {
    for (const d of domains) {
      const cleaned = d.trim().toLowerCase();
      if (cleaned) domainList.push(cleaned);
    }
  } else if (website?.trim()) {
    try {
      const url = new URL(website.trim().startsWith('http') ? website.trim() : `https://${website.trim()}`);
      const host = url.hostname.replace(/^www\./, '');
      if (host) domainList.push(host);
    } catch {
      // Invalid URL — skip domain extraction
    }
  }

  // ── 4. Check for domain conflicts ────────────────────────────────────────
  if (domainList.length > 0) {
    const { data: existingDomains } = await supabase
      .from('company_domains')
      .select('domain, company_id')
      .in('domain', domainList);

    if (existingDomains && existingDomains.length > 0) {
      const conflicts = (existingDomains as any[]).map((d) => d.domain);
      return res.status(409).json({
        error: `Domain(s) already assigned to another company: ${conflicts.join(', ')}`,
        code: 'DOMAIN_CONFLICT',
      });
    }
  }

  // ── 5. Create company ────────────────────────────────────────────────────
  const websiteDomain = domainList[0] ?? null;

  const { data: company, error: insertErr } = await supabase
    .from('companies')
    .insert({
      name:           name.trim(),
      website:        website?.trim() || null,
      website_domain: websiteDomain,
      industry:       industry?.trim() || null,
      status:         'active',
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('[admin/create-company] insert error:', insertErr.message);
    return res.status(500).json({ error: 'Failed to create company' });
  }

  const companyId = (company as any).id;

  // ── 6. Create company_domains records ─────────────────────────────────────
  if (domainList.length > 0) {
    const domainRows = domainList.map((domain, index) => ({
      company_id: companyId,
      domain,
      is_primary: index === 0,
      verified:   true,
    }));

    const { error: domainErr } = await supabase
      .from('company_domains')
      .insert(domainRows);

    if (domainErr) {
      console.error('[admin/create-company] domain insert error:', domainErr.message);
      // Company was created — log the domain error but don't fail the whole request
    }
  }

  return res.status(201).json({ companyId });
}
