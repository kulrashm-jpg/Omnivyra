import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  listCreatorAssets,
  upsertCreatorAssetRecord,
  deleteCreatorAssetRecord,
} from '@/backend/services/creatorAssetPersistenceService';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asSourceType(value: unknown): 'post' | 'thread' | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'post' || normalized === 'thread' ? normalized : null;
}

function creatorTypeAliases(value: unknown): string[] {
  const normalized = String(value || '').trim().toLowerCase();
  const map: Record<string, string[]> = {
    supporting_image: ['supporting_image', 'image'],
    banner: ['banner'],
    infographic: ['infographic'],
    carousel: ['carousel'],
    slider: ['slider'],
    brand_card: ['brand_card', 'image'],
  };
  return map[normalized] || [];
}

function mapAsset(row: Record<string, unknown>) {
  const metadata = asObject(row.metadata);
  return {
    id: String(row.id || ''),
    creatorType: String(row.creator_type || ''),
    title: String(row.title || 'Creator asset'),
    url: typeof row.url === 'string' ? row.url : undefined,
    files: Array.isArray(row.files) ? row.files : undefined,
    previewKind: typeof row.preview_kind === 'string' ? row.preview_kind : undefined,
    platformContext: typeof row.platform_context === 'string' ? row.platform_context : undefined,
    renderIdentityHash: typeof row.render_identity_hash === 'string' ? row.render_identity_hash : undefined,
    blockTemplateId: typeof row.block_template_id === 'string' ? row.block_template_id : typeof metadata.blockTemplateId === 'string' ? metadata.blockTemplateId : undefined,
    metadata,
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = String(req.body?.company_id || req.query.company_id || '').trim();
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // ── DELETE: remove a creator_assets row (id in query OR body) ─────────────
  // Lives on the static index path because dynamic [id] routes are
  // unreliable in this dev environment. Strictly scoped to (id,
  // companyId) inside the persistence service.
  if (req.method === 'DELETE') {
    const id = (typeof req.query.id === 'string' ? req.query.id
      : typeof req.body?.id === 'string' ? req.body.id
      : '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const result = await deleteCreatorAssetRecord({ assetId: id, companyId });
      if (!result.deletedAsset) {
        return res.status(404).json({ error: 'Creator asset not found for this company' });
      }
      return res.status(200).json({ success: true, id, deletedAttachments: result.deletedAttachments });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete creator asset';
      return res.status(message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE') ? 503 : 500).json({
        error: message,
      });
    }
  }

  if (req.method === 'GET') {
    try {
      const aliases = creatorTypeAliases(req.query.creator_type || req.query.type);
      const rows = await listCreatorAssets({
        companyId,
        userId: access.userId,
        creatorTypes: aliases.length > 0 ? aliases : undefined,
        limit: Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 48,
      });
      return res.status(200).json({ assets: rows.map(mapAsset) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load creator assets';
      return res.status(message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE') ? 503 : 500).json({
        error: message,
        persistence_available: !message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE'),
      });
    }
  }

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
