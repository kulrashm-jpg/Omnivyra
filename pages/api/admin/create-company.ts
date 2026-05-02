
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
import { saveDomainRecord } from '../../../backend/services/domainRecordService';

type SuccessResponse = { companyId: string };
type ErrorResponse   = { error: string; code?: string; details?: string; conflicts?: string[] };

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

  // ── 4. Pre-flight conflict check ─────────────────────────────────────────
  // saveDomainRecord enforces the same-company-only rule per row, but doing a
  // single bulk pre-check lets us reject the request BEFORE creating the
  // companies row — otherwise we'd leak orphan companies on conflict.
  // Reads final_domain (canonical) — legacy `domain` column is deprecated.
  if (domainList.length > 0) {
    const { data: existingDomains } = await supabase
      .from('company_domains')
      .select('final_domain, company_id')
      .in('final_domain', domainList);

    if (existingDomains && existingDomains.length > 0) {
      const conflicts = (existingDomains as any[]).map((d) => d.final_domain);
      return res.status(409).json({
        error: 'DOMAIN_ALREADY_REGISTERED',
        code: 'DOMAIN_ALREADY_REGISTERED',
        details: `Domain(s) already assigned to another company: ${conflicts.join(', ')}`,
        conflicts,
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

  // ── 6. Create company_domains records via the central writer ─────────────
  // saveDomainRecord owns: input/final domain split, override-reason
  // invariant, canonical-conflict probe, and same-company-only claim
  // semantics. Direct inserts are no longer permitted from this route.
  for (let i = 0; i < domainList.length; i += 1) {
    const d = domainList[i];
    const result = await saveDomainRecord({
      company_id:          companyId,
      input_domain:        d,
      final_domain:        d,
      redirect_chain:      null,
      is_forwarding:       false,
      verification_status: 'verified', // admin asserts the domain at create time
      created_via:         'admin',
      is_primary:          i === 0,
    });
    if (!result.ok) {
      console.error('[admin/create-company] saveDomainRecord error:', result.error, d);
      // Company was created — log the failure but don't roll back. The admin
      // can re-run the domain attach via the explicit reassign flow if needed.
    }
  }

  return res.status(201).json({ companyId });
}
