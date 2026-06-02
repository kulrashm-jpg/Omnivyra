import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import {
  INTEGRATION_PLATFORM_OAUTH_MANAGE,
  SUPER_ADMIN_DASHBOARD_VIEW,
} from '../../../shared/contracts/security';

const VALID_INTEGRATION_MODES = new Set(['public', 'public_login', 'oauth', 'api_key', 'manual']);

function splitTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function cleanText(value: unknown, max = 500): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function buildMutationPayload(body: Record<string, unknown>) {
  const sourceName = cleanText(body.source_name ?? body.sourceName, 160);
  const sourceType = cleanText(body.source_type ?? body.sourceType, 80);
  const sourceIdentifier = cleanText(body.source_identifier ?? body.sourceIdentifier, 160);
  const integrationMode = cleanText(body.integration_mode ?? body.integrationMode, 40) ?? 'public_login';

  if (!sourceName || !sourceType || !sourceIdentifier) {
    throw new Error('source_name, source_type, and source_identifier are required');
  }
  if (!VALID_INTEGRATION_MODES.has(integrationMode)) {
    throw new Error('Invalid integration_mode');
  }

  const signalQuality = Number(body.estimated_signal_quality ?? body.estimatedSignalQuality ?? 0.65);
  const volume = Number(body.estimated_volume ?? body.estimatedVolume ?? 120);

  return {
    source_name: sourceName,
    source_type: sourceType,
    source_identifier: sourceIdentifier,
    source_url: cleanText(body.source_url ?? body.sourceUrl, 500),
    platform: cleanText(body.platform, 80),
    integration_mode: integrationMode,
    industry_tags: splitTags(body.industry_tags ?? body.industryTags),
    similar_industry_tags: splitTags(body.similar_industry_tags ?? body.similarIndustryTags),
    opportunity_types: splitTags(body.opportunity_types ?? body.opportunityTypes),
    recommendation_reason: cleanText(body.recommendation_reason ?? body.recommendationReason, 800),
    estimated_signal_quality: Number.isFinite(signalQuality) ? Math.max(0, Math.min(1, signalQuality)) : 0.65,
    estimated_volume: Number.isFinite(volume) ? Math.max(0, Math.round(volume)) : 120,
    is_active: cleanBoolean(body.is_active ?? body.isActive, true),
  };
}

async function requireCatalogCapability(req: NextApiRequest, res: NextApiResponse) {
  const capability = req.method === 'GET'
    ? SUPER_ADMIN_DASHBOARD_VIEW
    : INTEGRATION_PLATFORM_OAUTH_MANAGE;
  return requireCapability(req, res, {
    capability,
    reason: `super-admin curated industry sources (${req.method})`,
    requireStepUp: req.method !== 'GET',
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:curated-industry-sources', 30, 60))) return;

  const guard = await requireCatalogCapability(req, res);
  if (guard.ok !== true) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('curated_industry_sources')
      .select('*')
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'FAILED_TO_LIST_CURATED_SOURCES' });
    return res.status(200).json({ sources: data ?? [] });
  }

  if (req.method === 'POST') {
    try {
      const payload = buildMutationPayload(req.body ?? {});
      const { data, error } = await supabase
        .from('curated_industry_sources')
        .upsert(payload, { onConflict: 'source_type,source_identifier' })
        .select('*')
        .single();

      if (error || !data) {
        return res.status(500).json({ error: error?.message ?? 'FAILED_TO_SAVE_CURATED_SOURCE' });
      }
      return res.status(200).json({ source: data });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'INVALID_PAYLOAD' });
    }
  }

  if (req.method === 'PATCH') {
    const id = cleanText((req.body ?? {}).id, 80);
    if (!id) return res.status(400).json({ error: 'id required' });

    try {
      const payload = buildMutationPayload(req.body ?? {});
      const { data, error } = await supabase
        .from('curated_industry_sources')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();

      if (error || !data) {
        return res.status(500).json({ error: error?.message ?? 'FAILED_TO_UPDATE_CURATED_SOURCE' });
      }
      return res.status(200).json({ source: data });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'INVALID_PAYLOAD' });
    }
  }

  if (req.method === 'DELETE') {
    const id = cleanText(req.query.id, 80);
    if (!id) return res.status(400).json({ error: 'id required' });

    const { error } = await supabase
      .from('curated_industry_sources')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: 'FAILED_TO_DELETE_CURATED_SOURCE' });
    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', 'GET,POST,PATCH,DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
