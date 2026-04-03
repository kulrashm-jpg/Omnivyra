import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  ingestComments,
  getCommentsForScheduledPost,
} from '../../../backend/services/engagementIngestionService';

// Reply helpers left unchanged for now (deprecated later per canonical design).
const replyToLinkedInComment = async (accessToken: string, commentId: string, replyText: string) => {
  const response = await fetch('https://api.linkedin.com/v2/comments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: replyText,
      parentComment: `urn:li:comment:${commentId}`,
    }),
  });
  if (!response.ok) throw new Error(`LinkedIn reply failed: ${response.statusText}`);
  return response.json();
};

const replyToTwitterComment = async (accessToken: string, postId: string, replyText: string) => {
  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: replyText,
      reply: { in_reply_to_tweet_id: postId },
    }),
  });
  if (!response.ok) throw new Error(`Twitter reply failed: ${response.statusText}`);
  return response.json();
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { platform, postId, accountId, action, commentId, replyText, scheduled_post_id } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'Missing required field: action' });
    }

    if (action === 'fetch') {
      // Resolve scheduled_post_id: from body or by (platform_post_id, social_account_id)
      let resolvedScheduledPostId: string | null = scheduled_post_id ?? null;
      if (!resolvedScheduledPostId && platform && postId && accountId) {
        const { data: row } = await supabase
          .from('scheduled_posts')
          .select('id')
          .eq('platform_post_id', postId)
          .eq('social_account_id', accountId)
          .maybeSingle();
        resolvedScheduledPostId = row?.id ?? null;
      }
      if (!resolvedScheduledPostId) {
        return res.status(400).json({
          error: 'Cannot fetch comments: provide scheduled_post_id or (platform, postId, accountId) for a published post',
        });
      }
      const ingestResult = await ingestComments(resolvedScheduledPostId);
      const comments = await getCommentsForScheduledPost(resolvedScheduledPostId);
      return res.status(200).json({
        success: true,
        platform,
        action: 'fetch',
        data: comments,
        ingested: ingestResult.ingested,
      });
    }

    if (action === 'reply') {
      if (!platform || !postId || !accountId || !replyText) {
        return res.status(400).json({ error: 'Reply requires platform, postId, accountId, replyText' });
      }
      const mockAccessToken = `mock_token_${accountId}`;
      let result: any;
      if (platform === 'linkedin') {
        if (!commentId) return res.status(400).json({ error: 'Comment ID is required for LinkedIn replies' });
        result = await replyToLinkedInComment(mockAccessToken, commentId, replyText);
      } else if (platform === 'twitter') {
        result = await replyToTwitterComment(mockAccessToken, postId, replyText);
      } else if (platform === 'facebook' || platform === 'instagram') {
        result = { id: `reply_${Date.now()}`, message: 'Reply posted successfully' };
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
      return res.status(200).json({ success: true, platform, action: 'reply', data: result });
    }

    if (action === 'delete') {
      return res.status(200).json({ success: true, platform, action: 'delete', data: { message: 'Comment deleted successfully' } });
    }

    return res.status(400).json({ error: `Unsupported action: ${action}` });
  } catch (error: any) {
    console.error('Comment management error:', error);
    return res.status(500).json({ error: error.message, success: false });
  }
}
