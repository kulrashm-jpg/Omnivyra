
/**
 * GET /api/engagement/buyer-intent
 * Returns high-intent accounts from buyer_intent_accounts.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getBuyerIntentAccounts } from '../../../backend/services/buyerIntentIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as
      | string
      | undefined;
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const accounts = await getBuyerIntentAccounts(organizationId, limit);

    return res.status(200).json({
      accounts: accounts.map((a) => ({
        id: a.id,
        author_name: a.author_name ?? 'Unknown',
        platform: a.platform,
        intent_score: a.intent_score,
        message_count: a.message_count,
        intent_signals: a.intent_signals,
        last_detected_at: a.last_detected_at,
      })),
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch buyer intent';
    console.error('[engagement/buyer-intent]', message);
    return res.status(500).json({ error: message });
  }
}
