
/**
 * GET /api/command-center/company-state
 *
 * Fetches real company setup state for Command Center state computation.
 * Used to determine:
 * - Whether user has created blogs
 * - Whether user has active social integrations
 * - Whether company has website URL
 * - Whether a report has been generated
 *
 * Returns JSON with flags for each setup requirement.
 * Auth: Supabase access token in Authorization: Bearer <token>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getSupabaseBrowser } from '../../../lib/supabaseBrowser';

export interface CompanySetupState {
  hasBlogsCreated: boolean;
  hasSocialLinked: boolean;
  hasWebsiteUrl: boolean;
  hasReportGenerated: boolean;
  hasReportGenerating: boolean;
  blogCount: number;
  socialIntegrationCount: number;
  lastReportAt?: string;
}

type SuccessResponse = {
  success: true;
  data: CompanySetupState;
};

type ErrorResponse = {
  error: string;
  code?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  // ── 1. Verify user is authenticated ───────────────────────────────────────
  const { user, error: userErr } = await getSupabaseUserFromRequest(req);

  if (userErr || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'INVALID_SESSION' });
  }

  try {
    const supabase = getSupabaseBrowser();

    // ── 2. Get user's selected company ID from request ──────────────────────
    const companyId = (req.query.company_id as string) || '';
    if (!companyId) {
      return res.status(400).json({
        error: 'company_id query parameter required',
        code: 'MISSING_COMPANY_ID',
      });
    }

    // ── 3. Check if user has access to this company ────────────────────────
    const { data: roleData } = await supabase
      .from('user_company_roles')
      .select('id')
      .eq('user_id', user.id)
      .eq('company_id', companyId)
      .eq('status', 'active')
      .maybeSingle();

    if (!roleData) {
      return res.status(403).json({
        error: 'Access denied',
        code: 'ACCESS_DENIED',
      });
    }

    // ── 4. Fetch company setup state ──────────────────────────────────────

    // Check blogs created by this user for this company
    const { data: blogData, error: blogErr } = await supabase
      .from('posts')
      .select('id', { count: 'exact' })
      .eq('created_by_user_id', user.id)
      .eq('company_id', companyId)
      .eq('type', 'article');

    // Check company website URL
    const { data: companyData, error: companyErr } = await supabase
      .from('companies')
      .select('website_url, id')
      .eq('id', companyId)
      .maybeSingle();

    // Check active social integrations for this company
    const { data: socialAccounts, error: socialErr } = await supabase
      .from('social_accounts')
      .select('id, is_active, platform')
      .eq('company_id', companyId)
      .eq('is_active', true);

    // Check if company has generated a report
    const { data: latestReport, error: reportErr } = await supabase
      .from('reports')
      .select('id, created_at, status')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── 5. Build response ────────────────────────────────────────────────
    const state: CompanySetupState = {
      hasBlogsCreated: blogData && blogData.length > 0,
      hasSocialLinked: socialAccounts && socialAccounts.length > 0,
      hasWebsiteUrl: !!companyData?.website_url,
      hasReportGenerated: !!latestReport,
      hasReportGenerating: latestReport?.status === 'generating',
      blogCount: blogData?.length ?? 0,
      socialIntegrationCount: socialAccounts?.length ?? 0,
      lastReportAt: latestReport?.created_at,
    };

    return res.status(200).json({
      success: true,
      data: state,
    });
  } catch (err) {
    console.error('[command-center/company-state] error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'SERVER_ERROR',
    });
  }
}
