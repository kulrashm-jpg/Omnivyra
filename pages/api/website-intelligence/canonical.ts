import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getWebsiteSnapshot } from '../../../backend/services/websiteIntelligence/websiteIntelligenceRepository';
import { supabase } from '../../../backend/db/supabaseClient';
import { normalizeCompanyDomain } from '../../../lib/shared/domain/companyDomain';
import { checkEmailAuth } from '../../../backend/services/emailAuthService';

/**
 * GET /api/website-intelligence/canonical — the single read surface for the
 * canonical Website Intelligence Repository. Returns the full website intelligence
 * snapshot (health, readiness, tracking, signals, integrations, diagnostics, domain,
 * modules + freshness, recommendations, validation, summary). The repository owns all
 * composition; this route only authorises + delegates.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  const websiteId = typeof req.query.website_id === 'string' ? req.query.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const snapshot = await getWebsiteSnapshot(companyId, websiteId);
    // Domain soft-verify: signing up with a work email at your own domain proves ownership.
    // If the account's email domain matches the website domain, surface it so the readiness
    // domain-verification factor credits it. Best-effort — never blocks the snapshot.
    try {
      const { data: company } = await supabase
        .from('companies')
        .select('admin_email_domain, website_domain, website')
        .eq('id', companyId)
        .maybeSingle();
      const adminDom = normalizeCompanyDomain(String(company?.admin_email_domain ?? ''));
      const siteDom = normalizeCompanyDomain(String(company?.website_domain ?? '')) ||
        normalizeCompanyDomain(String(company?.website ?? ''));
      if (adminDom && siteDom && adminDom === siteDom) {
        const snap = snapshot as unknown as { domain: Record<string, unknown> | null };
        if (snap.domain) snap.domain.emailDomainMatch = true;
        else snap.domain = { emailDomainMatch: true };
      }
      // Canonical email-authentication signal — SPF + DMARC on the sending domain, read from
      // DNS. Surfaced so the readiness Trust → Email authentication factor can score it.
      const authDomain = siteDom || adminDom;
      if (authDomain) {
        const emailAuth = await checkEmailAuth(authDomain);
        (snapshot as unknown as { emailAuth?: unknown }).emailAuth = emailAuth;
      }
    } catch { /* soft-verify + email-auth are best-effort */ }
    return res.status(200).json({ snapshot });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load website intelligence' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/canonical' });
