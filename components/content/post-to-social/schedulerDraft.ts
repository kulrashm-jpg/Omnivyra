import type { SocialPostingPrefillPayload } from '@/lib/content/socialPosting';
import type { DraftPayload } from './schedulerShared';

export function resolveSchedulerDraft({
  prefill,
  topic,
  sourceContentType,
  sourceId,
}: {
  prefill: string;
  topic: string;
  sourceContentType: string;
  sourceId: string | null;
}): DraftPayload {
  if (prefill && typeof window !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(prefill) || window.localStorage.getItem(prefill);
      if (raw) {
        const parsed = JSON.parse(raw) as SocialPostingPrefillPayload & {
          output?: {
            master_content?: Record<string, unknown>;
            platform_variant?: {
              platform?: string;
              generated_content?: string;
              discoverability_meta?: { hashtags?: string[] };
            };
          };
          topic?: string;
        };

        if (parsed?.draft?.content?.trim()) {
          return {
            title: parsed.draft.title || topic || 'Content Draft',
            topic: parsed.draft.topic || parsed.draft.title || topic || 'Content Draft',
            content:
              (typeof parsed.draft.masterContent?.content === 'string' && parsed.draft.masterContent.content.trim())
                ? parsed.draft.masterContent.content.trim()
                : parsed.draft.content,
            hashtags: Array.isArray(parsed.draft.hashtags) ? parsed.draft.hashtags : [],
            excerpt: parsed.draft.excerpt || null,
            sourceContentType: parsed.draft.sourceContentType || sourceContentType,
            sourceId: parsed.draft.sourceId || sourceId,
            masterContent: parsed.draft.masterContent || null,
            sourcePlatform: null,
          };
        }

        const master = typeof parsed?.output?.master_content?.content === 'string'
          ? parsed.output.master_content.content.trim()
          : '';
        const generated = parsed?.output?.platform_variant?.generated_content?.trim();
        if (master || generated) {
          return {
            title: parsed.topic || topic || 'Generated Post',
            topic: parsed.topic || topic || 'Generated Post',
            content: master || generated,
            hashtags: parsed?.output?.platform_variant?.discoverability_meta?.hashtags || [],
            excerpt: null,
            sourceContentType,
            sourceId,
            masterContent: parsed?.output?.master_content || null,
            sourcePlatform: parsed?.output?.platform_variant?.platform || null,
          };
        }
      }
    } catch {
      // fall through to topic fallback
    }
  }

  return {
    title: topic || 'Content Draft',
    topic: topic || 'Content Draft',
    content: topic ? `Draft based on: ${topic}` : '',
    hashtags: [],
    excerpt: null,
    sourceContentType,
    sourceId,
    masterContent: null,
    sourcePlatform: null,
  };
}
