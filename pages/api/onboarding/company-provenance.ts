/**
 * GET /api/onboarding/company-provenance — field-level provenance for Company
 * Review (ONBOARD-001R §4).
 *
 * Returns, for each editable profile field, where its value came from
 * (System Discovered / AI Enriched / User Edited), its confidence, and why it
 * matters — so the existing profile form can annotate each field. Read-only.
 *
 * Auth: Bearer / Supabase cookie via the canonical resolver.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { buildOnboardingJourney } from '../../../backend/services/onboardingJourneyService';
import {
  getCompanyProfileProvenance,
  type CompanyProfileProvenance,
} from '../../../backend/services/companyProfileProvenanceService';

type ErrorResponse = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CompanyProfileProvenance | ErrorResponse>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);

  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    const status = authResult.error === 'ACCOUNT_DELETED' ? 403 : 401;
    return res.status(status).json({ error: authResult.error ?? 'Invalid session', code: authResult.error ?? undefined });
  }
  seedRequestContextFromRequest(req, { userId: authResult.user.id });

  // Company derived server-side (never trusted from the client).
  const journey = await buildOnboardingJourney(authResult.user.id);
  if (!journey.companyId) {
    return res.status(409).json({ error: 'No company yet.', code: 'NO_COMPANY' });
  }

  const provenance = await getCompanyProfileProvenance(journey.companyId);
  return res.status(200).json(provenance);
}
