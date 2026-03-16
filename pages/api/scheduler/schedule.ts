import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';

const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const directToken = req.cookies?.['sb-access-token'];
  if (directToken) return directToken;
  for (const [name, value] of Object.entries(req.cookies || {})) {
    if (!name.startsWith('sb-') || !name.endsWith('-auth-token')) continue;
    try {
      const parsed = JSON.parse(value as string);
      if (parsed?.access_token) return String(parsed.access_token);
    } catch { /* ignore */ }
  }
  return null;
};

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const token = extractAccessToken(req);
  if (!token) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  return data.user.id;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { title, content, hashtags, mediaType, scheduledFor, platform, accountId } = req.body;

    if (!content || !scheduledFor || !platform) {
      return res.status(400).json({ error: 'Missing required fields: content, scheduledFor, platform' });
    }

    if (new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    const hashtagArray = hashtags
      ? hashtags.split(/\s+/).filter((t: string) => t.startsWith('#'))
      : [];

    const insertPayload: Record<string, any> = {
      user_id: userId,
      platform,
      content_type: 'post',
      content,
      title: title || null,
      hashtags: hashtagArray.length ? hashtagArray : null,
      media_urls: mediaType && mediaType !== 'none' ? [] : null,
      scheduled_for: scheduledFor,
      status: 'SCHEDULED',
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
