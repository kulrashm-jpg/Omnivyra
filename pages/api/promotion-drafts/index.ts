/**
 * Promotion Drafts API (BLOG-PROMOTION hardening — durable persistence).
 *
 * Dedicated, DB-backed store for text-only promotional post drafts derived from
 * long-form content. Supports Save / Load / Update / Delete. Strictly
 * org-scoped: enforceCompanyAccess gates every request and every query is
 * filtered by organization_id. Uses the service-role client (the table has RLS
 * on with no public policies — this route is the single access path).
 *
 *   GET    ?companyId&contentId&contentType            → { drafts: [...] }
 *   POST   { companyId, contentId, contentType, platform, promotionalText,
 *            canonicalUrl, status }                     → { draft }     (upsert)
 *   DELETE { companyId, contentId, contentType, platform? }            → { ok }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

const STATUSES = ['draft', 'scheduled', 'posted', 'failed'] as const;

type PromotionDraftRow = {
  content_id: string;
  content_type: string;
  platform: string;
  promotional_text: string;
  canonical_url: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function rowToDraft(row: PromotionDraftRow) {
  return {
    contentId: row.content_id,
    contentType: row.content_type,
    platform: row.platform,
    promotionalText: row.promotional_text,
    blogUrl: row.canonical_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rawCompanyId = req.method === 'GET' ? req.query.companyId : (req.body || {}).companyId;
  const companyId = String(rawCompanyId || '').trim();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const user = await enforceCompanyAccess({ req, res, companyId });
  if (!user) return; // enforceCompanyAccess already wrote 401/403/503

  // ── Load ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const contentId = String(req.query.contentId || '').trim();
    const contentType = String(req.query.contentType || '').trim();
    if (!contentId || !contentType) {
      return res.status(400).json({ error: 'contentId and contentType required' });
    }
    const { data, error } = await supabase
      .from('promotion_drafts')
      .select('content_id, content_type, platform, promotional_text, canonical_url, status, created_at, updated_at')
      .eq('organization_id', companyId)
      .eq('content_type', contentType)
      .eq('content_id', contentId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ drafts: (data || []).map((r) => rowToDraft(r as PromotionDraftRow)) });
  }

  // ── Save / Update (upsert) ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const b = (req.body || {}) as Record<string, unknown>;
    const contentId = String(b.contentId || '').trim();
    const contentType = String(b.contentType || '').trim();
    const platform = String(b.platform || '').trim().toLowerCase();
    if (!contentId || !contentType || !platform) {
      return res.status(400).json({ error: 'contentId, contentType, and platform are required' });
    }
    const status = STATUSES.includes(String(b.status) as (typeof STATUSES)[number]) ? String(b.status) : 'draft';
    const row = {
      organization_id: companyId,
      user_id: user.userId,
      content_id: contentId,
      content_type: contentType,
      platform,
      promotional_text: String(b.promotionalText || ''),
      canonical_url: String(b.canonicalUrl || ''),
      status,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('promotion_drafts')
      .upsert(row, { onConflict: 'organization_id,content_type,content_id,platform' })
      .select('content_id, content_type, platform, promotional_text, canonical_url, status, created_at, updated_at')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ draft: data ? rowToDraft(data as PromotionDraftRow) : null });
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const b = (req.body || {}) as Record<string, unknown>;
    const contentId = String(b.contentId || '').trim();
    const contentType = String(b.contentType || '').trim();
    const platform = b.platform ? String(b.platform).trim().toLowerCase() : null;
    if (!contentId || !contentType) {
      return res.status(400).json({ error: 'contentId and contentType required' });
    }
    let query = supabase
      .from('promotion_drafts')
      .delete()
      .eq('organization_id', companyId)
      .eq('content_type', contentType)
      .eq('content_id', contentId);
    if (platform) query = query.eq('platform', platform);
    const { error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
