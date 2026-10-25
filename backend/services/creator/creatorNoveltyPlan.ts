/**
 * "Looks inspire, every generation is new" (owner request 2026-10-25).
 *
 * A look (and its curated sample) says HOW an image is made — medium, palette,
 * line, texture. It must never decide WHAT is in the frame, or every render in
 * a look converges on its sample. This module gives each generation its own
 * small, seeded set of creative choices — setting, composition, viewpoint,
 * light and mood, a secondary motif, a background treatment — so two
 * generations of the same brief in the same look are visibly different
 * pictures, while the user's content (copy, facts, their own photos) is never
 * touched: the plan only produces a separate "This version:" prompt layer and a
 * background variant token for the deterministic SVG families.
 *
 * Deterministic per seed: the same seed always gives the same picks (true
 * retries, the visual fix loop and reproductions stay identical). A new seed
 * is minted per request unless the payload already carries `novelty_seed`.
 *
 * Pools are look-safe (a flat vector look never gets "golden-hour outdoor
 * light"; an isometric look keeps an isometric viewpoint) and purpose-aware
 * (a product / SaaS brief gets product-in-context settings). The user's own
 * visual direction always wins: a typed creative direction drops the setting
 * pick, and the layer says so explicitly.
 *
 * Pure apart from `resolveNoveltySeed` (which mints a UUID when none exists).
 */

import { createHash, randomUUID } from 'crypto';
import { getVisualStyle } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';

export type NoveltyDimension = 'scene' | 'composition' | 'camera' | 'lighting' | 'motif' | 'background';
export type NoveltyLookKind = 'photo' | 'stylised' | 'glow' | 'isometric';
export type NoveltyPurposeKind = 'product' | 'general';

export const NOVELTY_DIMENSIONS: readonly NoveltyDimension[] = Object.freeze(
  ['scene', 'composition', 'camera', 'lighting', 'motif', 'background'] as NoveltyDimension[],
);

/** Dimensions guaranteed distinct across the N versions of "More versions". */
export const NOVELTY_PRIMARY_DIMENSIONS: readonly NoveltyDimension[] = Object.freeze(['scene', 'composition'] as NoveltyDimension[]);

/** Looks that ARE light (screens, neon, night): their lighting/background pools are glow-native. */
const GLOW_LOOKS: ReadonlySet<string> = new Set(['dark', 'neon', 'cyberpunk', 'futuristic', 'dashboard', 'ui-mockup']);

type Pool = readonly string[];

/* ── Pools ───────────────────────────────────────────────────────────────
 * Short phrases, no people unless the brief asks (subject choice decides
 * humans), no words or signage (the text ban), nothing centred-symmetric
 * (the photographic negatives forbid it).
 */

const SCENE: Record<NoveltyLookKind, Record<NoveltyPurposeKind, Pool>> = {
  photo: {
    general: [
      'a bright, modern workspace with real-world detail',
      'an everyday street-level city setting',
      'a calm home-office corner',
      'a shared team table with work in progress',
      'a close look at the tools and materials of the work',
      'a rooftop terrace under open sky',
      'a minimalist studio set with a seamless backdrop',
      'a café-style setting with natural wood and stone textures',
    ],
    product: [
      'the product in use on a clean, real desk setup',
      'a modern office where the product is the focal point',
      'a minimal studio plinth presenting the product',
      'a home workspace where the product fits naturally',
      'an on-the-go setting that shows the product in context',
      'an architectural space with strong lines framing the product',
      'a material flat-lay around the product',
    ],
  },
  stylised: {
    general: [
      'an imaginative visual metaphor for the message',
      'a stylised cityscape',
      'a stylised landscape with a clear path toward the horizon',
      'a cosy interior vignette',
      'an object still-life arranged around the idea',
      'an abstract conceptual space of shapes and forms',
      'a journey scene from starting point to goal',
    ],
    product: [
      'the product idea expressed as a stylised hero object',
      'a stylised workspace where the product sits naturally',
      'a visual metaphor of the problem the product solves',
      'a layered, exploded view of how the idea works',
      'a stylised scene of abstract interface panels',
      'a progress path from problem to outcome',
    ],
  },
  glow: {
    general: [
      'a night-time city skyline',
      'an abstract digital space with real depth',
      'a control-room style environment of abstract panels',
      'a long futuristic corridor',
      'a floating constellation of connected nodes',
      'a reflective surface scene under coloured light',
    ],
    product: [
      'a device floating in an abstract digital space',
      'abstract data streams flowing around a central product form',
      'a sleek plinth under glowing accents presenting the product',
      'a layered stack of abstract screens around the product idea',
      'a network of connected nodes converging on the product',
      'a quiet night workspace lit by the product',
    ],
  },
  isometric: {
    general: [
      'an isometric miniature city block',
      'an isometric workspace island',
      'an isometric process line from input to outcome',
      'an isometric landscape tile with paths and landmarks',
      'an isometric stack of connected platforms',
      'an isometric room cut-away',
    ],
    product: [
      'an isometric product workspace island',
      'an isometric flow of the product turning input into outcome',
      'an isometric stack of product modules',
      'an isometric cut-away of the product idea at work',
      'an isometric platform with the product as the landmark',
      'an isometric map of the product connecting its parts',
    ],
  },
};

const COMPOSITION: Pool = [
  'a wide establishing frame with generous breathing room',
  'a close, intimate crop on the key detail',
  'layered depth with a strong foreground element',
  'the focal subject placed on the right third',
  'diagonal leading lines that pull toward the focal point',
  'a frame-within-a-frame arrangement',
  'a balanced asymmetric layout with one dominant shape',
];

const CAMERA: Record<NoveltyLookKind, Pool> = {
  photo: [
    'eye-level, natural perspective',
    'a slightly low angle that gives the subject presence',
    'an elevated three-quarter view',
    'a top-down overhead view',
    'a tight telephoto view with compressed depth',
    'a wide-angle environmental view',
  ],
  stylised: [
    'a straight-on, flat viewpoint',
    'an elevated three-quarter viewpoint',
    'a low viewpoint looking up',
    'a top-down plan viewpoint',
    'a close-up scale on one element',
    'a distant view showing the whole scene small',
  ],
  glow: [
    'a low viewpoint looking up into the light',
    'an elevated three-quarter viewpoint',
    'a straight-on viewpoint with deep perspective',
    'a close-up scale on one glowing element',
    'a distant view across the whole space',
    'a slightly tilted, dynamic viewpoint',
  ],
  isometric: [
    'an isometric view from the left',
    'an isometric view from the right',
    'an isometric close-up on one block',
    'an isometric wide view of the whole scene',
  ],
};

const LIGHTING: Record<NoveltyLookKind, Pool> = {
  photo: [
    'soft morning window light',
    'warm golden-hour light',
    'overcast, diffuse daylight',
    'warm evening interior light',
    'crisp high-key light',
    'moody low-key side light',
  ],
  stylised: [
    'a bright daytime mood, rendered in the look\'s own medium',
    'warm late-afternoon tones within the look palette',
    'cool twilight tones within the look palette',
    'a soft pastel morning mood within the look palette',
    'a high-contrast spotlight mood, rendered in the look\'s own medium',
  ],
  glow: [
    'deep night with one strong glow source',
    'twin-tone rim glow from both sides',
    'soft ambient glow with dark falloff',
    'a bright central glow fading to dark edges',
    'scattered point lights at different depths',
  ],
  isometric: [
    'a bright daytime mood within the look palette',
    'warm late-afternoon tones within the look palette',
    'cool evening tones within the look palette',
    'a soft pastel mood within the look palette',
  ],
};

const MOTIF: Pool = [
  'a subtle recurring geometric accent',
  'a path or line implying forward motion',
  'a small organic accent such as a leaf or plant',
  'a soft circular shape that echoes focus',
  'a faint grid or pattern echo in the background',
  'a single contrasting accent-colour detail',
  'a gentle upward shape implying growth',
];

const BACKGROUND: Record<NoveltyLookKind, Pool> = {
  photo: [
    'a softly blurred real environment',
    'a clean seamless backdrop',
    'a textured wall surface',
    'an open window view',
    'a deep, shadowed background',
    'a bright, airy background',
  ],
  stylised: [
    'a flat colour field from the look palette',
    'a soft gradient from the look palette',
    'a subtle surface texture in the look\'s own medium',
    'layered simple shapes receding into the distance',
    'an open negative-space background',
    'a quiet patterned background echo',
  ],
  glow: [
    'pure deep black',
    'a deep gradient falling into darkness',
    'a faint grid floor receding into the distance',
    'soft haze with depth',
    'a reflective dark floor',
  ],
  isometric: [
    'a flat colour field from the look palette',
    'a soft gradient from the look palette',
    'an open negative-space background',
    'a faint isometric grid',
  ],
};

/* ── Seeded selection ─────────────────────────────────────────────────── */

const SEED_PATTERN = /^[A-Za-z0-9:_.-]{1,128}$/;

/** A usable seed string, or null. Bounded and charset-restricted (it lands in metadata and cache keys). */
export function sanitizeNoveltySeed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return SEED_PATTERN.test(s) ? s : null;
}

function hashInt(...parts: string[]): number {
  return parseInt(createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8), 16);
}

/** Deterministic index in [0, n) for (seed, salt). */
export function noveltyIndex(seed: string, salt: string, n: number): number {
  if (!Number.isFinite(n) || n <= 1) return 0;
  return hashInt(seed, salt) % Math.floor(n);
}

/** Deterministic shuffle of a pool by (seed, salt) — Fisher–Yates over a hash stream. */
function seededShuffle<T>(items: readonly T[], seed: string, salt: string): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = hashInt(seed, salt, String(i)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * This request's seed: the payload's `novelty_seed` (render metadata, else the
 * carried creator_card) when present — a true retry / fix loop / reproduction —
 * otherwise a fresh UUID.
 */
export function resolveNoveltySeed(metadata: Record<string, unknown> | null | undefined): string {
  const meta = obj(metadata);
  return sanitizeNoveltySeed(meta.novelty_seed)
    ?? sanitizeNoveltySeed(obj(meta.creator_card).novelty_seed)
    ?? randomUUID();
}

/** The seed already on the payload, or null (never mints). */
export function existingNoveltySeed(metadata: Record<string, unknown> | null | undefined): string | null {
  const meta = obj(metadata);
  return sanitizeNoveltySeed(meta.novelty_seed) ?? sanitizeNoveltySeed(obj(meta.creator_card).novelty_seed);
}

export function noveltyLookKind(lookId: string | null | undefined): NoveltyLookKind {
  const style = getVisualStyle(lookId ?? null);
  if (!style) return 'photo'; // no look → the photographic editorial path
  if (style.id === 'isometric') return 'isometric';
  if (GLOW_LOOKS.has(style.id)) return 'glow';
  return style.photographic ? 'photo' : 'stylised';
}

const PRODUCT_PURPOSE = /\b(product|saas|software|app|apps|feature|features|launch|demo|dashboard|platform|tool|tools|device|integration)\b/i;

export function noveltyPurposeKind(purpose: string | null | undefined, subject?: string | null): NoveltyPurposeKind {
  if (subject === 'product' || subject === 'both') return 'product';
  return PRODUCT_PURPOSE.test(String(purpose || '').replace(/[-_]/g, ' ')) ? 'product' : 'general';
}

export interface NoveltyPlanInput {
  seed: string;
  lookId?: string | null;
  family?: string | null;
  /** Purpose key / content type / objective text — only used to pick product-safe settings. */
  purpose?: string | null;
  /** One of N "More versions": primary picks are distinct across the N versions. */
  variant?: { index: number; count: number; baseSeed?: string | null } | null;
  /** The user's own choices, which always override a pick. */
  user?: { hasInstruction?: boolean; subject?: string | null } | null;
}

export interface NoveltyPlan {
  seed: string;
  lookKind: NoveltyLookKind;
  purposeKind: NoveltyPurposeKind;
  picks: Partial<Record<NoveltyDimension, string>>;
  /** The "This version:" prompt layer (empty for families that are not provider-rendered). */
  lines: string[];
  /** What is recorded on output metadata as `novelty`. */
  audit: {
    seed: string;
    picks: Partial<Record<NoveltyDimension, string>>;
    look_kind: NoveltyLookKind;
    purpose_kind: NoveltyPurposeKind;
    variant: { index: number; count: number; base_seed: string } | null;
  };
}

const LABEL: Record<NoveltyDimension, string> = {
  scene: 'setting',
  composition: 'composition',
  camera: 'viewpoint',
  lighting: 'light and mood',
  motif: 'secondary motif',
  background: 'background',
};

export function buildNoveltyPlan(input: NoveltyPlanInput): NoveltyPlan {
  const seed = sanitizeNoveltySeed(input.seed) ?? 'novelty-default';
  const lookKind = noveltyLookKind(input.lookId);
  const purposeKind = noveltyPurposeKind(input.purpose, input.user?.subject ?? null);
  const pools: Record<NoveltyDimension, Pool> = {
    scene: SCENE[lookKind][purposeKind],
    composition: COMPOSITION,
    camera: CAMERA[lookKind],
    lighting: LIGHTING[lookKind],
    motif: MOTIF,
    background: BACKGROUND[lookKind],
  };

  const variant = input.variant && Number.isFinite(Number(input.variant.index)) && Number(input.variant.count) >= 1
    ? (() => {
        const count = Math.max(1, Math.floor(Number(input.variant!.count)));
        const index = Math.max(1, Math.min(count, Math.floor(Number(input.variant!.index))));
        // Without a base seed the versions still share one deterministic base, so they stay distinct.
        const baseSeed = sanitizeNoveltySeed(input.variant!.baseSeed) ?? `look:${input.lookId ?? 'none'}:${lookKind}`;
        return { index, count, baseSeed };
      })()
    : null;

  const picks: Partial<Record<NoveltyDimension, string>> = {};
  for (const dim of NOVELTY_DIMENSIONS) {
    const pool = pools[dim];
    if (variant && NOVELTY_PRIMARY_DIMENSIONS.includes(dim)) {
      // Version i takes slot i of ONE shuffle shared by all N versions → no repeats (pools ≥ 6, N ≤ 4).
      picks[dim] = seededShuffle(pool, variant.baseSeed, `${lookKind}:${purposeKind}:${dim}`)[(variant.index - 1) % pool.length];
    } else {
      picks[dim] = pool[noveltyIndex(seed, dim, pool.length)];
    }
  }
  // The user's typed creative direction decides the setting — never a pick.
  if (input.user?.hasInstruction) delete picks.scene;

  const family = String(input.family || 'image');
  const providerRendered = family !== 'carousel' && family !== 'infographic';
  const parts = NOVELTY_DIMENSIONS.filter((d) => picks[d]).map((d) => `${LABEL[d]}: ${picks[d]}`);
  const lines = providerRendered && parts.length > 0
    ? [
        `This version: an original take on the same message — ${parts.join('; ')}.`,
        'These choices belong to this version only. The requester\'s creative direction and subject choice override any of them; the message, brand and any attached photos stay exactly as given.',
      ]
    : [];

  return {
    seed,
    lookKind,
    purposeKind,
    picks,
    lines,
    audit: {
      seed,
      picks: { ...picks },
      look_kind: lookKind,
      purpose_kind: purposeKind,
      variant: variant ? { index: variant.index, count: variant.count, base_seed: variant.baseSeed } : null,
    },
  };
}
