import { NextApiRequest, NextApiResponse } from 'next';

// LEGACY ENGINE - DO NOT EXTEND
// Scheduled for removal after DB-platform intelligence cutover.
import { supabase } from '@/backend/db/supabaseClient';
import { createLegacyScheduledPost } from '@/backend/services/structuredPlanScheduler';

interface PostRequest {
  platform: string;
  content: string;
  title?: string;
  hashtags?: string;
  mediaUrl?: string;
  scheduledFor?: string;
  accountId: string;
}

const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const cookieEntries = Object.entries(req.cookies || {});
  const directToken = req.cookies?.['sb-access-token'];
  if (directToken) return directToken;
  for (const [name, value] of cookieEntries) {
    if (!name.startsWith('sb-') || !name.endsWith('-auth-token')) continue;
    try {
      const parsed = JSON.parse(value as any);
      if (parsed?.access_token) return String(parsed.access_token);
    } catch {
      // ignore malformed cookie
    }
  }
  return null;
};

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const token = extractAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    return null;
  }
  return data.user.id;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log(`[NEW SCHEDULER ACTIVE] invoked pages/api/social/post.ts handler (${req.method || 'unknown'})`);
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { platform, content, title, hashtags, mediaUrl, scheduledFor, accountId } = req.body as PostRequest;

    // Validate required fields
    if (!platform || !content || !accountId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const tagList =
      typeof hashtags === 'string'
        ? hashtags
            .split(/[\s,]+/g)
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    const scheduledPost = await createLegacyScheduledPost({
      userId,
      socialAccountId: accountId,
      platform,
      contentType: 'post',
      content,
      title,
      hashtags: tagList,
      mediaUrls: mediaUrl ? [mediaUrl] : [],
      scheduledFor: scheduledFor || new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      platform,
      postId: scheduledPost.id,
      message: 'Post published successfully',
      data: scheduledPost,
    });

  } catch (error: any) {
    console.error('Posting error:', error);
    res.status(500).json({ 
      error: error.message,
      success: false 
    });
  }
}























