/**
 * Platform Content Capability Registry
 * ──────────────────────────────────────────────────────────────────────────
 * Canonical source of truth for "which content types is each social platform
 * capable of publishing." Used by:
 *   - UI: filter "Repurpose for connected platforms" so incompatible platforms
 *     never appear (e.g. hide Instagram for a text-only post).
 *   - API: server-side hard validator that rejects incompatible publishes
 *     even if a client bypasses the filter.
 *
 * NON-NEGOTIABLES (see implementation brief):
 *   - No "if Instagram" checks may live outside this registry.
 *   - All platform compatibility decisions route through
 *     `getSupportedPlatformsForContentType`.
 *   - Extensible: adding `reels` / `shorts` / `stories` / `podcasts` /
 *     `threads` is a registry-only change.
 *
 * Activation contract (Phase 2.C — asset-aware):
 *   The filter helper (`filterConnectedPlatformsForContent`) resolves a
 *   capability *set* from the input (base content capability + any
 *   capabilities unlocked by attached Creator assets). A platform is
 *   considered supported when it can publish ANY capability in the set.
 *   So a Post with an attached image asset matches BOTH `'text'` (LinkedIn,
 *   X, …) AND `'image'` (Instagram, Pinterest). The earlier "text/writer
 *   only" assumption — where Instagram was hidden for every Writer flow —
 *   is no longer valid; see `ASSET_TYPE_CAPABILITY_MAP` in
 *   `contentCapability.ts` for the asset→capability mapping.
 */

export type ContentCapability =
  | 'text'
  | 'writer'
  | 'image'
  | 'video'
  | 'carousel'
  | 'creator';

export const CONTENT_CAPABILITIES: readonly ContentCapability[] = [
  'text',
  'writer',
  'image',
  'video',
  'carousel',
  'creator',
] as const;

export interface PlatformCapabilityConfig {
  /** Canonical platform key. Aliases (twitter↔x) are resolved before lookup. */
  platform: string;
  /** Content capabilities this platform can publish. `supportedContent` is the
   *  sole authority for "can this platform publish capability X" — derived
   *  helpers (e.g. supports text-only) must compute from this list. */
  supportedContent: ContentCapability[];
  /** True when a publish without media will be rejected by the platform API
   *  EVEN FOR a capability the platform otherwise supports. This is the
   *  payload-level guard for media-first platforms (Instagram/Pinterest etc).
   *  Cannot be derived from `supportedContent` because it depends on payload
   *  state, not capability set. */
  requiresMediaForPublish: boolean;
  /** Human-readable explanation used in UI tooltips / API error messages. */
  notes?: string;
}

/** Derived: does this platform accept text-only payloads? Computed from
 *  `supportedContent` (Phase 4 — single source of truth). */
export function platformSupportsTextOnly(cfg: PlatformCapabilityConfig): boolean {
  return cfg.supportedContent.includes('text');
}

/**
 * Alias resolution. The runtime data flow uses `'x'` (see
 * `getConnectedPlatformsForCompany` and `/api/social-accounts/status`), but
 * the canonical taxonomy in `lib/shared/platforms.ts` lists `'twitter'`. The
 * registry accepts either form.
 */
const PLATFORM_KEY_ALIASES: Record<string, string> = {
  twitter: 'x',
  'twitter/x': 'x',
  tw: 'x',
  li: 'linkedin',
  fb: 'facebook',
  ig: 'instagram',
  meta: 'facebook',
};

export function normalizePlatformKey(platform: string | null | undefined): string {
  const raw = String(platform ?? '').trim().toLowerCase();
  return PLATFORM_KEY_ALIASES[raw] ?? raw;
}

/**
 * Registry. New platforms or capability changes go here and nowhere else.
 *
 * Capability mapping rules (Phase 3):
 *   - Instagram: media-first; no text-only publish path → text/writer excluded.
 *   - Pinterest: image-first → text/writer excluded.
 *   - TikTok / YouTube: video/creator content only.
 *   - LinkedIn / X / Facebook / Reddit: support text; longform (writer) only
 *     where the platform meaningfully renders it.
 *   - WhatsApp: text-only broadcast; no media-first content types.
 *   - Blog: longform writer, plus image embeds.
 */
export const PLATFORM_CAPABILITY_REGISTRY: Record<string, PlatformCapabilityConfig> = {
  linkedin: {
    platform: 'linkedin',
    supportedContent: ['text', 'writer', 'image', 'video', 'carousel'],
    requiresMediaForPublish: false,
  },
  x: {
    platform: 'x',
    supportedContent: ['text', 'writer', 'image', 'video'],
    requiresMediaForPublish: false,
  },
  facebook: {
    platform: 'facebook',
    supportedContent: ['text', 'writer', 'image', 'video', 'carousel'],
    requiresMediaForPublish: false,
  },
  instagram: {
    platform: 'instagram',
    supportedContent: ['image', 'video', 'carousel', 'creator'],
    requiresMediaForPublish: true,
    notes: 'Instagram requires media (image or video) for publishing.',
  },
  pinterest: {
    platform: 'pinterest',
    supportedContent: ['image', 'carousel'],
    requiresMediaForPublish: true,
    notes: 'Pinterest requires an image or video pin.',
  },
  tiktok: {
    platform: 'tiktok',
    supportedContent: ['video', 'creator'],
    requiresMediaForPublish: true,
    notes: 'TikTok only supports video content.',
  },
  youtube: {
    platform: 'youtube',
    supportedContent: ['video', 'creator'],
    requiresMediaForPublish: true,
    notes: 'YouTube only supports video content.',
  },
  reddit: {
    platform: 'reddit',
    supportedContent: ['text', 'writer', 'image'],
    requiresMediaForPublish: false,
  },
  whatsapp: {
    platform: 'whatsapp',
    supportedContent: ['text', 'image'],
    requiresMediaForPublish: false,
  },
  threads: {
    platform: 'threads',
    supportedContent: ['text', 'writer', 'image', 'video'],
    requiresMediaForPublish: false,
  },
  blog: {
    platform: 'blog',
    supportedContent: ['writer', 'image'],
    requiresMediaForPublish: false,
  },
};

export function getPlatformCapability(platform: string | null | undefined): PlatformCapabilityConfig | null {
  const key = normalizePlatformKey(platform);
  if (!key) return null;
  return PLATFORM_CAPABILITY_REGISTRY[key] ?? null;
}

export function platformSupportsCapability(
  platform: string | null | undefined,
  capability: ContentCapability,
): boolean {
  const cfg = getPlatformCapability(platform);
  if (!cfg) return false;
  return cfg.supportedContent.includes(capability);
}

/**
 * Given a content capability and a candidate list of platforms (typically the
 * company's connected platforms), return the subset that can actually publish
 * this capability.
 *
 * This is the SINGLE entry point for compatibility filtering. UI and server
 * MUST call it — no inline platform checks anywhere else.
 *
 * Unknown platforms are excluded (fail closed) rather than passed through —
 * an unmapped platform almost certainly means the registry is incomplete and
 * we'd rather hide a chip than let a publish fail at the adapter layer.
 */
export function getSupportedPlatformsForContentType(
  capability: ContentCapability,
  candidatePlatforms: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of candidatePlatforms) {
    const key = normalizePlatformKey(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (platformSupportsCapability(key, capability)) out.push(key);
  }
  return out;
}
