/**
 * GET /api/engagement/creator-conversion
 *
 * Surfaces creator-driven lead conversion intelligence by CONSUMING the
 * existing attribution reporting helpers — getLeadsByStrategy / getLeadsByVariant
 * / getLeadsByAsset. No new attribution logic; the only computation is a simple
 * conversion-share aggregation (a category's item conversions ÷ category total).
 *
 * Graceful degradation: each helper is wrapped independently. If the creator
 * attribution columns are not present yet (migration 20260819 unapplied) the
 * query throws and that category reports `available: false` — the UI renders
 * "Insufficient attribution data" instead of erroring. Attribution is never
 * fabricated.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  getStrategyConversionRate,
  getVariantConversionRate,
  getAssetConversionRate,
  getCampaignConversionRate,
  getPlatformConversionRate,
  getContentTypeConversionRate,
  type ConversionRateRow,
  type ConversionConfidence,
} from '../../../backend/services/attributionReportingService';

type RankedItem = {
  id: string;
  conversions: number;
  conversion_share: number;
  campaigns: string[];
  // Conversion-rate quality indicators (display-only; strategy / variant /
  // asset). These NEVER feed ranking, recommendation, governance, or learning.
  exposed_sessions?: number;
  conversion_rate?: number | null;
  confidence?: ConversionConfidence;
  // Read-only learning-readiness metadata. Exposed for future learning; does
  // NOT influence ranking or any weights here.
  metadata: { conversion_count: number; conversion_share: number };
};

type Category = {
  available: boolean;
  total_conversions: number;
  items: RankedItem[];
};

const EMPTY_UNAVAILABLE: Category = { available: false, total_conversions: 0, items: [] };

/** Shape a ConversionRateRow[] preserving the count/share fields AND layering
 *  the display-only conversion-rate quality indicators (strategy/variant/asset). */
function shapeRate(rows: ConversionRateRow[]): Category {
  const total = rows.reduce((sum, r) => sum + r.conversions, 0);
  const items: RankedItem[] = rows.map((r) => {
    const share = total > 0 ? Number((r.conversions / total).toFixed(4)) : 0;
    return {
      id: r.id,
      conversions: r.conversions,
      conversion_share: share,
      exposed_sessions: r.exposed_sessions,
      conversion_rate: r.conversion_rate,
      confidence: r.confidence,
      campaigns: r.campaigns,
      metadata: { conversion_count: r.conversions, conversion_share: share },
    };
  });
  return { available: true, total_conversions: total, items };
}

/** Run one rate helper; on any failure (e.g. columns absent pre-migration)
 *  report the category as unavailable rather than throwing the whole request. */
async function safeRateCategory(fn: () => Promise<ConversionRateRow[]>, label: string): Promise<Category> {
  try {
    return shapeRate(await fn());
  } catch (err) {
    console.warn(`[engagement/creator-conversion] ${label} unavailable:`, (err as Error)?.message);
    return EMPTY_UNAVAILABLE;
  }
}

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
    const days = Math.min(90, Math.max(7, parseInt(String(req.query.days ?? 30), 10) || 30));

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const scope = { companyId: organizationId, from, to };

    const [strategies, variants, assets, campaigns, platforms, content_types] = await Promise.all([
      // Creator dimensions.
      safeRateCategory(() => getStrategyConversionRate(scope), 'strategies'),
      safeRateCategory(() => getVariantConversionRate(scope), 'variants'),
      safeRateCategory(() => getAssetConversionRate(scope), 'assets'),
      // Marketing-effectiveness dimensions — same rate/confidence model over
      // existing utm_* columns. No new attribution/tracking.
      safeRateCategory(() => getCampaignConversionRate(scope), 'campaigns'),
      safeRateCategory(() => getPlatformConversionRate(scope), 'platforms'),
      safeRateCategory(() => getContentTypeConversionRate(scope), 'content_types'),
    ]);

    return res.status(200).json({
      window_days: days,
      attribution_source: 'lead_attributions',
      // Overall availability — false only when every category failed (columns
      // missing). True (possibly with empty items) once the schema is live.
      attribution_available:
        strategies.available || variants.available || assets.available ||
        campaigns.available || platforms.available || content_types.available,
      strategies,
      variants,
      assets,
      campaigns,
      platforms,
      content_types,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch creator conversion intelligence';
    console.error('[engagement/creator-conversion]', message);
    return res.status(500).json({ error: message });
  }
}
