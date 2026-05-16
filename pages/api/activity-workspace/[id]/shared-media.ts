/**
 * Shared Creator Media inheritance endpoint — additive, flag-gated.
 *
 *   GET   /api/activity-workspace/[id]/shared-media
 *         → resolve per-platform media inheritance for this row's
 *           content core (inherited / overridden / incompatible).
 *
 *   PATCH { action:'attach',  asset_id, asset_type, content_spec_hash }
 *         { action:'policy',  override_policy?, compatibility_policy?, is_default_selected? }
 *         { action:'override', platform, kind:'disabled'|'replaced', override_asset_id? }
 *         { action:'revert',  platform }   (lossless: removes the override)
 *
 * SAFETY
 *   - Flag-gated (ENABLE_CREATOR_WORKSPACE_LIFECYCLE) → 404 when OFF.
 *   - Creator-only (intent_type='creator'); never touches Text rows.
 *   - MEDIA-only: never reads/writes caption/hashtag/CTA/metadata. The
 *     scheduler is NOT involved (it reads content.uploaded_media_url via
 *     the EXISTING path; this endpoint only manages inheritance state).
 *   - Additive: brand-new route; no existing endpoint modified.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { ownedDbTable } from '@/backend/db/writeOwner';
import { isCreatorWorkspaceLifecycleEnabled } from '@/backend/services/creator/intelligence/workspace';
import {
  resolveSharedMediaInheritance, finalizeRowSharedMedia,
  buildExternalVideoAttachment, finalizeRowSharedVideo,
} from '@/backend/services/creator/media';
import type {
  InheritanceOverridePolicy,
  PlatformOverrideKind,
} from '@/backend/services/creator/media';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isCreatorWorkspaceLifecycleEnabled()) {
    return res.status(404).json({ error: 'Creator workspace lifecycle not enabled.', code: 'LIFECYCLE_DISABLED' });
  }
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id required' });

  const { data: row, error: rErr } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, content, content_type, intent_type, organization_id')
    .eq('id', id)
    .maybeSingle();
  if (rErr) return res.status(500).json({ error: 'load failed' });
  if (!row) return res.status(404).json({ error: `Row not found: ${id}` });
  if ((row as any).intent_type !== 'creator') {
    return res.status(409).json({ error: 'Not a Creator row.', code: 'NOT_A_CREATOR_ROW' });
  }

  // Auth via campaign company.
  let companyId: string | null = null;
  try {
    const { data: c } = await supabase.from('campaigns').select('company_id')
      .eq('id', (row as any).campaign_id).maybeSingle();
    companyId = (c as any)?.company_id ?? null;
  } catch { /* noop */ }
  if (!companyId) return res.status(403).json({ error: 'Company unresolved.' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // Content core = card lineage; targets = the row's platform(s).
  let content: any = {};
  try { content = typeof (row as any).content === 'string' ? JSON.parse((row as any).content) : ((row as any).content || {}); }
  catch { content = {}; }
  const contentCoreId = String(content?.creator_planning_source?.card_id || `core:${id}`);
  const assetType = String((row as any).content_type || content?.asset_type || 'image');
  const platforms: string[] = Array.isArray(content?.target_platforms)
    ? content.target_platforms
    : [String(content?.platform || 'linkedin')];
  const nowIso = new Date().toISOString();

  const loadAttachment = async () => {
    const { data: att } = await supabase
      .from('content_asset_attachment').select('*')
      .eq('content_core_id', contentCoreId).limit(1).maybeSingle();
    return att as any;
  };

  if (req.method === 'PATCH') {
    const body = (req.body || {}) as Record<string, unknown>;
    const action = String(body.action || '');

    if (action === 'attach') {
      const assetId = String(body.asset_id || '').trim();
      if (!assetId) return res.status(400).json({ error: 'asset_id required' });
      // Immutable lineage row (idempotent on (core,asset)).
      await ownedDbTable('content_core_asset').upsert({
        content_core_id: contentCoreId, asset_id: assetId,
        asset_type: assetType,
        canonical_asset_family: String(body.canonical_asset_family || 'image'),
        content_spec_hash: String(body.content_spec_hash || ''),
        asset_url: typeof body.asset_url === 'string' ? body.asset_url : null,
        organization_id: (row as any).organization_id ?? null,
      }, { onConflict: 'content_core_id,asset_id', ignoreDuplicates: true });
      await ownedDbTable('content_asset_attachment').upsert({
        content_core_id: contentCoreId, asset_id: assetId,
        attachment_role: String(body.attachment_role || 'primary'),
        inherited_by_platforms: JSON.stringify(platforms),
        updated_at: nowIso,
      }, { onConflict: 'content_core_id,asset_id,attachment_role', ignoreDuplicates: true });
    } else if (action === 'policy') {
      const att = await loadAttachment();
      if (!att) return res.status(409).json({ error: 'No attachment yet.', code: 'NO_ATTACHMENT' });
      const patch: Record<string, unknown> = { updated_at: nowIso };
      if (typeof body.override_policy === 'string') patch.override_policy = body.override_policy;
      if (typeof body.compatibility_policy === 'string') patch.compatibility_policy = body.compatibility_policy;
      if (typeof body.is_default_selected === 'boolean') patch.is_default_selected = body.is_default_selected;
      await ownedDbTable('content_asset_attachment').update(patch).eq('id', att.id);
    } else if (action === 'override') {
      const att = await loadAttachment();
      if (!att) return res.status(409).json({ error: 'No attachment yet.', code: 'NO_ATTACHMENT' });
      const platform = String(body.platform || '').trim().toLowerCase();
      const kind = String(body.kind || '') as PlatformOverrideKind;
      if (!platform || !['disabled', 'replaced', 'inherited'].includes(kind)) {
        return res.status(400).json({ error: 'platform + valid kind required' });
      }
      await ownedDbTable('content_asset_platform_override').upsert({
        attachment_id: att.id, platform, override_kind: kind,
        override_asset_id: kind === 'replaced' ? String(body.override_asset_id || '') : null,
        override_asset_url: kind === 'replaced' && typeof body.override_asset_url === 'string'
          ? body.override_asset_url : null,
        override_thumbnail_url: typeof body.override_thumbnail_url === 'string'
          ? body.override_thumbnail_url : null,
        updated_at: nowIso,
      }, { onConflict: 'attachment_id,platform' });
    } else if (action === 'attach-external-video') {
      // Human-production external video → register into shared-media
      // lineage so existing inheritance/override/finalize auto-propagate
      // it across compatible platforms. NO AI rendering.
      const url = String(body.external_video_url || '').trim();
      if (!url) return res.status(400).json({ error: 'external_video_url required' });
      const built = buildExternalVideoAttachment({
        contentCoreId, organizationId: String((row as any).organization_id ?? ''),
        externalVideoUrl: url,
        thumbnailUrl: typeof body.thumbnail_url === 'string' ? body.thumbnail_url : null,
        durationSeconds: Number.isFinite(body.duration_seconds) ? Number(body.duration_seconds) : null,
        aspectRatio: typeof body.aspect_ratio === 'string' ? body.aspect_ratio : null,
        providerType: (typeof body.provider_type === 'string' ? body.provider_type : 'upload') as any,
        uploadedBy: null,
        assetType: String((row as any).content_type || 'video'),
      });
      await ownedDbTable('content_external_video_asset').upsert(
        built.external_video_row, { onConflict: 'content_core_id,asset_id', ignoreDuplicates: true });
      await ownedDbTable('content_core_asset').upsert(
        built.core_asset_row, { onConflict: 'content_core_id,asset_id', ignoreDuplicates: true });
      await ownedDbTable('content_asset_attachment').upsert(
        { ...built.attachment_row, updated_at: nowIso },
        { onConflict: 'content_core_id,asset_id,attachment_role', ignoreDuplicates: true });
    } else if (action === 'finalize-video-publishing') {
      const att = await loadAttachment();
      if (!att) return res.status(409).json({ error: 'No attachment yet.', code: 'NO_ATTACHMENT' });
      const { data: ovRowsV } = await supabase
        .from('content_asset_platform_override')
        .select('platform, override_kind, override_asset_id, override_asset_url, override_thumbnail_url')
        .eq('attachment_id', att.id);
      const ovMap: Record<string, any> = {};
      for (const o of (ovRowsV as any[]) ?? []) {
        ovMap[o.platform] = { kind: o.override_kind, asset_id: o.override_asset_id ?? undefined, asset_url: o.override_asset_url ?? null, thumbnail_url: o.override_thumbnail_url ?? null };
      }
      const { data: ev } = await supabase
        .from('content_external_video_asset')
        .select('external_video_url, duration_seconds, aspect_ratio')
        .eq('content_core_id', contentCoreId).eq('asset_id', att.asset_id).maybeSingle();
      const { data: ca2 } = await supabase
        .from('content_core_asset').select('asset_url')
        .eq('content_core_id', contentCoreId).eq('asset_id', att.asset_id).maybeSingle();
      const { data: sibsV } = await supabase
        .from('daily_content_plans')
        .select('id, content, content_type, platform, intent_type')
        .eq('campaign_id', (row as any).campaign_id).eq('intent_type', 'creator').limit(200);
      const finalizedV: any[] = []; const eventsV: string[] = [];
      for (const s of (sibsV as any[]) ?? []) {
        let sc: any = {};
        try { sc = typeof s.content === 'string' ? JSON.parse(s.content) : (s.content || {}); } catch { continue; }
        if (String(sc?.creator_planning_source?.card_id || '') !== contentCoreId) continue;
        const sPlatform = String(sc?.platform || s.platform || '').trim().toLowerCase();
        const fin = finalizeRowSharedVideo({
          intentType: s.intent_type, platform: sPlatform,
          assetType: String(s.content_type || 'video'),
          attachment: { asset_id: att.asset_id, asset_url: (ca2 as any)?.asset_url ?? (ev as any)?.external_video_url ?? null, override_policy: att.override_policy },
          videoMeta: { duration_seconds: (ev as any)?.duration_seconds ?? null, aspect_ratio: (ev as any)?.aspect_ratio ?? null },
          overrides: ovMap,
          existingUploadedUrl: typeof sc?.uploaded_media_url === 'string' ? sc.uploaded_media_url : null,
        });
        if (fin.finalized) finalizedV.push({ row_id: s.id, ...fin.finalized });
        for (const e of fin.events) if (!eventsV.includes(e)) eventsV.push(e);
        if (fin.applied && fin.content_patch) {
          const nextC = { ...sc, ...fin.content_patch };
          await ownedDbTable('daily_content_plans')
            .update({ content: JSON.stringify(nextC), updated_at: nowIso })
            .eq('id', s.id).eq('intent_type', 'creator');
        }
      }
      return res.status(200).json({ finalized_video: finalizedV, events: eventsV, content_core_id: contentCoreId, persisted: true });
    } else if (action === 'finalize-publishing') {
      // Step-15: stamp finalized inherited media into the EXISTING
      // content.uploaded_media_url the scheduler already reads. Iterates
      // sibling Creator rows of this content core; content-only writes;
      // scheduler/Text untouched; compatibility fail-closed.
      const att = await loadAttachment();
      if (!att) return res.status(409).json({ error: 'No attachment yet.', code: 'NO_ATTACHMENT' });
      const { data: ovRowsF } = await supabase
        .from('content_asset_platform_override')
        .select('platform, override_kind, override_asset_id, override_asset_url')
        .eq('attachment_id', att.id);
      const ovMap: Record<string, { kind: PlatformOverrideKind; asset_id?: string; asset_url?: string | null }> = {};
      for (const o of (ovRowsF as any[]) ?? []) {
        ovMap[o.platform] = { kind: o.override_kind, asset_id: o.override_asset_id ?? undefined, asset_url: o.override_asset_url ?? null };
      }
      const { data: coreAsset } = await supabase
        .from('content_core_asset').select('asset_url')
        .eq('content_core_id', contentCoreId).eq('asset_id', att.asset_id).maybeSingle();

      const { data: sibs } = await supabase
        .from('daily_content_plans')
        .select('id, content, content_type, platform, intent_type')
        .eq('campaign_id', (row as any).campaign_id)
        .eq('intent_type', 'creator')
        .limit(200);

      const finalizedOut: any[] = [];
      const eventsOut: string[] = [];
      for (const s of (sibs as any[]) ?? []) {
        let sc: any = {};
        try { sc = typeof s.content === 'string' ? JSON.parse(s.content) : (s.content || {}); }
        catch { continue; }
        if (String(sc?.creator_planning_source?.card_id || '') !== contentCoreId) continue;
        const sPlatform = String(sc?.platform || s.platform || '').trim().toLowerCase();
        const fin = finalizeRowSharedMedia({
          intentType: s.intent_type,
          platform: sPlatform,
          assetType: String(s.content_type || sc?.asset_type || assetType),
          attachment: {
            asset_id: att.asset_id,
            asset_url: (coreAsset as any)?.asset_url ?? null,
            override_policy: att.override_policy,
            compatibility_policy: att.compatibility_policy,
          },
          overrides: ovMap,
          existingUploadedUrl: typeof sc?.uploaded_media_url === 'string' ? sc.uploaded_media_url : null,
        });
        if (fin.finalized) finalizedOut.push({ row_id: s.id, ...fin.finalized });
        for (const e of fin.events) if (!eventsOut.includes(e)) eventsOut.push(e);
        if (fin.applied && fin.content_patch) {
          // CONTENT-ONLY: only uploaded_media_url; scheduler stays
          // delivery-only, no strategic/inheritance/render keys written.
          const nextContent = { ...sc, uploaded_media_url: fin.content_patch.uploaded_media_url };
          await ownedDbTable('daily_content_plans')
            .update({ content: JSON.stringify(nextContent), updated_at: nowIso })
            .eq('id', s.id)
            .eq('intent_type', 'creator');
        }
      }
      return res.status(200).json({
        finalized_media: finalizedOut,
        events: eventsOut,
        content_core_id: contentCoreId,
        persisted: true,
      });
    } else if (action === 'revert') {
      const att = await loadAttachment();
      const platform = String(body.platform || '').trim().toLowerCase();
      if (att && platform) {
        await ownedDbTable('content_asset_platform_override')
          .delete().eq('attachment_id', att.id).eq('platform', platform);
      }
    } else {
      return res.status(400).json({ error: 'Invalid action.', code: 'INVALID_ACTION' });
    }
  }

  // ── Resolve current inheritance state (GET + post-PATCH echo) ──────────
  const att = await loadAttachment();
  if (!att) {
    return res.status(200).json({
      shared_media: { content_core_id: contentCoreId, attached: false, resolutions: [] },
    });
  }
  const { data: ovRows } = await supabase
    .from('content_asset_platform_override').select('platform, override_kind, override_asset_id')
    .eq('attachment_id', att.id);
  const overrides: Record<string, { kind: PlatformOverrideKind; asset_id?: string }> = {};
  for (const o of (ovRows as any[]) ?? []) {
    overrides[o.platform] = { kind: o.override_kind, asset_id: o.override_asset_id ?? undefined };
  }
  const resolved = resolveSharedMediaInheritance({
    assetType,
    sharedAssetId: att.asset_id,
    targetPlatforms: platforms,
    overridePolicy: att.override_policy as InheritanceOverridePolicy,
    compatibilityPolicy: att.compatibility_policy,
    overrides,
  });

  return res.status(200).json({
    shared_media: {
      content_core_id: contentCoreId,
      attached: true,
      asset_id: att.asset_id,
      attachment_role: att.attachment_role,
      override_policy: att.override_policy,
      compatibility_policy: att.compatibility_policy,
      is_default_selected: att.is_default_selected,
      ...resolved,
    },
    persisted: req.method === 'PATCH',
  });
}
