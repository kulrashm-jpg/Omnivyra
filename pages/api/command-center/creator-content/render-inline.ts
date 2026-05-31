/**
 * POST /api/command-center/creator-content/render-inline
 *
 * Escape hatch: synchronously render a creator asset payload without
 * going through the durable BullMQ queue. Useful when:
 *   - Local dev was started with `npm run dev` (no creator-render
 *     worker) — the durable queue accepts jobs but nothing consumes
 *     them.
 *   - Production worker fleet is temporarily down and the operator
 *     wants to force a render through the request path.
 *
 * Contract:
 *   Request body: { asset_payload: Record<string, unknown> }
 *   Response 200: { success: true, rendered: { url?, files?, metadata? } }
 *
 * Auth: requires an authenticated Supabase session. The renderer's own
 * `options` block carries companyId/userId for storage attribution.
 *
 * STRICT scope:
 *   - Pure passthrough to `renderAsset` — no orchestration,
 *     persistence, governance, or analytics. Callers that need those
 *     side effects must use the canonical /generate route.
 *   - The request blocks until rendering completes. Carousel /
 *     infographic renders are expensive; callers should expect 30–60s
 *     latency and configure their fetch timeout accordingly.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { renderAsset } from '../../../../backend/services/creatorAssetRenderer';

export const config = {
  api: {
    // Carousel renders can take a while when running inline. Allow up
    // to 3 minutes before Next.js gives up on the response.
    responseLimit: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
    asset_payload?: unknown;
    company_id?: unknown;
    campaign_id?: unknown;
  };
  const assetPayload = body.asset_payload && typeof body.asset_payload === 'object' && !Array.isArray(body.asset_payload)
    ? body.asset_payload as Record<string, unknown>
    : null;
  if (!assetPayload) {
    return res.status(400).json({ success: false, error: 'asset_payload required' });
  }
  const companyId = typeof body.company_id === 'string' ? body.company_id.trim() : '';
  const campaignId = typeof body.campaign_id === 'string' ? body.campaign_id.trim() : '';

  try {
    const rendered = await renderAsset(assetPayload, {
      companyId: companyId || undefined,
      campaignId: campaignId || undefined,
      userId: user.id ?? null,
    });
    return res.status(200).json({
      success: true,
      rendered: {
        url: rendered.url,
        files: rendered.files ?? [],
        metadata: rendered.metadata ?? {},
      },
    });
  } catch (renderError) {
    const message = renderError instanceof Error ? renderError.message : String(renderError);
    return res.status(500).json({
      success: false,
      error: 'inline render failed',
      message,
    });
  }
}
