/**
 * GET /api/reports/journey  (BETA-EVIDENCE-EXEC-003)
 *
 * The single canonical "where am I in the scan → evidence → report journey, and what do I do next?" surface.
 * Read-only. Composes existing signals via getReportJourney; NEVER triggers a scan or a report build.
 *
 * Every dashboard / company / website / report entry point can call this same endpoint, so guidance is
 * consistent by construction across the product.
 *
 * Auth: Supabase access token (mirrors /api/reports/readiness).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getReportJourney } from '../../../backend/services/canonicalReport/reportJourneyOrchestrator';

async function resolveCompanyId(userId: string, requestedCompanyId?: string): Promise<string | null> {
  if (requestedCompanyId) {
    const { data } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('company_id', requestedCompanyId)
      .eq('status', 'active')
      .maybeSingle();

    return data?.company_id ?? null;
  }

  const { data } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  return data?.company_id ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  try {
    const companyId = await resolveCompanyId(user.id, req.query.companyId as string | undefined);
    if (!companyId) {
      return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
    }

    const journey = await getReportJourney({ companyId });
    return res.status(200).json(journey);
  } catch (error) {
    console.error('[reports/journey] error:', error);
    return res.status(500).json({ error: 'Failed to load report journey', code: 'SERVER_ERROR' });
  }
}
