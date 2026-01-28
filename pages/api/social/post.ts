import { NextApiRequest, NextApiResponse } from 'next';

interface PostRequest {
  platform: string;
  content: string;
  title?: string;
  hashtags?: string;
  mediaUrl?: string;
  scheduledFor?: string;
  accountId: string;
}

// Platform-specific posting functions
const postToLinkedIn = async (accessToken: string, postData: PostRequest) => {
  const linkedinPost = {
    author: `urn:li:person:${postData.accountId}`,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: `${postData.title ? postData.title + '\n\n' : ''}${postData.content}${postData.hashtags ? '\n\n' + postData.hashtags : ''}`
        },
        shareMediaCategory: 'NONE'
      }
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
    }
  };

  const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify(linkedinPost)
  });

  if (!response.ok) {
    throw new Error(`LinkedIn posting failed: ${response.statusText}`);
  }

  return response.json();
};

const postToTwitter = async (accessToken: string, postData: PostRequest) => {
  const tweetText = `${postData.title ? postData.title + '\n\n' : ''}${postData.content}${postData.hashtags ? '\n\n' + postData.hashtags : ''}`;
  
  const tweetData = {
    text: tweetText.substring(0, 280) // Twitter character limit
  };

  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(tweetData)
  });

  if (!response.ok) {
    throw new Error(`Twitter posting failed: ${response.statusText}`);
  }

  return response.json();
};

const postToFacebook = async (accessToken: string, postData: PostRequest) => {
  const message = `${postData.title ? postData.title + '\n\n' : ''}${postData.content}${postData.hashtags ? '\n\n' + postData.hashtags : ''}`;
  
  const postData_fb = {
    message,
    ...(postData.mediaUrl && { link: postData.mediaUrl })
  };

  const response = await fetch(`https://graph.facebook.com/v18.0/${postData.accountId}/feed`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(postData_fb)
  });

  if (!response.ok) {
    throw new Error(`Facebook posting failed: ${response.statusText}`);
  }

  return response.json();
};

const postToInstagram = async (accessToken: string, postData: PostRequest) => {
  // Instagram requires media, so we'll create a text-based post
  const caption = `${postData.title ? postData.title + '\n\n' : ''}${postData.content}${postData.hashtags ? '\n\n' + postData.hashtags : ''}`;
  
  // For now, we'll simulate Instagram posting
  // In production, you'd need to upload media first, then create the post
  const instagramPost = {
    caption,
    media_type: 'IMAGE', // or 'VIDEO'
    ...(postData.mediaUrl && { image_url: postData.mediaUrl })
  };

  // This is a simplified version - Instagram API is more complex
  return {
    id: `instagram_${Date.now()}`,
    message: 'Instagram post created successfully',
    ...instagramPost
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { platform, content, title, hashtags, mediaUrl, accountId } = req.body;

    // Validate required fields
    if (!platform || !content || !accountId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get access token for the account (mock for now)
    // In production, fetch from database
    const mockAccessToken = `mock_token_${accountId}`;

    let result;
    const postData = { platform, content, title, hashtags, mediaUrl, accountId };

    switch (platform) {
      case 'linkedin':
        result = await postToLinkedIn(mockAccessToken, postData);
        break;
      case 'twitter':
        result = await postToTwitter(mockAccessToken, postData);
        break;
      case 'facebook':
        result = await postToFacebook(mockAccessToken, postData);
        break;
      case 'instagram':
        result = await postToInstagram(mockAccessToken, postData);
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    res.status(200).json({
      success: true,
      platform,
      postId: result.id,
      message: 'Post published successfully',
      data: result
    });

  } catch (error: any) {
    console.error('Posting error:', error);
    res.status(500).json({ 
      error: error.message,
      success: false 
    });
  }
}























