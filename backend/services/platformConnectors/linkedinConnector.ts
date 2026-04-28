import type { CommunityAiAction } from '../communityAiActionExecutor';
import type { PlatformConnector } from './baseConnector';

const LINKEDIN_API = 'https://api.linkedin.com/v2';

// LinkedIn deprecated /v2/me + r_liteprofile. The current path is OIDC:
// scopes `openid profile email`, endpoint /v2/userinfo, member id in `sub`.
const getActorUrn = async (authToken: string) => {
  const response = await fetch(`${LINKEDIN_API}/userinfo`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LinkedIn userinfo lookup failed: ${errorText}`);
  }
  const profile = await response.json();
  const memberId = profile?.sub;
  if (!memberId || typeof memberId !== 'string') {
    throw new Error('LinkedIn userinfo response missing sub claim');
  }
  return `urn:li:person:${memberId}`;
};

const postJson = async (
  url: string,
  body: Record<string, any>,
  authToken: string,
  options?: { idempotentStatuses?: number[] },
) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }
  const idempotentOk = options?.idempotentStatuses?.includes(response.status) ?? false;
  if (!response.ok && !idempotentOk) {
    throw new Error(
      typeof payload === 'string'
        ? payload
        : payload?.message || `LinkedIn request failed (${response.status})`
    );
  }
  return { status: response.status, data: payload, idempotent: idempotentOk };
};

const normalizeTargetUrn = (targetId: string) => targetId.trim();

const isUrl = (value: string) => /^https?:\/\//i.test(value);

const extractLinkedInId = (result: { data?: any } | null): string | null => {
  const data = result?.data;
  if (!data || typeof data !== 'object') return null;
  const candidate = data.id ?? data.object ?? data?.value?.id ?? null;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
};

export const executeAction: PlatformConnector['executeAction'] = async (action, authToken) => {
  if (action.execution_mode && action.execution_mode !== 'api') {
    return { success: false, error: 'EXECUTION_MODE_NOT_ALLOWED' };
  }

  const actor = await getActorUrn(authToken);
  const target = normalizeTargetUrn(action.target_id);

  try {
    if (action.action_type === 'reply') {
      if (!action.suggested_text) {
        return { success: false, error: 'SUGGESTED_TEXT_REQUIRED' };
      }
      // Threading rule for LinkedIn comments:
      //   /socialActions/{shareUrn}/comments — URL is ALWAYS the post URN
      //   body.parentComment — present iff this is a reply to a specific
      //                        comment (not a top-level comment on the post)
      // Without parentComment, LinkedIn drops the new comment at the post
      // root, which is what the user saw when replies were ending up as
      // separate top-level comments instead of nested under the original.
      const parentCommentUrn = (action as { parent_comment_urn?: string | null }).parent_comment_urn || null;
      let shareUrn = target;
      // If target was set to a comment URN by mistake, extract the embedded
      // activity URN: urn:li:comment:(urn:li:activity:1234,5678) → urn:li:activity:1234
      if (/^urn:li:comment:/i.test(shareUrn)) {
        const m = shareUrn.match(/urn:li:(activity|share|ugcPost):[^,)]+/i);
        if (m) shareUrn = m[0];
      }
      const body: Record<string, unknown> = {
        actor,
        message: { text: action.suggested_text },
      };
      if (parentCommentUrn && /^urn:li:comment:/i.test(parentCommentUrn)) {
        body.parentComment = parentCommentUrn;
      }
      const result = await postJson(
        `${LINKEDIN_API}/socialActions/${encodeURIComponent(shareUrn)}/comments`,
        body,
        authToken,
      );
      return { success: true, platform_id: extractLinkedInId(result), platform_response: result };
    }

    if (action.action_type === 'like') {
      // LinkedIn URL routing: parens in URL-encoded comment URNs (`%28`/`%29`)
      // get rejected with "Syntax exception in path variables". For comment
      // likes we MUST use path-segments format:
      //   /socialActions/{post_urn}/comments/{comment_id}/likes
      // For post likes the URN goes directly:
      //   /socialActions/{post_urn}/likes
      let likeUrl;
      const commentMatch = target.match(/^urn:li:comment:\((urn:li:(?:activity|share|ugcPost):[^,]+),(\d+)\)$/i);
      if (commentMatch) {
        const postUrn = commentMatch[1];
        const commentId = commentMatch[2];
        likeUrl = `${LINKEDIN_API}/socialActions/${encodeURIComponent(postUrn)}/comments/${commentId}/likes`;
      } else {
        likeUrl = `${LINKEDIN_API}/socialActions/${encodeURIComponent(target)}/likes`;
      }
      // 409 from /likes means "already liked by this actor" — same outcome
      // as a fresh 201, so we treat it as success rather than letting the
      // executor fall back to browser mode.
      const result = await postJson(
        likeUrl,
        { actor },
        authToken,
        { idempotentStatuses: [409] },
      );
      return {
        success: true,
        platform_id: extractLinkedInId(result) ?? target,
        platform_response: { ...result, already_liked: result.idempotent === true, like_url: likeUrl },
      };
    }

    if (action.action_type === 'share') {
      if (!action.suggested_text) {
        return { success: false, error: 'SUGGESTED_TEXT_REQUIRED' };
      }
      const shareContent = isUrl(target)
        ? {
            shareCommentary: { text: action.suggested_text },
            shareMediaCategory: 'ARTICLE',
            media: [{ status: 'READY', originalUrl: target }],
          }
        : {
            shareCommentary: { text: action.suggested_text },
            shareMediaCategory: 'NONE',
          };
      const result = await postJson(
        `${LINKEDIN_API}/ugcPosts`,
        {
          author: actor,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': shareContent,
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
          },
        },
        authToken
      );
      return { success: true, platform_id: extractLinkedInId(result), platform_response: result };
    }

    return { success: false, error: 'ACTION_TYPE_NOT_SUPPORTED' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'LINKEDIN_EXECUTION_FAILED' };
  }
};
