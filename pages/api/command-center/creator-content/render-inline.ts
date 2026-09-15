import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
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
 *   GET/POST ?probe=1: font-runtime parity diagnostics (no auth).
 *
 * Auth: requires an authenticated Supabase session. The renderer's own
 * `options` block carries companyId/userId for storage attribution.
 * ROUTE-AUTH-001 (STEP 3AH-85): a supplied company_id is bound with
 * enforceCompanyAccess (and a supplied campaign_id must belong to it); a
 * campaign_id alone is bound with requireCampaignAccess, whose company becomes
 * the render's company. A USER template named by the payload's template_id is
 * only loaded when it belongs to that bound company (404 otherwise).
 *
 * FONT PROVISIONING (PHASE 13Z): the Vercel runtime ships no fonts, so the
 * infographic SVG <text> (font-family "Inter, Arial") rendered blank. fontconfig
 * reads FONTCONFIG_FILE when it FIRST initializes (at sharp/librsvg load), so the
 * env MUST be configured before that native lib loads. We therefore call
 * ensureRenderFonts() first and DEFER (dynamic-import) the sharp-loading modules
 * (creatorAssetRenderer, renderTextCapabilityProbe) until after — keeping the top
 * of this module free of any sharp dependency.
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
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { ensureRenderFonts } from '../../../../backend/services/creatorRenderFonts';

export const config = {
  api: {
    // Carousel renders can take a while when running inline. Allow up
    // to 3 minutes before Next.js gives up on the response.
    responseLimit: false,
  },
};

/** template_id the renderer resolves (same keys as ensureUserTemplateRegisteredForAsset). */
function userTemplateIdOf(assetPayload: Record<string, unknown>): string {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
  const md = obj(obj(assetPayload.media_bundle).metadata);
  const raw = md.template_id ?? md.infographic_template_id ?? obj(md.creator_card).template_id;
  return typeof raw === 'string' ? raw.trim() : '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Configure fontconfig BEFORE any sharp/librsvg module loads (they are
  // dynamic-imported below). Must run first — fontconfig reads FONTCONFIG_FILE
  // at native-lib init, which a later call would miss.
  const diag = ensureRenderFonts();

  // Parity probe (?probe=1): runs INSIDE this same function bundle/trace, so it
  // conclusively reports whether render-inline's runtime can rasterize text
  // glyphs. Used by the post-deploy gate. No auth (renders an internal SVG,
  // returns only font diagnostics — no user data).
  if (req.query.probe === '1' || req.query.probe === 'true') {
    const { probeRenderTextCapability } = await import('../../../../backend/services/renderTextCapabilityProbe');
    const probe = await probeRenderTextCapability();
    return res.status(200).json({
      ok: probe.ok,
      inkRatio: probe.inkRatio,
      resolvedFontDir: diag.resolvedFontDir,
      fontCount: diag.fontCount,
    });
  }

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
  const requestedCompanyId = typeof body.company_id === 'string' ? body.company_id.trim() : '';
  const campaignId = typeof body.campaign_id === 'string' ? body.campaign_id.trim() : '';

  // ROUTE-AUTH-001 (STEP 3AH-85) — bind the tenant BEFORE any template load or
  // render. company_id + campaign_id: membership in the company AND the
  // campaign must belong to it. campaign_id alone: the campaign's own company.
  let companyId = '';
  if (requestedCompanyId) {
    const companyAccess = await enforceCompanyAccess({ req, res, companyId: requestedCompanyId, campaignId: campaignId || null });
    if (!companyAccess) return;
    companyId = requestedCompanyId;
  } else if (campaignId) {
    const campaignAccess = await requireCampaignAccess(req, res, campaignId);
    if (!campaignAccess) return;
    companyId = campaignAccess.companyId;
  }

  // A USER template (creator_user_templates) is a tenant resource: it is only
  // loaded when it belongs to the bound company. System template ids have no
  // row and resolve in-code exactly as before.
  const templateId = userTemplateIdOf(assetPayload);
  let loadUserTemplate = false;
  if (templateId) {
    try {
      const { data: templateRow, error: templateError } = await supabase
        .from('creator_user_templates')
        .select('company_id')
        .eq('id', templateId)
        .maybeSingle();
      if (!templateError && templateRow) {
        if (!companyId || String((templateRow as { company_id?: unknown }).company_id) !== companyId) {
          return res.status(404).json({ success: false, error: 'Template not found' });
        }
        loadUserTemplate = true;
      }
    } catch { /* ownership unprovable → load nothing; system/default resolution is unaffected */ }
  }

  try {
    // PART A — register a user template_id before render (canonical flow).
    if (loadUserTemplate) {
      try {
        const { ensureUserTemplateRegisteredForAsset } = await import('../../../../backend/services/creator/userTemplateService');
        await ensureUserTemplateRegisteredForAsset(assetPayload);
      } catch { /* best-effort */ }
    }
    // Deferred import: loads sharp AFTER ensureRenderFonts() set FONTCONFIG_FILE.
    const { renderAsset } = await import('../../../../backend/services/creatorAssetRenderer');
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/command-center/creator-content/render-inline' });
