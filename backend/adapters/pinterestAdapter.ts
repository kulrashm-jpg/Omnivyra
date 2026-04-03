/**
 * Pinterest Adapter
 * 
 * Publishes pins to Pinterest using the Pinterest API v5.
 * 
 * API Documentation: https://developers.pinterest.com/docs/api/v5/
 * 
 * Required OAuth Scopes:
 * - boards:read
 * - boards:write
 * - pins:read
 * - pins:write
 * 
 * To obtain credentials:
 * 1. Create app at https://developers.pinterest.com/apps/
 * 2. Get App ID and App Secret
 * 3. Configure redirect URI: {BASE_URL}/api/auth/pinterest/callback
 * 4. Request access to API (may require approval)
 * 
 * Environment Variables:
 * - PINTEREST_APP_ID
 * - PINTEREST_APP_SECRET
 * - USE_MOCK_PLATFORMS=true (for testing)
 */

import axios from 'axios';
import { PublishResult } from './platformAdapter';
import { formatContentForPlatform } from '../utils/contentFormatter';
import { config } from '@/config';

interface ScheduledPost {
  id: string;
  platform: string;
  content: string; // Pin description
  title?: string; // Pin title
  hashtags?: string[];
  media_urls?: string[]; // Image URLs (required)
  scheduled_for: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  platform_user_id: string; // Pinterest user ID
  username?: string;
}

interface Token {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
}

/**
 * Get or create Pinterest board
 * 
 * Pins must be associated with a board
 */
async function getOrCreateBoard(
  boardName: string,
  description: string,
  token: Token
): Promise<string> {
  // First, try to find existing board
  const boardsResponse = await axios.get('https://api.pinterest.com/v5/boards', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
    params: {
      page_size: 25,
    },
  });

  const existingBoard = boardsResponse.data.items?.find(
    (board: any) => board.name === boardName
  );

  if (existingBoard) {
    return existingBoard.id;
  }

  // Create new board if not found
  const createResponse = await axios.post(
    'https://api.pinterest.com/v5/boards',
    {
      name: boardName,
      description: description,
      privacy: 'PUBLIC',
    },
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return createResponse.data.id;
}

/**
 * Create a pin on Pinterest
 */
export async function publishToPinterest(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  // Use mock mode if enabled
  if (config.USE_MOCK_PLATFORMS === true) {
    console.log('🧪 MOCK MODE: Simulating Pinterest pin creation');
    return {
      success: true,
      platform_post_id: `mock_pinterest_${Date.now()}`,
      post_url: `https://www.pinterest.com/pin/mock_${Date.now()}`,
      published_at: new Date(),
    };
  }

  try {
    // Format content for Pinterest
    const formattedContent = formatContentForPlatform('pinterest', post.content, {
      hashtags: post.hashtags || [],
    });

    // Pinterest requires image media
    if (!post.media_urls || post.media_urls.length === 0) {
      return {
        success: false,
        error: {
          code: 'MISSING_MEDIA',
          message: 'Pinterest pins require an image',
          retryable: false,
        },
      };
    }

    const imageUrl = post.media_urls[0];
    const boardName = post.title || 'My Pins';
    const pinTitle = post.title || formattedContent.text.substring(0, 100);
    const pinDescription = formattedContent.text;

    // Get or create board
    const boardId = await getOrCreateBoard(boardName, 'Pins from Virality Platform', token);

    // Create pin
    const pinResponse = await axios.post(
      'https://api.pinterest.com/v5/pins',
      {
        board_id: boardId,
        media_source: {
          source_type: 'image_url',
          url: imageUrl,
        },
        title: pinTitle,
        description: pinDescription,
        link: post.media_urls[1] || '', // Optional link destination
      },
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const pinId = pinResponse.data.id;

    console.log('✅ Pinterest pin created successfully:', pinId);

    return {
      success: true,
      platform_post_id: pinId,
      post_url: `https://www.pinterest.com/pin/${pinId}`,
      published_at: new Date(),
    };
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ Pinterest publish error:', errorDetails);

    // Handle specific Pinterest API errors
    let errorCode = 'API_ERROR';
    let retryable = false;

    if (error.response?.status === 401) {
      errorCode = 'AUTH_ERROR';
      retryable = true;
    } else if (error.response?.status === 403) {
      errorCode = 'PERMISSION_ERROR';
    } else if (error.response?.status === 429) {
      errorCode = 'RATE_LIMIT';
      retryable = true;
    } else if (error.response?.status >= 500) {
      retryable = true;
    }

    return {
      success: false,
      error: {
        code: errorCode,
        message: errorDetails?.message || error.message || 'Failed to create Pinterest pin',
        retryable,
      },
    };
  }
}
