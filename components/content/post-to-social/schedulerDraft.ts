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
            content_id?: string;
            master_content?: Record<string, unknown> & {
              objective?: string;
              decision_trace?: { objective?: string };
            };
            platform_variant?: {
              platform?: string;
              generated_content?: string;
              discoverability_meta?: { hashtags?: string[] };
            };
          };
          topic?: string;
        };

        // Wave 1 (item 8) — resolve the canonical Content id from whatever payload
        // shape carried the handoff: the social-posting draft (draft.contentId)
        // first, then a generated ShortformResultPage payload (output.content_id).
        // Absent ⇒ null, keeping the scheduler on its legacy sessionStorage path.
        const resolveContentId = (): string | null => {
          const fromDraft = typeof parsed?.draft?.contentId === 'string' ? parsed.draft.contentId.trim() : '';
          if (fromDraft) return fromDraft;
          const fromOutput = typeof parsed?.output?.content_id === 'string' ? parsed.output.content_id.trim() : '';
          return fromOutput || null;
        };

        // WS1 client half — resolve the strategic objective from whatever payload
        // shape carried the handoff: the social-posting draft (draft.objective),
        // then the generated master_content.objective, then the master decision
        // trace objective (ShortformResultPage payloads). Absent ⇒ null (never a
        // fabricated default).
        const resolveObjective = (): string | null => {
          const fromDraft = typeof parsed?.draft?.objective === 'string' ? parsed.draft.objective.trim() : '';
          if (fromDraft) return fromDraft;
          const mc = parsed?.output?.master_content;
          const fromMaster = typeof mc?.objective === 'string' ? mc.objective.trim() : '';
          if (fromMaster) return fromMaster;
          const fromTrace = typeof mc?.decision_trace?.objective === 'string' ? mc.decision_trace.objective.trim() : '';
          return fromTrace || null;
        };

        if (parsed?.draft?.content?.trim()) {
          const mediaUrls = Array.isArray(parsed.draft.mediaUrls)
            ? parsed.draft.mediaUrls.map((url) => String(url || '').trim()).filter(Boolean)
            : [];
          const mediaTypes = Array.isArray(parsed.draft.mediaTypes)
            ? parsed.draft.mediaTypes.map((type) => String(type || '').trim()).filter(Boolean)
            : [];
          const creatorAttachments = Array.isArray(parsed.draft.creatorAttachments)
            ? parsed.draft.creatorAttachments.filter((attachment) => attachment && typeof attachment === 'object')
            : [];
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
            contentId: resolveContentId(),
            masterContent: parsed.draft.masterContent || null,
            sourcePlatform: parsed.draft.sourcePlatform || null,
            mediaUrls,
            mediaTypes,
            creatorAttachments,
            objective: resolveObjective(),
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
            // WS2 (reviewed == published): seed from the platform_variant the
            // user actually reviewed on the result page, not the platform-
            // agnostic master. Master is still preserved in `masterContent` for
            // explicit, user-driven re-derivation.
            content: generated || master,
            hashtags: parsed?.output?.platform_variant?.discoverability_meta?.hashtags || [],
            excerpt: null,
            sourceContentType,
            sourceId,
            contentId: resolveContentId(),
            masterContent: parsed?.output?.master_content || null,
            sourcePlatform: parsed?.output?.platform_variant?.platform || null,
            objective: resolveObjective(),
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
