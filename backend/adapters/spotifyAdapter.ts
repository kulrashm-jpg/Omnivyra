/**
 * Spotify Adapter
 * 
 * Publishes/shares content to Spotify using the Spotify Web API.
 * 
 * IMPORTANT: Spotify doesn't have a native "post" feature.
 * This adapter works with:
 * - Playlist creation and updates (with descriptions)
 * - Track/album sharing (via external links)
 * - User profile updates (bio)
 * 
 * API Documentation: https://developer.spotify.com/documentation/web-api
 * 
 * Required OAuth Scopes:
 * - playlist-modify-public
 * - playlist-modify-private
 * - user-read-private
 * - user-read-email
 * - user-modify-playback-state (for advanced features)
 * 
 * To obtain credentials:
 * 1. Create app at https://developer.spotify.com/dashboard
 * 2. Configure redirect URI: {BASE_URL}/api/auth/spotify/callback
 * 3. Get Client ID and Client Secret
 * 
 * Environment Variables:
 * - SPOTIFY_CLIENT_ID
 * - SPOTIFY_CLIENT_SECRET
 * - USE_MOCK_PLATFORMS=true (for testing)
 * 
 * Note: Since Spotify doesn't support direct posting, we'll:
 * - Create/update playlists with rich descriptions
 * - Share tracks/albums with custom messages
 * - Use external sharing mechanisms
 */

import axios from 'axios';
import { PublishResult } from './platformAdapter';
import { formatContentForPlatform } from '../utils/contentFormatter';

interface ScheduledPost {
  id: string;
  platform: string;
  content: string; // Playlist description or share message
  title?: string; // Playlist name or track title
  hashtags?: string[];
  media_urls?: string[]; // Track/album URLs (optional)
  scheduled_for: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  platform_user_id: string; // Spotify user ID
  username?: string;
}

interface Token {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
}

/**
 * Create or update Spotify playlist with content
 */
async function createSpotifyPlaylist(
  playlistName: string,
  description: string,
  userId: string,
  token: Token
): Promise<{ id: string; external_urls: { spotify: string } }> {
  const response = await axios.post(
    `https://api.spotify.com/v1/users/${userId}/playlists`,
    {
      name: playlistName,
      description: description,
      public: true,
    },
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

/**
 * Add tracks to playlist (if track URLs provided)
 */
async function addTracksToPlaylist(
  playlistId: string,
  trackUris: string[],
  token: Token
): Promise<void> {
  if (trackUris.length === 0) return;

  await axios.post(
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
    {
      uris: trackUris,
    },
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * Publish/share content to Spotify
 * 
 * Strategy: Create a playlist with the post content as description
 */
export async function publishToSpotify(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  // Use mock mode if enabled
  if (process.env.USE_MOCK_PLATFORMS === 'true') {
    console.log('🧪 MOCK MODE: Simulating Spotify playlist creation');
    return {
      success: true,
      platform_post_id: `mock_spotify_${Date.now()}`,
      post_url: `https://open.spotify.com/playlist/mock_${Date.now()}`,
      published_at: new Date(),
    };
  }

  try {
    // Format content for Spotify
    const formattedContent = formatContentForPlatform('spotify', post.content, {
      hashtags: post.hashtags || [],
    });

    const playlistName = post.title || 'Shared Playlist';
    const playlistDescription = formattedContent.text;

    // Create playlist with post content
    const playlist = await createSpotifyPlaylist(
      playlistName,
      playlistDescription,
      account.platform_user_id,
      token
    );

    // If track URLs provided, add them to playlist
    if (post.media_urls && post.media_urls.length > 0) {
      // Convert Spotify track URLs to URIs
      const trackUris = post.media_urls
        .map((url) => {
          // Extract track ID from Spotify URL
          const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
          if (match) {
            return `spotify:track:${match[1]}`;
          }
          return null;
        })
        .filter((uri): uri is string => uri !== null);

      if (trackUris.length > 0) {
        await addTracksToPlaylist(playlist.id, trackUris, token);
      }
    }

    console.log('✅ Spotify playlist created successfully:', playlist.id);

    return {
      success: true,
      platform_post_id: playlist.id,
      post_url: playlist.external_urls.spotify,
      published_at: new Date(),
    };
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ Spotify publish error:', errorDetails);

    // Handle specific Spotify API errors
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
        message: errorDetails?.error?.message || error.message || 'Failed to publish to Spotify',
        retryable,
      },
    };
  }
}
