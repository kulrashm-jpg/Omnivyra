import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  attachCreatorAsset,
  listCreatorAssetAttachments,
} from '@/backend/services/creatorAssetPersistenceService';

/**
 * Phase 4 — persistence convergence note.
 *
 * The creatorOrchestrator (`backend/services/creator/creatorOrchestrator.ts`)
 * also routes writer-bound persistence through `attachCreatorAsset` when
 * the request carries a writer source binding. Both this endpoint and the
 * orchestrator therefore resolve to the SAME `stableAssetId` (sha1 of
 * companyId|userId|sourceType|sourceId|creatorType|renderIdentityHash) and
 * upsert the SAME `creator_asset_attachments` row keyed by
 * (company_id, user_id, source_type, source_id, creator_asset_id).
 *
 * Effect: a writer client that POSTs here AFTER the Direct flow's
 * orchestrator already wrote the row performs an idempotent no-op
 * upsert (same id, identical metadata) — no divergent parallel row,
 * no duplicate id namespace. The endpoint remains the surface used by
 * (i) the writer's durable sync-back, (ii) GET listing, and (iii)
 * legacy clients that attach an asset originating outside the
 * orchestrator's Direct path.
 */

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asSourceType(value: unknown): 'post' | 'thread' | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'post' || normalized === 'thread' ? normalized : null;
}

function hasOverlayText(value: Record<string, unknown>): boolean {
  return ['hook', 'headline', 'keyInsight', 'cta', 'supportingText']
    .some((key) => typeof value[key] === 'string' && String(value[key]).trim().length > 0);
}

function mapAttachment(row: Record<string, unknown>) {
  return {
    id: String(row.creator_asset_id || row.id || ''),
    creatorType: String(row.creator_type || ''),
    title: String(row.title || 'Creator asset'),
    url: typeof row.url === 'string' ? row.url : undefined,
    files: Array.isArray(row.files) ? row.files : undefined,
    previewKind: typeof row.preview_kind === 'string' ? row.preview_kind : undefined,
    attachmentMode: typeof asObject(row.metadata).attachment_mode === 'string' ? asObject(row.metadata).attachment_mode : undefined,
    compositionIntent: asObject(row.metadata).asset_composition_intent,
    platformContext: typeof row.platform_context === 'string' ? row.platform_context : undefined,
    renderIdentityHash: typeof row.render_identity_hash === 'string' ? row.render_identity_hash : undefined,
    metadata: asObject(row.metadata),
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.company_id || req.body?.company_id || '').trim();
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const sourceType = asSourceType(req.query.source_type);
    const sourceId = String(req.query.source_id || '').trim();
    if (!sourceType || !sourceId) {
      return res.status(400).json({ error: 'source_type and source_id are required' });
    }
    try {
      const rows = await listCreatorAssetAttachments({
        companyId,
        userId: access.userId,
        sourceType,
        sourceId,
      });
      return res.status(200).json({ attachments: rows.map(mapAttachment) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load creator attachments';
      return res.status(message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE') ? 503 : 500).json({
        error: message,
        persistence_available: !message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE'),
      });
    }
  }

  if (req.method === 'POST') {
    const sourceType = asSourceType(req.body?.source_type);
    const sourceId = String(req.body?.source_id || '').trim();
    const asset = asObject(req.body?.asset);
    const metadata = asObject(asset.metadata);
    const attachmentMode = typeof asset.attachmentMode === 'string' ? asset.attachmentMode : metadata.attachment_mode;
    if (attachmentMode === 'supporting_visual' && hasOverlayText(asObject(metadata.overlay_text))) {
      return res.status(400).json({ error: 'supporting_visual attachments cannot persist overlay_text' });
    }
    const creatorType = String(asset.creatorType || asset.creator_type || '').trim();
    if (!sourceType || !sourceId || !creatorType) {
      return res.status(400).json({ error: 'source_type, source_id, and asset.creatorType are required' });
    }
    try {
      const row = await attachCreatorAsset({
        tenantId: companyId,
        companyId,
        userId: access.userId,
        sourceType,
        sourceId,
        creatorAssetId: typeof asset.id === 'string' ? asset.id : undefined,
        creatorType,
        title: String(asset.title || 'Creator asset'),
        url: typeof asset.url === 'string' ? asset.url : undefined,
        files: Array.isArray(asset.files) ? asset.files.map(String) : undefined,
        previewKind: typeof asset.previewKind === 'string' ? asset.previewKind : typeof asset.preview_kind === 'string' ? asset.preview_kind : undefined,
        platformContext: typeof asset.platformContext === 'string' ? asset.platformContext : typeof asset.platform_context === 'string' ? asset.platform_context : undefined,
        attachmentOrder: Number.isFinite(Number(asset.attachmentOrder)) ? Number(asset.attachmentOrder) : 0,
        metadata: {
          ...metadata,
          attachment_mode: typeof asset.attachmentMode === 'string' ? asset.attachmentMode : metadata.attachment_mode,
          asset_composition_intent: asObject(asset.compositionIntent).assetType ? asObject(asset.compositionIntent) : metadata.asset_composition_intent,
        },
        sourceContent: asObject(req.body?.source_content),
        renderIdentityHash: typeof asset.renderIdentityHash === 'string' ? asset.renderIdentityHash : typeof asset.render_identity_hash === 'string' ? asset.render_identity_hash : undefined,
      });
      return res.status(200).json({ attachment: mapAttachment(row) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to persist creator attachment';
      return res.status(message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE') ? 503 : 500).json({
        error: message,
        persistence_available: !message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE'),
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
