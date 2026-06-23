/**
 * GET /api/onboarding/validated-identity
 *
 * Returns the company identity that was validated ONCE at signup, for the
 * authenticated user. Onboarding consumes this to DISPLAY the website
 * (presentation-only) — it never re-derives identity from the email and never
 * lets the user type a different website.
 *
 * The website is resolved by the SAME shared function setup-company uses
 * (resolveValidatedWebsite), so what onboarding shows equals what gets
 * persisted on the company. No domain validation / probe happens here.
 *
 * Auth: Supabase token (Bearer header OR auth cookie).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import {
  deriveWebsiteFromEmail,
  resolveValidatedWebsite,
  type ValidatedWebsiteSource,
} from '../../../backend/services/validatedWebsiteService';
import { normalizeCompanyDomain } from '../../../lib/shared/domain/companyDomain';

type IdentityResponse = {
  websiteUrl: string | null;
  companyDomain: string | null;
  source: ValidatedWebsiteSource;
};
type ErrorResponse = { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<IdentityResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const email: string = authResult.user.email;

  const { canonicalWebsite, source } = await resolveValidatedWebsite(email, {
    emailDerived: deriveWebsiteFromEmail(email),
    userEntered:  '',
  });

  return res.status(200).json({
    websiteUrl:    canonicalWebsite || null,
    companyDomain: normalizeCompanyDomain(email) || null,
    source,
  });
}
