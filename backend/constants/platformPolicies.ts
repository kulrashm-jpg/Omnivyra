/**
 * Platform Policy Rules
 *
 * Restrictions per platform. Adapters enforce these when publishing.
 */

export type PlatformPolicy = {
  max_post_length?: number;
  supports_hashtags?: boolean;
  subreddit_required?: boolean;
  template_required?: boolean;
  conversation_window_hours?: number;
  requires_image?: boolean;
  answers_only?: boolean;
};

export const PLATFORM_POLICIES: Record<string, PlatformPolicy> = {
  linkedin: {
    max_post_length: 3000,
    supports_hashtags: true,
  },
  twitter: {
    max_post_length: 280,
    supports_hashtags: true,
  },
  youtube: {
    max_post_length: 5000,
  },
  reddit: {
    subreddit_required: true,
  },
  whatsapp: {
    template_required: true,
    conversation_window_hours: 24,
  },
  pinterest: {
    requires_image: true,
  },
  quora: {
    answers_only: true,
  },
};

export class PlatformPolicyError extends Error {
  constructor(public readonly platformKey: string, message: string) {
    super(message);
    this.name = 'PlatformPolicyError';
  }
}

/**
 * Validate publish payload against platform policy. Throws PlatformPolicyError if invalid.
 */
export function validatePublishPolicy(
  platformKey: string,
  payload: { content?: string; media_urls?: string[]; template_name?: string }
): void {
  const key = (platformKey || '').toString().trim().toLowerCase();
  if (!key) return;

  const policy = PLATFORM_POLICIES[key];
  if (!policy) return;

  const content = payload.content ?? '';
  if (policy.max_post_length != null && content.length > policy.max_post_length) {
    throw new PlatformPolicyError(
      key,
      `Content exceeds max length: ${policy.max_post_length} chars`
    );
  }

  if (policy.requires_image) {
    const hasMedia = Array.isArray(payload.media_urls) && payload.media_urls.length > 0;
    if (!hasMedia) {
      throw new PlatformPolicyError(key, 'Pinterest requires at least one image');
    }
  }

  if (policy.template_required) {
    const hasTemplate = !!payload.template_name;
    const hasContent = content.length > 0;
    if (!hasTemplate && !hasContent) {
      throw new PlatformPolicyError(
        key,
        'WhatsApp Business requires template_name or content'
      );
    }
  }
}
