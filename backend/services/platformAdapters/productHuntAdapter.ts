/**
 * Product Hunt Adapter
 *
 * Implements IPlatformAdapter for Product Hunt.
 * Supports post creation, comment ingestion.
 */

import type {
  IPlatformAdapter,
  PublishContentPayload,
  FetchCommentsParams,
  PlatformCredentials,
  PublishResult,
  ConnectionTestResult,
} from './baseAdapter';
import type { CommunityMessage } from './communityAdapterTypes';
import { withRateLimit } from './baseAdapter';

const PRODUCTHUNT_API = 'https://api.producthunt.com/v2/api/graphql';

async function fetchGraphql(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<any> {
  const response = await fetch(PRODUCTHUNT_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.errors) {
    throw new Error(data?.errors?.[0]?.message || `Product Hunt request failed (${response.status})`);
  }
  return data?.data;
}

const notSupported = (method: string) =>
  ({ success: false, error: `Product Hunt does not support ${method} via this adapter` });

export const productHuntAdapter: IPlatformAdapter = {
  platformKey: 'producthunt',

  async publishContent(
    payload: PublishContentPayload,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    return withRateLimit('producthunt', async () => {
      try {
        const res = await fetchGraphql(
          `mutation CreatePost($topicId: ID!, $name: String!, $tagline: String!, $description: String) {
            createPost(input: { topicId: $topicId, name: $name, tagline: $tagline, description: $description }) {
              post { id, url }
            }
          }`,
          {
            topicId: payload.platform_post_id || '1',
            name: payload.title ?? payload.content?.slice(0, 80) ?? 'Post',
            tagline: payload.content?.slice(0, 60) ?? '',
            description: payload.content ?? '',
          },
          credentials.access_token
        );
        const post = res?.createPost?.post;
        return {
          success: true,
          platform_post_id: post?.id,
          post_url: post?.url,
        };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Product Hunt post failed' };
      }
    });
  },

  async replyToComment(): Promise<{ success: boolean; error?: string }> {
    return notSupported('replies');
  },

  async likeComment(): Promise<{ success: boolean; error?: string }> {
    return notSupported('like');
  },

  async fetchComments(params: FetchCommentsParams): Promise<CommunityMessage[]> {
    return withRateLimit('producthunt', async () => {
      const postId = params.platformPostId;
      const res = await fetchGraphql(
        `query GetPost($postId: ID!) {
          post(id: $postId) {
            comments(first: 100) {
              edges {
                node {
                  id
                  body
                  createdAt
                  user { username name }
                }
              }
            }
          }
        }`,
        { postId },
        params.accessToken
      );
      const edges = res?.post?.comments?.edges ?? [];
      return edges.map((e: any) => {
        const n = e?.node ?? {};
        return {
          thread_id: postId,
          message_id: n.id ?? `ph_${Date.now()}`,
          author: n.user?.username ?? n.user?.name ?? 'Unknown',
          text: n.body ?? '',
          created_at: n.createdAt ?? new Date().toISOString(),
          platform: 'producthunt',
        };
      });
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('producthunt', async () => {
      try {
        const res = await fetchGraphql(
          '{ viewer { id username } }',
          {},
          credentials.access_token
        );
        if (res?.viewer?.id) {
          return { success: true, message: 'Connection test passed' };
        }
        return { success: false, error: 'Product Hunt user not found' };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Connection test failed' };
      }
    });
  },
};
