import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { companyId, title, content, hashtags, mediaType, scheduledFor, platform, accountId, contentType } = req.body;

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

    const insertPayload: Record<string, any> = {
      user_id: userId,
      platform: dbPlatform,
      content_type: dbContentType,
      content,
      title: title || null,
      hashtags: hashtagArray.length ? hashtagArray : null,
      media_urls: mediaType && mediaType !== 'none' ? [] : null,
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

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

