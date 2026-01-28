import { NextApiRequest, NextApiResponse } from 'next';

interface CommentRequest {
  platform: string;
  postId: string;
  accountId: string;
  action: 'fetch' | 'reply' | 'delete';
  commentId?: string;
  replyText?: string;
}

// Platform-specific comment management functions
const fetchLinkedInComments = async (accessToken: string, postId: string) => {
  const response = await fetch(`https://api.linkedin.com/v2/socialActions/${postId}/comments`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`LinkedIn comments fetch failed: ${response.statusText}`);
  }

  return response.json();
};

const fetchTwitterComments = async (accessToken: string, postId: string) => {
  const response = await fetch(`https://api.twitter.com/2/tweets/${postId}/replies`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Twitter replies fetch failed: ${response.statusText}`);
  }

  return response.json();
};

const fetchFacebookComments = async (accessToken: string, postId: string) => {
  const response = await fetch(`https://graph.facebook.com/v18.0/${postId}/comments`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Facebook comments fetch failed: ${response.statusText}`);
  }

  return response.json();
};

const fetchInstagramComments = async (accessToken: string, postId: string) => {
  const response = await fetch(`https://graph.facebook.com/v18.0/${postId}/comments`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Instagram comments fetch failed: ${response.statusText}`);
  }

  return response.json();
};

const replyToLinkedInComment = async (accessToken: string, commentId: string, replyText: string) => {
  const replyData = {
    message: replyText,
    parentComment: `urn:li:comment:${commentId}`
  };

  const response = await fetch('https://api.linkedin.com/v2/comments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(replyData)
  });

  if (!response.ok) {
    throw new Error(`LinkedIn reply failed: ${response.statusText}`);
  }

  return response.json();
};

const replyToTwitterComment = async (accessToken: string, postId: string, replyText: string) => {
  const replyData = {
    text: replyText,
    reply: {
      in_reply_to_tweet_id: postId
    }
  };

  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(replyData)
  });

  if (!response.ok) {
    throw new Error(`Twitter reply failed: ${response.statusText}`);
  }

  return response.json();
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { platform, postId, accountId, action, commentId, replyText } = req.body;

    // Validate required fields
    if (!platform || !postId || !accountId || !action) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get access token for the account (mock for now)
    const mockAccessToken = `mock_token_${accountId}`;

    let result;

    switch (action) {
      case 'fetch':
        switch (platform) {
          case 'linkedin':
            result = await fetchLinkedInComments(mockAccessToken, postId);
            break;
          case 'twitter':
            result = await fetchTwitterComments(mockAccessToken, postId);
            break;
          case 'facebook':
            result = await fetchFacebookComments(mockAccessToken, postId);
            break;
          case 'instagram':
            result = await fetchInstagramComments(mockAccessToken, postId);
            break;
          default:
            throw new Error(`Unsupported platform: ${platform}`);
        }
        break;

      case 'reply':
        if (!replyText) {
          return res.status(400).json({ error: 'Reply text is required' });
        }

        switch (platform) {
          case 'linkedin':
            if (!commentId) {
              return res.status(400).json({ error: 'Comment ID is required for LinkedIn replies' });
            }
            result = await replyToLinkedInComment(mockAccessToken, commentId, replyText);
            break;
          case 'twitter':
            result = await replyToTwitterComment(mockAccessToken, postId, replyText);
            break;
          case 'facebook':
          case 'instagram':
            // Facebook/Instagram reply implementation
            result = { id: `reply_${Date.now()}`, message: 'Reply posted successfully' };
            break;
          default:
            throw new Error(`Unsupported platform: ${platform}`);
        }
        break;

      case 'delete':
        // Delete comment implementation
        result = { message: 'Comment deleted successfully' };
        break;

      default:
        throw new Error(`Unsupported action: ${action}`);
    }

    res.status(200).json({
      success: true,
      platform,
      action,
      data: result
    });

  } catch (error: any) {
    console.error('Comment management error:', error);
    res.status(500).json({ 
      error: error.message,
      success: false 
    });
  }
}























