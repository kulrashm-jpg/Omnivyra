/**
 * Canonical Semantic Identity — Platform Shared Contract (OMNIVYRA-PMO-001 · ICR-1 · PMO-ADR-07).
 *
 * THE single source of truth for the semantic identity that ties the whole
 * generation → coordination → publication → measurement chain together. Both the
 * Generation Spine (Zone A1, `content/runtime/*`) and the Coordination Intelligence
 * Layer (Zone A2, `intelligence/coordination/*`) MUST reference these types and
 * functions instead of defining their own. This resolves TD-13, where A1 and A2
 * had defined the identity divergently (A1: `communicationIntent: string` +
 * random `sroot-<uuid>`; A2: a `CommunicationIntent` enum + a deterministic
 * `sroot_<sha256>`), which made ids never match and broke continuity across zones.
 *
 * Ownership: Platform (P) — consume-only for A1/A2; any shape change is an
 * Interface Change Request to the PMO. Neither agent may re-define these locally.
 *
 * ── The two-level identity (the core reconciliation) ─────────────────────────
 *   • semanticRootId      — the DETERMINISTIC grouping key for one intent seed:
 *                            same (company, intent, campaign, normalized topic) ⇒
 *                            same id, so independent modules converge WITHOUT a
 *                            prior handoff. This is what coordination/dedup keys on.
 *   • generationInstanceId — a UNIQUE id for one concrete generation run, carrying
 *                            per-run provenance. Two regenerations of the same seed
 *                            share a semanticRootId but get distinct instance ids.
 * Conflating these two was the root cause of TD-13. Keep them separate.
 */

import { createHash, randomUUID } from 'crypto';

// ── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * WHY a company communicates — the canonical, extensible intent taxonomy.
 * (Adopted as the platform vocabulary; formerly defined locally in Zone A2.)
 */
export type CommunicationIntent =
  | 'announce'   // launch / news / milestone
  | 'educate'    // teach / explain / how-to
  | 'promote'    // offer / CTA / conversion push
  | 'engage'     // conversation / question / community
  | 'nurture'    // relationship / retention / follow-up
  | 'reply'      // inbound response (engagement egress)
  | 'report'     // insight / analytics narration
  | 'recruit'    // hiring / talent
  | 'advocate'   // POV / thought-leadership / stance
  | 'other';

/** All known communication intents, in declaration order. */
export const COMMUNICATION_INTENTS: readonly CommunicationIntent[] = [
  'announce', 'educate', 'promote', 'engage', 'nurture',
  'reply', 'report', 'recruit', 'advocate', 'other',
] as const;

const COMMUNICATION_INTENT_SET = new Set<string>(COMMUNICATION_INTENTS);

/**
 * Map any free-form intent string onto the canonical vocabulary. Lets Zone A1
 * (which carries a looser producer-supplied string) converge on the same closed
 * set Zone A2 matches against. Unknown / empty ⇒ 'other' (never fabricated).
 * Includes a few common synonyms; extend deliberately (this is a P change).
 */
export function normalizeCommunicationIntent(raw: string | null | undefined): CommunicationIntent {
  const v = (raw ?? '').toLowerCase().trim();
  if (!v) return 'other';
  if (COMMUNICATION_INTENT_SET.has(v)) return v as CommunicationIntent;
  const synonyms: Record<string, CommunicationIntent> = {
    launch: 'announce', news: 'announce', milestone: 'announce', announcement: 'announce',
    teach: 'educate', explain: 'educate', howto: 'educate', 'how-to': 'educate', guide: 'educate',
    sell: 'promote', offer: 'promote', cta: 'promote', convert: 'promote', promotion: 'promote',
    conversation: 'engage', question: 'engage', community: 'engage', discuss: 'engage',
    retention: 'nurture', 'follow-up': 'nurture', followup: 'nurture', relationship: 'nurture',
    respond: 'reply', response: 'reply',
    insight: 'report', analytics: 'report', summary: 'report',
    hiring: 'recruit', talent: 'recruit', job: 'recruit',
    opinion: 'advocate', pov: 'advocate', 'thought-leadership': 'advocate', stance: 'advocate',
  };
  return synonyms[v] ?? 'other';
}

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * The deterministic grouping key for one communication intent seed. Format:
 * `sroot_<24-hex>`. Same (company, intent, campaign, normalized topic) ⇒ same id.
 * (Stable across processes/time; keys coordination + duplicate-intent detection.)
 */
export type SemanticRootId = string;

/** A unique id for one concrete generation run. Format: `sgen_<uuid>`. */
export type GenerationInstanceId = string;

/** Lowercase, trim, collapse whitespace, drop punctuation — for stable keying only. */
export function normalizeTopic(topic: string | null | undefined): string {
  return (topic ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derive THE deterministic `semanticRootId` from an intent signature. This is the
 * one canonical implementation; the intent is normalized to the platform
 * vocabulary first so a free-form (A1) and an enum (A2) producer agree.
 */
export function deriveSemanticRootId(params: {
  companyId: string;
  communicationIntent: CommunicationIntent | string;
  campaignId?: string | null;
  topic: string;
}): SemanticRootId {
  const intent = normalizeCommunicationIntent(String(params.communicationIntent));
  const signature = [
    params.companyId,
    intent,
    params.campaignId ?? '',
    normalizeTopic(params.topic),
  ].join('|');
  const digest = createHash('sha256').update(signature).digest('hex').slice(0, 24);
  return `sroot_${digest}`;
}

/** True iff `id` has the canonical `sroot_<24-hex>` shape. */
export function isSemanticRootId(id: string | null | undefined): id is SemanticRootId {
  return typeof id === 'string' && /^sroot_[0-9a-f]{24}$/.test(id);
}

/** Mint a fresh per-generation instance id (`sgen_<uuid>`). */
export function newGenerationInstanceId(): GenerationInstanceId {
  return `sgen_${randomUUID()}`;
}

/**
 * The minimal identity every artifact in the chain carries. Rich zone-specific
 * types (A1's `SemanticRoot`, A2's `CommunicationRecord`) COMPOSE this rather
 * than redefining its fields.
 */
export interface SemanticIdentity {
  /** Deterministic grouping key — shared across modules for the same intent seed. */
  readonly semanticRootId: SemanticRootId;
  /** The canonical communication objective. */
  readonly communicationIntent: CommunicationIntent;
  /** The intent seed (subject) — NOT the produced wording. */
  readonly topic: string;
  readonly campaignId?: string | null;
}

/**
 * Build the shared identity from producer inputs. A1's runtime is the canonical
 * PRODUCER — it calls this to mint the identity; A2 CONSUMES a producer-supplied
 * `semanticRootId` and only calls `deriveSemanticRootId` as a fallback when a
 * record arrives without one.
 */
export function buildSemanticIdentity(params: {
  companyId: string;
  communicationIntent: CommunicationIntent | string;
  topic: string;
  campaignId?: string | null;
}): SemanticIdentity {
  const communicationIntent = normalizeCommunicationIntent(String(params.communicationIntent));
  return Object.freeze({
    semanticRootId: deriveSemanticRootId({
      companyId: params.companyId,
      communicationIntent,
      campaignId: params.campaignId ?? null,
      topic: params.topic,
    }),
    communicationIntent,
    topic: params.topic,
    campaignId: params.campaignId ?? null,
  });
}
