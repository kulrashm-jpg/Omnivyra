import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { upsertCreatorAssetRecord } from '@/backend/services/creatorAssetPersistenceService';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asSourceType(value: unknown): 'post' | 'thread' | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'post' || normalized === 'thread' ? normalized : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = String(req.body?.company_id || '').trim();
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const asset = asObject(req.body?.asset);
  const creatorType = String(asset.creatorType || asset.creator_type || asset.asset_type || '').trim();
  if (!creatorType) {
    return res.status(400).json({ error: 'asset.creatorType is required' });
  }

  try {
    const row = await upsertCreatorAssetRecord({
      tenantId: companyId,
      companyId,
      userId: access.userId,
      sourceType: asSourceType(req.body?.source_type),
      sourceId: typeof req.body?.source_id === 'string' ? req.body.source_id : null,
      creatorType,
      title: String(asset.title || req.body?.title || 'Creator asset'),
      url: typeof asset.url === 'string' ? asset.url : undefined,
      files: Array.isArray(asset.files) ? asset.files.map(String) : undefined,
      previewKind: typeof asset.previewKind === 'string' ? asset.previewKind : typeof asset.preview_kind === 'string' ? asset.preview_kind : undefined,
      platformContext: typeof asset.platformContext === 'string' ? asset.platformContext : typeof asset.platform_context === 'string' ? asset.platform_context : undefined,
      metadata: asObject(asset.metadata),
      sourceContent: asObject(req.body?.source_content),
      renderIdentityHash: typeof asset.renderIdentityHash === 'string' ? asset.renderIdentityHash : typeof asset.render_identity_hash === 'string' ? asset.render_identity_hash : undefined,
      blockTemplateId: typeof req.body?.block_template_id === 'string' ? req.body.block_template_id : undefined,
    });
    return res.status(200).json({ asset: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to persist creator asset';
    return res.status(message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE') ? 503 : 500).json({
      error: message,
      persistence_available: !message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE'),
    });
  }
}
