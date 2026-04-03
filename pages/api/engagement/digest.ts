
/**
 * GET /api/engagement/digest
 * Returns daily engagement digest for the organization.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getDigest, generateDailyDigest } from '../../../backend/services/engagementDigestService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as string | undefined;
    const date = (req.query.date as string)?.trim() || undefined;
    const refresh = (req.query.refresh as string) === 'true';

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    let digest = await getDigest(organizationId, date);
    if (refresh || !digest) {
      const generated = await generateDailyDigest(organizationId);
      digest = generated ?? digest;
    }

    if (!digest) {
      return res.status(200).json({
        digest_date: date ?? new Date().toISOString().slice(0, 10),
        new_threads: 0,
        high_priority_threads: 0,
        lead_signals: 0,
        opportunity_signals: 0,
        recommended_threads: [],
      });
    }

    return res.status(200).json({
      digest_date: digest.digest_date,
      new_threads: digest.new_threads,
      high_priority_threads: digest.high_priority_threads,
      lead_signals: digest.lead_signals,
      opportunity_signals: digest.opportunity_signals,
      recommended_threads: digest.recommended_thread_ids,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch digest';
    console.error('[engagement/digest]', message);
    return res.status(500).json({ error: message });
  }
}
