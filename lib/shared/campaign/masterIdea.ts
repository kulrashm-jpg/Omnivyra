/**
 * CAMPAIGN-IMPL-004 — Hybrid Master-Idea architecture (additive identity layer).
 *
 * Target model:
 *   Campaign → Strategic Themes → Weekly Themes → Master Ideas → Content Variants
 *   → Platform Adaptations → Scheduling
 *
 * This module is the canonical IDENTITY layer for that model. It is PURE
 * (dependency-free, client+server-safe, no crypto import — fingerprints use a
 * deterministic FNV-1a hash, they are identity tags not security hashes) and
 * strictly ADDITIVE: it derives a Master Idea + Variant + semantic fingerprints
 * from fields ALREADY present on a planner item, to be stamped into the existing
 * `daily_content_plans.content` JSON envelope. It changes NO business rule, NO
 * scheduling, NO publishing, and requires NO migration. Missing inputs degrade
 * gracefully (backward compatibility), so existing campaigns keep working.
 *
 * It deliberately does NOT implement historical uniqueness or reuse prevention —
 * it only ESTABLISHES semantic identity. Enforcement belongs to a later phase.
 */

/** The canonical idea a set of assets is derived from. One idea → many variants. */
export interface MasterIdea {
  /** Stable, deterministic id shared by every variant of the same idea. */
  id: string;
  /** Weekly theme (e.g. blueprint phase_label). */
  theme: string;
  /** Narrative arc / angle the idea is told through. */
  narrative: string;
  audience: string;
  /** The idea's objective/intent. */
  intent: string;
  /** Buyer-journey stage (funnel_stage: awareness | education | trust | conversion). */
  buyer_journey_stage: string;
  /** CTA strategy for the idea. */
  cta_strategy: string;
  /** The single core message every variant must carry. */
  core_message: string;
}

/** One asset derived from a Master Idea. Every generated asset is exactly one. */
export interface ContentVariant {
  /** Stable id for this specific variant (idea × format × platform × topic). */
  variant_id: string;
  master_idea_id: string;
  /** The asset format: blog | article | guide | newsletter | carousel | infographic | image | thread | post | … */
  variant_type: string;
  /** How this variant intentionally differs from its siblings (format intent, not paraphrase). */
  differentiator: string;
}

/** Semantic identity fingerprints — identity tags, NOT uniqueness enforcement. */
export interface SemanticFingerprints {
  idea: string;
  narrative: string;
  cta: string;
  topic: string;
}

/** The full additive bundle stamped onto an item's content metadata. */
export interface MasterIdeaBundle {
  master_idea: MasterIdea;
  variant: ContentVariant;
  fingerprint: SemanticFingerprints;
  /** Schema marker so readers can detect + version the additive block. */
  master_idea_version: 1;
}

/** Everything the derivation needs — all optional for backward compatibility. */
export interface MasterIdeaInput {
  campaignId?: string | number | null;
  weekNumber?: number | null;
  /**
   * Stable key identifying the underlying idea/base-topic so all format variants
   * of the same idea share one Master Idea id (e.g. topicReference). Falls back
   * to core message / topic when absent.
   */
  ideaKey?: string | null;
  theme?: string | null;
  narrative?: string | null;
  audience?: string | null;
  intent?: string | null;
  buyerJourneyStage?: string | null;
  ctaStrategy?: string | null;
  coreMessage?: string | null;
  contentType?: string | null;
  platform?: string | null;
  topicTitle?: string | null;
}

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** Lowercase, strip punctuation, collapse whitespace — the normalization for fingerprints. */
export function normalizeForFingerprint(value: unknown): string {
  return s(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic FNV-1a (32-bit) → 8-char hex. Pure, dependency-free, identical
 * on client + server + across processes, so the same idea always fingerprints
 * the same. NOT cryptographic — it is a semantic identity tag.
 */
export function fingerprint(value: unknown): string {
  const str = normalizeForFingerprint(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (stay in 32-bit unsigned space).
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Short, human-legible differentiator describing why a format variant differs. */
function differentiatorFor(contentType: string): string {
  const ct = contentType.toLowerCase();
  const map: Record<string, string> = {
    blog: 'Long-form narrative that develops the idea in depth.',
    article: 'Structured editorial framing of the idea.',
    guide: 'Actionable step-by-step treatment of the idea.',
    newsletter: 'Conversational, subscriber-framed take on the idea.',
    carousel: 'Sequential visual breakdown of the idea across slides.',
    infographic: 'Single-view data/visual synthesis of the idea.',
    image: 'One striking visual capturing the idea.',
    thread: 'Segmented, momentum-building unrolling of the idea.',
    post: 'Concise single-post hook on the idea.',
    reel: 'Short-form video motion take on the idea.',
    story: 'Ephemeral, moment-driven glimpse of the idea.',
    poll: 'Participation-first framing that asks the idea as a question.',
    tweet: 'Compressed, high-signal statement of the idea.',
  };
  return map[ct] ?? `${contentType} rendition of the idea, in its native format.`;
}

/**
 * Derive the additive Master-Idea bundle for one planner item. Deterministic:
 * the same inputs always produce the same ids + fingerprints, so all format
 * variants of one idea (same campaign/week/ideaKey) share a master_idea_id while
 * each asset gets its own variant_id.
 */
export function deriveMasterIdeaBundle(input: MasterIdeaInput): MasterIdeaBundle {
  const campaign = s(input.campaignId);
  const week = input.weekNumber != null && Number.isFinite(Number(input.weekNumber)) ? String(Math.trunc(Number(input.weekNumber))) : '';
  const coreMessage = s(input.coreMessage) || s(input.intent) || s(input.topicTitle);
  const audience = s(input.audience);
  const theme = s(input.theme);
  const narrative = s(input.narrative);
  const intent = s(input.intent);
  const cta = s(input.ctaStrategy);
  const contentType = s(input.contentType) || 'post';
  const platform = s(input.platform);
  const topicTitle = s(input.topicTitle);

  // Idea identity: stable across format variants. Prefer an explicit ideaKey
  // (e.g. topicReference), else fall back to the normalized core message/topic.
  const ideaSeed = s(input.ideaKey) || normalizeForFingerprint(coreMessage || topicTitle);
  const masterIdeaId = `mi_${fingerprint(`${campaign}|${week}|${ideaSeed}`)}`;

  // Variant identity: unique per asset within the idea.
  const variantId = `cv_${fingerprint(`${masterIdeaId}|${contentType}|${platform}|${topicTitle}`)}`;

  const master_idea: MasterIdea = {
    id: masterIdeaId,
    theme: theme || 'General',
    narrative: narrative || 'Educational',
    audience: audience || 'General audience',
    intent: intent || coreMessage || 'Awareness',
    buyer_journey_stage: (s(input.buyerJourneyStage) || 'awareness').toLowerCase(),
    cta_strategy: cta || 'Learn more',
    core_message: coreMessage || 'Untitled idea',
  };

  const variant: ContentVariant = {
    variant_id: variantId,
    master_idea_id: masterIdeaId,
    variant_type: contentType,
    differentiator: differentiatorFor(contentType),
  };

  const fp: SemanticFingerprints = {
    idea: fingerprint(`${theme} ${coreMessage} ${audience} ${intent}`),
    narrative: fingerprint(narrative || intent),
    cta: fingerprint(cta),
    topic: fingerprint(topicTitle || coreMessage),
  };

  return { master_idea, variant, fingerprint: fp, master_idea_version: 1 };
}

/**
 * Read an additive Master-Idea bundle back out of a parsed content-JSON object,
 * tolerating its absence (older rows / non-BOLT campaigns) — returns null so
 * every reader is backward compatible.
 */
export function readMasterIdeaBundle(content: unknown): MasterIdeaBundle | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as Record<string, unknown>;
  const mi = c.master_idea as MasterIdea | undefined;
  const variant = c.variant as ContentVariant | undefined;
  if (!mi || !variant || typeof mi.id !== 'string' || typeof variant.variant_id !== 'string') return null;
  const fp = (c.fingerprint as SemanticFingerprints | undefined) ?? { idea: '', narrative: '', cta: '', topic: '' };
  return { master_idea: mi, variant, fingerprint: fp, master_idea_version: 1 };
}
