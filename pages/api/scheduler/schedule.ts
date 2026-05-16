import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';
import { validateCreatorPublishSemantics } from '@/backend/services/creatorPublishValidation';
import { recordCreatorRenderMetric } from '@/backend/services/creatorRenderObservability';
import { persistCreatorValidationManifest } from '@/backend/services/creatorRenderPersistence';

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  return user.id;
}

// The scheduled_posts.chk_content_type constraint was authored with the legacy
// platform / content_type vocabulary (twitter/tweet, instagram/feed_post). The
// rest of the app uses canonical names (x, post). Coerce here so the insert
// satisfies the constraint without requiring a DB migration.
const PLATFORM_DB_ALIAS: Record<string, string> = {
  x: 'twitter',
};

const PLATFORM_DEFAULT_CONTENT_TYPE: Record<string, string> = {
  twitter: 'tweet',
  instagram: 'feed_post',
};

function canonicalizeForDb(rawPlatform: string, rawContentType: string): { platform: string; contentType: string } {
  const platform = PLATFORM_DB_ALIAS[rawPlatform] ?? rawPlatform;
  const contentType = rawContentType === 'post' && PLATFORM_DEFAULT_CONTENT_TYPE[platform]
    ? PLATFORM_DEFAULT_CONTENT_TYPE[platform]
    : rawContentType;
  return { platform, contentType };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { companyId, title, content, hashtags, mediaType, mediaUrls, mediaTypes, creatorAttachments, scheduledFor, platform, accountId, contentType } = req.body;

    if (companyId) {
      const access = await enforceCompanyAccess({ req, res, companyId: String(companyId) });
      if (!access) return;
    }

    if (!content || !scheduledFor || !platform) {
      return res.status(400).json({ error: 'Missing required fields: content, scheduledFor, platform' });
    }

    if (new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    const hashtagArray = hashtags
      ? hashtags.split(/\s+/).filter((t: string) => t.startsWith('#'))
      : [];

    const rawPlatform = String(platform || '').trim().toLowerCase();
    const rawContentType = String(contentType || 'post').trim().toLowerCase() || 'post';
    const { platform: dbPlatform, contentType: dbContentType } = canonicalizeForDb(rawPlatform, rawContentType);

    const normalizedMediaUrls = Array.isArray(mediaUrls)
      ? mediaUrls
          .map((u: unknown) => (typeof u === 'string' ? u.trim() : ''))
          .filter((u: string) => u.length > 0)
      : [];
    const normalizedMediaTypes = Array.isArray(mediaTypes)
      ? mediaTypes
          .map((value: unknown) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value: string) => value.length > 0)
      : [];
    const normalizedCreatorAttachments = Array.isArray(creatorAttachments)
      ? creatorAttachments
          .filter((asset: unknown): asset is Record<string, unknown> => Boolean(asset && typeof asset === 'object' && !Array.isArray(asset)))
          .map((asset) => {
            const compositionIntent = asset.compositionIntent && typeof asset.compositionIntent === 'object'
              ? asset.compositionIntent
              : asset.asset_composition_intent && typeof asset.asset_composition_intent === 'object'
                ? asset.asset_composition_intent
                : null;
            const renderManifest = asset.renderManifest && typeof asset.renderManifest === 'object'
              ? asset.renderManifest
              : asset.render_manifest && typeof asset.render_manifest === 'object'
                ? asset.render_manifest
                : null;
            const validationManifest = asset.validationManifest && typeof asset.validationManifest === 'object'
              ? asset.validationManifest
              : asset.validation_manifest && typeof asset.validation_manifest === 'object'
                ? asset.validation_manifest
                : null;
            const attachmentMode = typeof asset.attachmentMode === 'string'
              ? asset.attachmentMode
              : typeof asset.attachment_mode === 'string'
                ? asset.attachment_mode
                : null;
            const transformIntent = typeof asset.transformIntent === 'string'
              ? asset.transformIntent
              : typeof asset.transform_intent === 'string'
                ? asset.transform_intent
                : null;
            const rendererId = typeof asset.rendererId === 'string'
              ? asset.rendererId
              : typeof asset.renderer_id === 'string'
                ? asset.renderer_id
                : renderManifest && typeof (renderManifest as Record<string, unknown>).rendererId === 'string'
                  ? String((renderManifest as Record<string, unknown>).rendererId)
                  : null;
            return {
            id: typeof asset.id === 'string' ? asset.id : null,
            creatorType: typeof asset.creatorType === 'string' ? asset.creatorType : null,
            attachmentMode,
            attachment_mode: attachmentMode,
            compositionIntent,
            asset_composition_intent: compositionIntent,
            transformIntent,
            transform_intent: transformIntent,
            platformContext: typeof asset.platformContext === 'string' ? asset.platformContext : null,
            renderManifest,
            render_manifest: renderManifest,
            validationManifest,
            validation_manifest: validationManifest,
            renderer_id: rendererId,
          };
        })
      : [];

    const scheduleValidation = validateCreatorPublishSemantics({
      platform: rawPlatform,
      contentType: rawContentType,
      text: content,
      mediaUrls: normalizedMediaUrls,
      creatorAttachmentMetadata: normalizedCreatorAttachments,
    });
    if (scheduleValidation.ok === false) {
      recordCreatorRenderMetric({
        name: 'scheduler_validation_rejection',
        tags: { platform: rawPlatform, contentType: rawContentType, errors: scheduleValidation.errors.join(',') },
      });
      await Promise.all(scheduleValidation.normalizedMetadata.map((entry, index) => persistCreatorValidationManifest({
        rendererId: entry.renderer_id ?? 'unknown-renderer',
        assetType: String(entry.asset_composition_intent?.assetType ?? rawContentType),
        platform: rawPlatform,
        attachmentMode: entry.attachment_mode,
        renderManifest: (entry.render_manifest ?? {}) as unknown as Record<string, unknown>,
        validationManifest: {
          phase: 'schedule_hard_validation',
          ok: false,
          index,
          errors: scheduleValidation.errors,
          warnings: scheduleValidation.warnings,
        },
        auditId: `schedule:${rawPlatform}:${index}`,
      })));
      return res.status(422).json({
        error: 'CREATOR_ATTACHMENT_SCHEDULE_VALIDATION_FAILED',
        errors: scheduleValidation.errors,
        warnings: scheduleValidation.warnings,
      });
    }

    const insertPayload: Record<string, any> = {
      user_id: userId,
      platform: dbPlatform,
      content_type: dbContentType,
      content,
      title: title || null,
      hashtags: hashtagArray.length ? hashtagArray : null,
      media_urls: normalizedMediaUrls.length
        ? normalizedMediaUrls
        : (mediaType && mediaType !== 'none' ? [] : null),
      media_types: normalizedMediaTypes.length ? normalizedMediaTypes : null,
      creator_attachment_metadata: normalizedCreatorAttachments.length ? normalizedCreatorAttachments : null,
      scheduled_for: scheduledFor,
      status: 'scheduled',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (accountId) {
      insertPayload.social_account_id = accountId;
    }

    const { data: newPost, error: insertError } = await supabase
      .from('scheduled_posts')
      .insert(insertPayload)
      .select('id, platform, content, scheduled_for, status')
      .single();

    if (insertError || !newPost) {
      console.error('[scheduler/schedule] insert failed:', insertError);
      return res.status(500).json({ error: insertError?.message || 'Failed to schedule post' });
    }

    if (accountId && newPost?.id) {
      try {
        await enqueueScheduledPostAt(
          newPost.id,
          userId,
          String(accountId),
          String(scheduledFor),
        );
      } catch (enqueueError: any) {
        console.warn('[scheduler/schedule] enqueueScheduledPostAt failed (non-fatal):', enqueueError?.message);
      }
    }

    return res.status(201).json({
      id: newPost.id,
      message: 'Post scheduled successfully',
      data: newPost,
    });

  } catch (error: any) {
    console.error('[scheduler/schedule] error:', error);
    return res.status(500).json({ error: error.message });
  }
}
