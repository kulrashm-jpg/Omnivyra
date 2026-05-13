import type { NextRouter } from 'next/router';

export type WriterSourceType = 'post' | 'thread';
export type CreatorAssetLaunchType = 'image' | 'banner' | 'infographic' | 'carousel' | 'pdf' | 'slider';

/**
 * Image render mode — dictates whether the final image carries embedded
 * structured text or stands on its own as a complementary visual.
 *
 *   composition    — provider generates a fully-composed social image; the
 *                    renderer SKIPS the deterministic overlay composite.
 *                    The Writer's post/thread text stays outside the image.
 *   text_embedded  — provider generates a textless background with negative
 *                    space; the renderer composites the deterministic SVG
 *                    overlay (hook / headline / keyInsight / cta) on top.
 *
 * Threaded through: Writer launcher → URL query → Creator state →
 * generate request → renderer input → asset metadata. The downstream
 * branches are pure additions; legacy callers that omit the mode get the
 * audit-defined Writer default (`composition`).
 */
export type ImageMode = 'composition' | 'text_embedded';

export const IMAGE_MODE = {
  COMPOSITION:   'composition'   as const,
  TEXT_EMBEDDED: 'text_embedded' as const,
};

/** The default mode when launched from Writer. Audit-driven choice. */
export const DEFAULT_WRITER_IMAGE_MODE: ImageMode = 'composition';

export type WriterOverlayText = {
  hook: string;
  headline: string;
  keyInsight: string;
  cta: string;
  supportingText: string;
};

export type WriterCreatorSourcePayload = {
  id: string;
  sourceType: WriterSourceType;
  sourceId: string;
  title: string;
  body: string;
  cta?: string;
  audience?: string;
  tone?: string;
  platform?: string;
  hashtags?: string[];
  companyName?: string;
  brandContext?: Record<string, unknown>;
  threadSegments?: string[];
  overlayText?: WriterOverlayText;
  /**
   * Audit-driven Writer default. The launcher always stamps the field so
   * downstream consumers can rely on its presence; user toggles in the
   * Creator UI override it during the session.
   */
  imageMode?: ImageMode;
  /**
   * The recommendation surfaced by {@link recommendImageMode} at launch
   * time. The Creator UI shows this as a hint next to the mode selector
   * (e.g. "Recommended for threads with a clear hook sequence").
   */
  recommendedImageMode?: ImageMode;
  createdAt: string;
};

export type WriterAttachedAsset = {
  id: string;
  creatorType: CreatorAssetLaunchType;
  title: string;
  url?: string;
  files?: string[];
  previewKind?: string;
  /**
   * Image-mode identity for `creatorType === 'image'`. Null for other
   * creator types. Persisted so reopening / remixing an asset preserves
   * its mode without forcing the user to re-pick.
   */
  imageMode?: ImageMode | null;
  platformContext?: string;
  renderIdentityHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export const POST_CREATOR_ASSET_TYPES: CreatorAssetLaunchType[] = ['image', 'banner', 'infographic', 'carousel', 'pdf'];
export const THREAD_CREATOR_ASSET_TYPES: CreatorAssetLaunchType[] = ['image', 'banner', 'infographic', 'carousel', 'pdf', 'slider'];

export function getWriterAttachedAssetsKey(sourceType: WriterSourceType, sourceId: string): string {
  return `writer_attached_assets_${sourceType}_${sourceId || 'draft'}`;
}

export function getWriterCreatorPrefillKey(token: string): string {
  return `writer_creator_prefill_${token}`;
}

export function createWriterSourceId(sourceType: WriterSourceType, id?: string | null): string {
  return `${sourceType}:${String(id || 'draft').trim() || 'draft'}`;
}

function compactOverlayText(value: unknown, maxLength = 120): string {
  const text = String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[#*_`~>|]+/g, '')
    .replace(/\b(optimize seo|seo optimized|keyword rich|keyword stuffing)\b/gi, 'search intent')
    .replace(/\b(unlock|game-changing|revolutionary|elevate your brand)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : maxLength).trim()}...`;
}

function splitSentences(value: string): string[] {
  return value
    .replace(/\n+/g, '. ')
    .split(/(?<=[.!?])\s+|;\s+/)
    .map((sentence) => compactOverlayText(sentence, 150))
    .filter((sentence) => sentence.length >= 16);
}

function scoreSentence(sentence: string): number {
  const lower = sentence.toLowerCase();
  let score = Math.min(sentence.length, 120) / 20;
  if (sentence.endsWith('?')) score += 4;
  if (/\b(why|how|what|when|stop|start|without|before|after|instead|most|best|worst)\b/.test(lower)) score += 3;
  if (/\b(results?|growth|conversion|revenue|traffic|pipeline|performance|customers?|risk|opportunity)\b/.test(lower)) score += 2;
  if (/\b(click here|read more|learn more|follow for more|seo optimized|unlock growth)\b/.test(lower)) score -= 3;
  if (sentence.length > 120) score -= 2;
  return score;
}

function pickStrongSentence(sentences: string[], excluded = new Set<string>()): string {
  return [...sentences]
    .filter((sentence) => !excluded.has(sentence))
    .sort((a, b) => scoreSentence(b) - scoreSentence(a))[0] || '';
}

export function extractWriterOverlayCandidates(input: {
  title: string;
  body: string;
  cta?: string;
  threadSegments?: string[];
  brandContext?: Record<string, unknown>;
}): WriterOverlayText {
  const threadSegments = Array.isArray(input.threadSegments)
    ? input.threadSegments.map((segment) => compactOverlayText(segment, 150)).filter(Boolean)
    : [];
  const sourceBody = [
    input.body,
    ...threadSegments,
  ].filter(Boolean).join('\n');
  const sentences = splitSentences(sourceBody);
  const title = compactOverlayText(input.title, 78);
  const threadHook = threadSegments[0] || '';
  const strongestThreadMiddle = threadSegments.length > 2
    ? threadSegments.slice(1, -1).sort((a, b) => scoreSentence(b) - scoreSentence(a))[0]
    : threadSegments[1] || '';
  const hook = compactOverlayText(threadHook || pickStrongSentence(sentences) || title, 82);
  const excluded = new Set([hook]);
  const keyInsight = compactOverlayText(
    strongestThreadMiddle ||
    pickStrongSentence(sentences, excluded) ||
    input.brandContext?.outcomePromise ||
    input.brandContext?.positioning ||
    title,
    118,
  );
  excluded.add(keyInsight);
  const supportingText = compactOverlayText(
    threadSegments.length > 2 ? threadSegments[threadSegments.length - 2] :
    pickStrongSentence(sentences, excluded) ||
    input.brandContext?.audience ||
    '',
    110,
  );
  const suppliedCta = compactOverlayText(input.cta || '', 42);
  const cta = suppliedCta && !/^(click here|read more|submit)$/i.test(suppliedCta)
    ? suppliedCta
    : 'Learn more';

  return {
    hook,
    headline: title || compactOverlayText(hook, 72),
    keyInsight,
    cta,
    supportingText,
  };
}

export function readWriterAttachedAssets(sourceType: WriterSourceType, sourceId: string): WriterAttachedAsset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getWriterAttachedAssetsKey(sourceType, sourceId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as WriterAttachedAsset[] : [];
  } catch {
    return [];
  }
}

export function appendWriterAttachedAsset(
  sourceType: WriterSourceType,
  sourceId: string,
  asset: WriterAttachedAsset,
): void {
  if (typeof window === 'undefined') return;
  const current = readWriterAttachedAssets(sourceType, sourceId);
  const deduped = current.filter((item) => item.id !== asset.id);
  window.localStorage.setItem(
    getWriterAttachedAssetsKey(sourceType, sourceId),
    JSON.stringify([asset, ...deduped].slice(0, 12)),
  );
}

export async function loadWriterAttachedAssetsDurable(input: {
  companyId?: string | null;
  sourceType: WriterSourceType;
  sourceId: string;
}): Promise<WriterAttachedAsset[]> {
  const local = readWriterAttachedAssets(input.sourceType, input.sourceId);
  if (!input.companyId || typeof window === 'undefined') return local;
  try {
    const params = new URLSearchParams({
      company_id: input.companyId,
      source_type: input.sourceType,
      source_id: input.sourceId,
    });
    const response = await fetch(`/api/creator-assets/attachments?${params.toString()}`, {
      credentials: 'include',
    });
    if (!response.ok) return local;
    const data = await response.json().catch(() => ({}));
    const remote = Array.isArray(data.attachments) ? data.attachments as WriterAttachedAsset[] : [];
    if (remote.length > 0) {
      try {
        window.localStorage.setItem(getWriterAttachedAssetsKey(input.sourceType, input.sourceId), JSON.stringify(remote.slice(0, 12)));
      } catch {
        // Keep durable result even when local fallback cannot be refreshed.
      }
      return remote;
    }
    return local;
  } catch {
    return local;
  }
}

export async function appendWriterAttachedAssetDurable(input: {
  companyId?: string | null;
  sourceType: WriterSourceType;
  sourceId: string;
  asset: WriterAttachedAsset;
  sourceContent?: Record<string, unknown>;
}): Promise<WriterAttachedAsset> {
  appendWriterAttachedAsset(input.sourceType, input.sourceId, input.asset);
  if (!input.companyId || typeof window === 'undefined') return input.asset;
  try {
    const response = await fetch('/api/creator-assets/attachments', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: input.companyId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        asset: input.asset,
        source_content: input.sourceContent || null,
      }),
    });
    if (!response.ok) return input.asset;
    const data = await response.json().catch(() => ({}));
    return (data.attachment || input.asset) as WriterAttachedAsset;
  } catch {
    return input.asset;
  }
}

/**
 * Recommend an image mode at launch time based on the source content.
 *
 * Rules (audit-driven):
 *   - Threads with a strong hook + 3+ segments → recommend `text_embedded`
 *     because the structured hook/insight sequence renders well as overlay.
 *   - Posts that look like single-sentence punchlines (quote-style) with a
 *     short hook → recommend `text_embedded`.
 *   - Everything else → recommend `composition` (the Writer default).
 *
 * The user can override the recommendation in the Creator UI. The
 * returned value is ALSO used by `buildWriterCreatorPrefill` to seed
 * `recommendedImageMode` on the payload.
 */
export function recommendImageMode(input: {
  sourceType: WriterSourceType;
  body: string;
  threadSegments?: string[];
  overlayText?: WriterOverlayText;
}): ImageMode {
  if (input.sourceType === 'thread') {
    const segments = (input.threadSegments ?? []).filter((segment) => segment.trim().length >= 16);
    const hookStrong = !!(input.overlayText?.hook && input.overlayText.hook.length >= 24);
    if (segments.length >= 3 && hookStrong) return IMAGE_MODE.TEXT_EMBEDDED;
  }
  if (input.sourceType === 'post') {
    const body = (input.body ?? '').trim();
    const sentences = body.split(/(?<=[.!?])\s+/).filter((s) => s.length > 12);
    // Quote-like single-punchline post → text_embedded shines here.
    if (sentences.length === 1 && body.length > 40 && body.length <= 220) {
      return IMAGE_MODE.TEXT_EMBEDDED;
    }
  }
  return IMAGE_MODE.COMPOSITION;
}

export function buildWriterCreatorPrefill(input: {
  sourceType: WriterSourceType;
  sourceId: string;
  title: string;
  body: string;
  cta?: string;
  audience?: string;
  tone?: string;
  platform?: string;
  hashtags?: string[];
  companyName?: string;
  brandContext?: Record<string, unknown>;
  threadSegments?: string[];
  /** Explicit override; otherwise the Writer default + recommendation apply. */
  imageMode?: ImageMode;
}): WriterCreatorSourcePayload {
  const overlayText = extractWriterOverlayCandidates(input);
  const recommendedImageMode = recommendImageMode({
    sourceType:      input.sourceType,
    body:            input.body,
    threadSegments:  input.threadSegments,
    overlayText,
  });
  return {
    id: `${input.sourceType}-${Date.now()}`,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title,
    body: input.body,
    cta: input.cta,
    audience: input.audience,
    tone: input.tone,
    platform: input.platform,
    hashtags: input.hashtags,
    companyName: input.companyName,
    brandContext: input.brandContext,
    threadSegments: input.threadSegments,
    overlayText,
    imageMode: input.imageMode ?? DEFAULT_WRITER_IMAGE_MODE,
    recommendedImageMode,
    createdAt: new Date().toISOString(),
  };
}

export function launchCreatorFromWriter(input: {
  router: NextRouter;
  assetType: CreatorAssetLaunchType;
  source: WriterCreatorSourcePayload;
}): void {
  if (typeof window === 'undefined') return;
  const token = `${input.source.sourceType}_${input.assetType}_${Date.now()}`;
  window.sessionStorage.setItem(getWriterCreatorPrefillKey(token), JSON.stringify(input.source));
  // Surface image_mode in the URL too. The Creator page reads it as a soft
  // override of the prefill's stamped value, which means a deep link with
  // `?image_mode=text_embedded` works even if the prefill blob is stale.
  const imageMode = input.assetType === 'image' ? (input.source.imageMode ?? DEFAULT_WRITER_IMAGE_MODE) : null;
  void input.router.push({
    pathname: `/command-center/creator-content/${input.assetType}`,
    query: {
      source: 'writer',
      sourceType: input.source.sourceType,
      prefill: token,
      ...(input.source.platform ? { platform: input.source.platform } : {}),
      ...(imageMode ? { image_mode: imageMode } : {}),
    },
  });
}
