/**
 * LinkedIn Platform Adapter
 *
 * Implements IPlatformAdapter for LinkedIn.
 * Uses LinkedIn API v2: https://api.linkedin.com/v2
 */

import type {
  IPlatformAdapter,
  PublishContentPayload,
  FetchCommentsParams,
  PlatformCredentials,
  PublishResult,
  ConnectionTestResult,
} from './baseAdapter';
import { withRateLimit, enforcePublishPolicy, fetchJsonWithBearer } from './baseAdapter';
import { providerErrorFromResponse } from '../engagement/providerRequestError';

const LINKEDIN_API = 'https://api.linkedin.com/v2';

export const linkedinAdapter: IPlatformAdapter = {
  platformKey: 'linkedin',

  async publishContent(_payload: PublishContentPayload, credentials: PlatformCredentials): Promise<PublishResult> {
    return withRateLimit('linkedin', async () => {
      enforcePublishPolicy('linkedin', _payload);
    if (process.env.USE_MOCK_PLATFORMS === 'true') {
      return {
        success: true,
        platform_post_id: `mock_linkedin_${Date.now()}`,
        post_url: `https://www.linkedin.com/feed/update/${Date.now()}`,
      };
    }
    const me = await fetchJsonWithBearer(`${LINKEDIN_API}/me`, credentials.access_token, { extraHeaders: { 'X-Restli-Protocol-Version': '2.0.0' } });
    const author = me?.id ? `urn:li:person:${me.id}` : null;
    if (!author) throw new Error('LinkedIn profile ID missing');
    const payload = {
      author,
      lifecycleState: 'PUBLISHED' as const,
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: _payload.content },
          shareMediaCategory: 'NONE' as const,
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' as const },
    };
    const res = await fetchJsonWithBearer(`${LINKEDIN_API}/ugcPosts`, credentials.access_token, {
      init: { method: 'POST', body: JSON.stringify(payload) },
      extraHeaders: { 'X-Restli-Protocol-Version': '2.0.0' },
    });
    const id = res?.id;
    const postIdPart = id ? String(id).split(':').pop() : '';
    return {
      success: true,
      platform_post_id: id,
      post_url: postIdPart ? `https://www.linkedin.com/feed/update/${postIdPart}` : undefined,
    };
    });
  },

  async replyToComment(
    threadId: string,
    message: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('linkedin', async () => {
    try {
      await fetchJsonWithBearer(
        `${LINKEDIN_API}/socialActions/${encodeURIComponent(threadId)}/comments`,
        credentials.access_token,
        {
          init: {
            method: 'POST',
            body: JSON.stringify({
              actor: await getActorUrn(credentials.access_token),
              message: { text: message },
            }),
          },
          extraHeaders: { 'X-Restli-Protocol-Version': '2.0.0' },
        }
      );
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'LinkedIn reply failed' };
    }
    });
  },

  async likeComment(
    messageId: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('linkedin', async () => {
    try {
      await fetchJsonWithBearer(
        `${LINKEDIN_API}/socialActions/${encodeURIComponent(messageId)}/likes`,
        credentials.access_token,
        {
          init: {
            method: 'POST',
            body: JSON.stringify({ actor: await getActorUrn(credentials.access_token) }),
          },
          extraHeaders: { 'X-Restli-Protocol-Version': '2.0.0' },
        }
      );
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'LinkedIn like failed' };
    }
    });
  },

  /**
   * Comments on a post.
   *
   * `X-Restli-Protocol-Version: 2.0.0` is required by LinkedIn's v2 Rest.li
   * endpoints and every other call in this adapter sends it — this one did not,
   * which is a real defect on the exact request that has been failing. It is
   * added here so the remaining failure, if any, is unambiguously about the
   * credential rather than the protocol header.
   */
  async fetchComments(params: FetchCommentsParams): Promise<unknown> {
    return withRateLimit('linkedin', async () => {
    const response = await fetch(
      `${LINKEDIN_API}/socialActions/${encodeURIComponent(params.platformPostId)}/comments`,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          Accept: 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      }
    );
    if (!response.ok) {
      throw await providerErrorFromResponse(response, { provider: 'linkedin', endpointCategory: 'comments' });
    }
    return response.json();
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('linkedin', async () => {
    try {
      const me = await fetchJsonWithBearer(`${LINKEDIN_API}/me`, credentials.access_token, {
        extraHeaders: { 'X-Restli-Protocol-Version': '2.0.0' },
      });
      if (me?.id) {
        return { success: true, message: 'Connection test passed' };
      }
      return { success: false, error: 'LinkedIn profile ID missing' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Connection test failed' };
    }
    });
  },
};

async function getActorUrn(token: string): Promise<string> {
  const me = await fetchJsonWithBearer(`${LINKEDIN_API}/me`, token, {
    extraHeaders: { 'X-Restli-Protocol-Version': '2.0.0' },
  });
  if (!me?.id) throw new Error('LinkedIn profile ID missing');
  return `urn:li:person:${me.id}`;
}
