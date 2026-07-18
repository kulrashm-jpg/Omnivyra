/**
 * Canonical Recommendation Runtime — WRITER-EXEC-005 Wave 4 (items 3/7/9).
 *
 * THE single generator of section-level content recommendations. Deterministic,
 * heuristic, and explainable — there is NO ad-hoc AI here. For each WEAK
 * dimension in a persisted quality scorecard it emits one recommendation that
 *   - references the exact score it is responding to (explainability),
 *   - targets a single content BLOCK (never rewrites the whole document),
 *   - carries `before` (the block's current text) + `after` (a deterministic
 *     improved variant) so the collaboration layer can apply it reversibly.
 *
 * This supersedes the legacy AI improvement flows (contentImprovementEngine /
 * improve-draft). Those remain functional but @deprecated in favour of this.
 *
 * CONTRACT NOTE (WAVE4-TODO): the canonical DTOs live at
 * lib/content/quality/types.ts (QualityScorecard, ContentBlock, Recommendation,
 * ContentBlockType), written concurrently by the quality-engine work. Until that
 * module lands this file carries a self-contained, structurally-compatible mirror
 * so the runtime + its unit tests compile and pass standalone. When the canonical
 * module is present, re-point the imports and delete the mirror below. The field
 * names here are exactly the documented ones.
 */

/* ── Contract mirror (see CONTRACT NOTE) ─────────────────────────────────── */

export type ContentBlockType = 'hook' | 'opening' | 'body' | 'cta' | 'hashtags' | 'other';

export interface ContentBlock {
  id?: string;
  contentId?: string;
  companyId?: string;
  type: ContentBlockType;
  position: number;
  text: string;
  locked?: boolean;
}

/** A single quality dimension. Tolerated as a bare number or `{ score }`. */
export interface QualityDimension {
  score: number; // 0..100
  label?: string;
  weight?: number;
  notes?: string;
}

export interface QualityScorecard {
  overallScore?: number; // 0..100
  /** Keyed by dimension name; value is 0..100, or an object exposing `.score`. */
  dimensions: Record<string, number | QualityDimension | { score?: number } | null | undefined>;
}

export interface Recommendation {
  category: string;
  reason: string; // references the scorecard score
  expectedImpact: string;
  confidence: number; // 0..1
  affectedSection: string; // the block/section it targets
  before: string; // current block text
  after: string; // deterministic improved variant
  // ── traceability extras (optional; used by persistence + reversibility) ──
  dimension?: string;
  blockType?: ContentBlockType;
  blockId?: string;
  qualityRef?: { dimension: string; score: number; threshold: number };
  // ── Wave-5 learning context (optional; only present when learning was supplied) ──
  /**
   * Additional, explainable references to what has historically worked/underperformed
   * for THIS company. Never present unless learning data was passed in — with it
   * absent, the rec is byte-identical to Wave 4.
   */
  learningReferences?: LearningReference[];
}

/* ── Wave-5 learning inputs (additive; see learningMemoryService) ─────────────
 * Minimal STRUCTURAL mirrors kept local so this pure, DB-free runtime never
 * imports the DB-bound learning service. Field names match the documented
 * LearningMemory / LearningIntelligence DTOs. */

/** A single explainable learning reference attached to a recommendation. */
export interface LearningReference {
  kind: 'historical_pattern' | 'winning_structure' | 'platform_adaptation' | 'successful_messaging';
  /** The rec dimension this reference supports. */
  dimension: string;
  /** Human-readable, explainable note (e.g. "a question-led hook scored higher on LinkedIn"). */
  note: string;
  /** The concrete evidence behind the note (pattern key + score + sample size). */
  evidence: string;
  platform?: string;
  score?: number;
  sampleSize?: number;
}

/** Structural mirror of a LearningMemory rollup (only the fields consumed here). */
export interface LearningMemoryRef {
  successfulMessaging?: Record<string, unknown> | null;
  unsuccessfulMessaging?: Record<string, unknown> | null;
  narrativeStyles?: Record<string, unknown> | null;
  winningStructures?: Record<string, unknown> | null;
  platformAdaptations?: Record<string, unknown> | null;
  audienceInterests?: Record<string, unknown> | null;
}

/** Structural mirror of a LearningIntelligence pattern row (only fields consumed here). */
export interface LearningIntelligenceRef {
  dimension: string;
  patternKey: string;
  platform?: string | null;
  pattern?: Record<string, unknown> | null;
  score?: number | null;
  sampleSize?: number;
}

/* ── Public input ────────────────────────────────────────────────────────── */

export interface GenerateRecommendationsInput {
  companyId: string;
  contentId: string;
  content: string;
  scorecard: QualityScorecard;
  /** Persisted section blocks. When absent, blocks are derived from `content`. */
  blocks?: ContentBlock[];
  originality?: { score?: number; nearestMatches?: unknown[] };
  brandMemory?: unknown;
  campaign?: unknown;
  /**
   * Wave-5 (OPTIONAL): the company learning rollup. When present, recs may cite
   * winning structures / effective adaptations. ABSENT ⇒ behavior byte-identical
   * to Wave 4.
   */
  learningMemory?: LearningMemoryRef | null;
  /**
   * Wave-5 (OPTIONAL): the company's top learning-intelligence patterns (from
   * getTopIntelligence). When present, recs may cite historical platform
   * performance with evidence. ABSENT ⇒ behavior byte-identical to Wave 4.
   */
  intelligence?: LearningIntelligenceRef[] | null;
}

/* ── Tunables ────────────────────────────────────────────────────────────── */

/** A dimension scoring below this (0..100) is considered WEAK and gets a rec. */
export const WEAK_THRESHOLD = 50;

const DIMENSION_LABELS: Record<string, string> = {
  hook: 'Hook',
  cta: 'CTA',
  seo: 'SEO',
  platformFit: 'Platform fit',
  readability: 'Readability',
  clarity: 'Clarity',
  brandVoice: 'Brand voice',
  originality: 'Originality',
  structure: 'Structure',
  grammar: 'Grammar',
  objectiveAlignment: 'Objective alignment',
  trust: 'Trust',
};

/**
 * Fixed evaluation order → deterministic output ordering. The most impactful
 * editorial levers (hook, cta) come first.
 */
const DIMENSION_ORDER = [
  'hook',
  'cta',
  'seo',
  'platformFit',
  'readability',
  'clarity',
  'structure',
  'grammar',
  'brandVoice',
  'originality',
  'objectiveAlignment',
  'trust',
] as const;

interface TransformCtx {
  content: string;
  originality?: { score?: number; nearestMatches?: unknown[] };
}

interface DimensionConfig {
  category: string;
  rationale: string;
  preferred: ContentBlockType[];
  fallback: 'first' | 'last' | 'longest';
  transform: (before: string, ctx: TransformCtx) => string;
}

/* ── Deterministic text transforms (no AI) ───────────────────────────────── */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these',
  'those', 'it', 'its', 'as', 'at', 'by', 'from', 'we', 'you', 'your', 'our',
  'their', 'they', 'i', 'he', 'she', 'them', 'his', 'her', 'will', 'can',
  'has', 'have', 'had', 'do', 'does', 'did', 'not', 'no', 'so', 'if', 'then',
  'than', 'about', 'into', 'out', 'up', 'down', 'over', 'more', 'most',
]);

const CTA_RE = /\b(sign up|subscribe|learn more|get started|contact|buy|shop|download|register|book|try|join|call|dm|comment|share|follow|click|start)\b/i;

/** Deterministic top-N keywords: frequency desc, first-appearance tie-break. */
function topKeywords(text: string, n: number): string[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  for (const tok of tokens) {
    if (tok.length < 3 || STOPWORDS.has(tok)) continue;
    if (!counts.has(tok)) order.push(tok);
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  return order
    .slice()
    .sort((a, b) => (counts.get(b)! - counts.get(a)!) || (order.indexOf(a) - order.indexOf(b)))
    .slice(0, n);
}

function splitSentences(t: string): string[] {
  const m = t.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  return m ? m.map((s) => s.trim()).filter(Boolean) : (t.trim() ? [t.trim()] : []);
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[\s.!?,;:]+$/, '');
}

/** Prepend a deterministic opening question derived from the block's keywords. */
function addHookQuestion(before: string, _ctx: TransformCtx): string {
  const kws = topKeywords(before, 2);
  const phrase = kws.length ? kws.join(' ') : stripTrailingPunct(before.split(/\s+/).slice(0, 5).join(' ')).toLowerCase();
  if (!phrase) return before;
  const question = `Ever wondered how to get ${phrase} right?`;
  return `${question}\n\n${before}`;
}

const CTA_FILLER = /\b(you could|you can|maybe|kind of|sort of|just|really|very|possibly|perhaps|at some point|if you want|could consider|consider|might want to|please feel free to|would like to|in order to|some|our)\b/gi;

/** Collapse a wordy, hedged CTA into a single strong imperative line. */
function tightenCta(before: string, _ctx: TransformCtx): string {
  const first = splitSentences(before)[0] ?? before;
  let core = stripTrailingPunct(first.trim())
    .replace(CTA_FILLER, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!core) core = stripTrailingPunct(first.trim());
  if (!core) return before;
  core = core.charAt(0).toUpperCase() + core.slice(1);
  return `👉 ${core} — today.`;
}

/** Append deterministic, de-duplicated hashtags derived from the content. */
function addHashtags(before: string, ctx: TransformCtx): string {
  const existing = new Set((before.match(/#\w+/g) ?? []).map((t) => t.toLowerCase()));
  const source = `${before}\n${ctx.content ?? ''}`;
  const tags = topKeywords(source, 5)
    .map((w) => `#${w.replace(/[^a-z0-9]/gi, '')}`)
    .filter((t) => t.length > 2 && !existing.has(t.toLowerCase()))
    .slice(0, 3);
  if (!tags.length) return before;
  return `${before.replace(/\s+$/, '')}\n\n${tags.join(' ')}`;
}

/** Trim to the first ~60% of sentences (deterministic readability lift). */
function trimLength(before: string, _ctx: TransformCtx): string {
  const sentences = splitSentences(before);
  if (sentences.length <= 1) return before;
  const keep = Math.max(1, Math.ceil(sentences.length * 0.6));
  if (keep >= sentences.length) return before;
  return sentences.slice(0, keep).join(' ').trim();
}

/** Prepend a distinctive angle (originality / brand differentiation). */
function differentiate(before: string, _ctx: TransformCtx): string {
  const lead = "Here's the angle most miss:";
  if (before.startsWith(lead)) return before;
  return `${lead} ${before}`;
}

/** Conservative deterministic grammar/whitespace cleanup. */
function cleanupGrammar(before: string, _ctx: TransformCtx): string {
  let out = before
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (out && !/[.!?]$/.test(out)) out = `${out}.`;
  return out;
}

const DIMENSION_CONFIG: Record<string, DimensionConfig> = {
  hook: {
    category: 'hook',
    rationale: 'Leading with a sharp question stops the scroll and lifts opening engagement.',
    preferred: ['hook', 'opening'],
    fallback: 'first',
    transform: addHookQuestion,
  },
  cta: {
    category: 'cta',
    rationale: 'Collapsing the ask into one strong imperative raises conversion intent.',
    preferred: ['cta'],
    fallback: 'last',
    transform: tightenCta,
  },
  seo: {
    category: 'seo',
    rationale: 'Adding targeted, de-duplicated hashtags improves discoverability.',
    preferred: ['hashtags'],
    fallback: 'last',
    transform: addHashtags,
  },
  platformFit: {
    category: 'platform',
    rationale: 'Platform-native hashtags align the post with how the channel surfaces content.',
    preferred: ['hashtags'],
    fallback: 'last',
    transform: addHashtags,
  },
  readability: {
    category: 'readability',
    rationale: 'Tightening the longest section reduces cognitive load and improves flow.',
    preferred: ['body', 'opening'],
    fallback: 'longest',
    transform: trimLength,
  },
  clarity: {
    category: 'clarity',
    rationale: 'Trimming to the essential sentences sharpens the message.',
    preferred: ['body', 'opening'],
    fallback: 'longest',
    transform: trimLength,
  },
  structure: {
    category: 'structure',
    rationale: 'A clear leading question gives the piece an obvious entry point.',
    preferred: ['opening', 'hook', 'body'],
    fallback: 'first',
    transform: addHookQuestion,
  },
  grammar: {
    category: 'grammar',
    rationale: 'A whitespace + punctuation pass removes distracting surface errors.',
    preferred: ['body', 'opening'],
    fallback: 'longest',
    transform: cleanupGrammar,
  },
  brandVoice: {
    category: 'brand',
    rationale: 'Opening on a distinctive angle brings the copy closer to the brand voice.',
    preferred: ['opening', 'hook', 'body'],
    fallback: 'first',
    transform: differentiate,
  },
  originality: {
    category: 'originality',
    rationale: 'A distinctive lead differentiates the piece from near-duplicate matches.',
    preferred: ['opening', 'hook', 'body'],
    fallback: 'first',
    transform: differentiate,
  },
  objectiveAlignment: {
    category: 'objective',
    rationale: 'Sharpening the opening ties the copy back to its objective.',
    preferred: ['opening', 'hook', 'body'],
    fallback: 'first',
    transform: differentiate,
  },
  trust: {
    category: 'trust',
    rationale: 'A clean, error-free body reads as more credible.',
    preferred: ['body', 'opening'],
    fallback: 'longest',
    transform: cleanupGrammar,
  },
};

/* ── Scorecard normalization ─────────────────────────────────────────────── */

function dimScore(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') {
    const s = (v as { score?: unknown }).score;
    if (typeof s === 'number' && Number.isFinite(s)) return s;
  }
  return null;
}

function normalizeDimensions(scorecard: QualityScorecard): Record<string, number> {
  const out: Record<string, number> = {};
  const dims = scorecard?.dimensions ?? {};
  for (const [k, v] of Object.entries(dims)) {
    const s = dimScore(v);
    if (s != null) out[k] = s;
  }
  return out;
}

/* ── Block selection + rec assembly ──────────────────────────────────────── */

function deriveBlocks(content: string): ContentBlock[] {
  const parts = (content ?? '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  return parts.map((text, i) => {
    let type: ContentBlockType = 'body';
    const words = text.split(/\s+/).filter(Boolean);
    const allHash = words.length > 0 && words.every((w) => w.startsWith('#'));
    if (allHash) type = 'hashtags';
    else if (i === 0) type = 'hook';
    else if (i === parts.length - 1 && CTA_RE.test(text)) type = 'cta';
    return { type, position: i, text, locked: false };
  });
}

/** Choose the target block, IGNORING locked blocks (they are not modifiable). */
function pickTargetBlock(
  blocks: ContentBlock[],
  preferred: ContentBlockType[],
  fallback: 'first' | 'last' | 'longest',
): ContentBlock | undefined {
  const avail = blocks.filter((b) => !b.locked && (b.text ?? '').trim().length > 0);
  if (!avail.length) return undefined;
  for (const t of preferred) {
    const hit = avail.find((b) => b.type === t);
    if (hit) return hit;
  }
  if (fallback === 'first') return avail[0];
  if (fallback === 'last') return avail[avail.length - 1];
  // longest
  return avail.slice().sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0))[0];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildRec(
  dim: string,
  cfg: DimensionConfig,
  score: number,
  block: ContentBlock,
  before: string,
  after: string,
): Recommendation {
  const threshold = WEAK_THRESHOLD;
  const roundedScore = Math.round(score);
  const projected = Math.min(100, threshold + 20);
  const confidence = clamp(0.55 + ((threshold - score) / threshold) * 0.4, 0.5, 0.95);
  const label = DIMENSION_LABELS[dim] ?? dim;
  return {
    category: cfg.category,
    dimension: dim,
    reason: `${label} scored ${roundedScore}/100 — below the ${threshold} quality threshold. ${cfg.rationale}`,
    expectedImpact: `Projected ${label.toLowerCase()} lift: ${roundedScore} → ~${projected}/100 after this ${cfg.category} edit.`,
    confidence: round2(confidence),
    affectedSection: block.position != null ? `${block.type} #${block.position}` : block.type,
    blockType: block.type,
    blockId: block.id,
    before,
    after,
    qualityRef: { dimension: dim, score: roundedScore, threshold },
  };
}

/* ── Wave-5 learning references (deterministic, explainable, additive) ─────── */

/**
 * For each rec dimension, the learning-intelligence dimensions whose patterns are
 * relevant. Fixed map → deterministic reference sourcing.
 */
const LEARNING_DIMENSION_MAP: Record<string, string[]> = {
  hook: ['hook'],
  cta: ['cta'],
  seo: ['hashtag', 'platform'],
  platformFit: ['platform', 'hashtag'],
  readability: ['length', 'structure'],
  clarity: ['length', 'structure'],
  structure: ['structure'],
  grammar: [],
  brandVoice: ['campaign'],
  originality: ['structure'],
  objectiveAlignment: ['campaign'],
  trust: [],
};

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn', x: 'X', twitter: 'Twitter', instagram: 'Instagram',
  facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', threads: 'Threads',
};

function platformLabel(p: string): string {
  return PLATFORM_LABELS[p.toLowerCase()] ?? p;
}

/** Lowercase, separator-normalized human phrase from a pattern key. */
function humanizeKey(key: string): string {
  return key.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Defensively pull a short string list out of an unknown jsonb rollup field. */
function asRefStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (value && typeof value === 'object') {
    for (const key of ['items', 'structures', 'styles', 'messages', 'values', 'top']) {
      const arr = (value as Record<string, unknown>)[key];
      if (Array.isArray(arr)) return arr.filter((v): v is string => typeof v === 'string');
    }
    return Object.keys(value as Record<string, unknown>);
  }
  return [];
}

/** Deterministic ordering: score DESC, sampleSize DESC, patternKey ASC. */
function sortIntelligence(a: LearningIntelligenceRef, b: LearningIntelligenceRef): number {
  const sa = typeof a.score === 'number' ? a.score : -1;
  const sb = typeof b.score === 'number' ? b.score : -1;
  if (sb !== sa) return sb - sa;
  const na = typeof a.sampleSize === 'number' ? a.sampleSize : 0;
  const nb = typeof b.sampleSize === 'number' ? b.sampleSize : 0;
  if (nb !== na) return nb - na;
  return a.patternKey.localeCompare(b.patternKey);
}

/**
 * Build the explainable learning references for one weak dimension. Deterministic
 * and evidence-bearing. Returns [] when no relevant learning exists (so the rec is
 * left byte-identical). At most two references (one intelligence, one memory).
 */
function buildLearningReferences(dim: string, input: GenerateRecommendationsInput): LearningReference[] {
  const refs: LearningReference[] = [];
  const label = DIMENSION_LABELS[dim] ?? dim;
  const related = LEARNING_DIMENSION_MAP[dim] ?? [];

  // 1) Intelligence-sourced reference (richest: has score + platform + sample).
  const intel = Array.isArray(input.intelligence) ? input.intelligence : [];
  if (intel.length && related.length) {
    const candidates = intel
      .filter((e) => e && typeof e.patternKey === 'string' && related.includes(e.dimension))
      .slice()
      .sort(sortIntelligence);
    const top = candidates[0];
    if (top) {
      const desc = humanizeKey(top.patternKey);
      const on = top.platform ? ` on ${platformLabel(top.platform)}` : '';
      const score = typeof top.score === 'number' ? round2(top.score) : undefined;
      const n = typeof top.sampleSize === 'number' ? top.sampleSize : undefined;
      const scorePart = score != null ? ` (effectiveness ${score}${n != null ? `, n=${n}` : ''})` : '';
      refs.push({
        kind: 'historical_pattern',
        dimension: dim,
        note: `${label}s like this have historically underperformed for you — a ${desc} ${label.toLowerCase()} scored higher${on}.`,
        evidence: `Pattern "${top.patternKey}"${on ? ` on ${platformLabel(top.platform as string)}` : ''} outperformed${scorePart}.`,
        ...(top.platform ? { platform: top.platform } : {}),
        ...(score != null ? { score } : {}),
        ...(n != null ? { sampleSize: n } : {}),
      });
    }
  }

  // 2) Learning-memory-sourced reference (winning structures / adaptations).
  const mem = input.learningMemory;
  if (mem) {
    if ((dim === 'seo' || dim === 'platformFit') && mem.platformAdaptations) {
      const platforms = asRefStringArray(mem.platformAdaptations).map(platformLabel).slice(0, 4);
      if (platforms.length) {
        refs.push({
          kind: 'platform_adaptation',
          dimension: dim,
          note: `Lean on the platform adaptations already working for you: ${platforms.join(', ')}.`,
          evidence: `learning_memory.platform_adaptations records effective adaptations for ${platforms.join(', ')}.`,
        });
      }
    } else if ((dim === 'structure' || dim === 'originality' || dim === 'clarity' || dim === 'readability') && mem.winningStructures) {
      const structures = asRefStringArray(mem.winningStructures).map(humanizeKey).filter(Boolean).slice(0, 3);
      if (structures.length) {
        refs.push({
          kind: 'winning_structure',
          dimension: dim,
          note: `Winning structures for you have used: ${structures.join('; ')}.`,
          evidence: `learning_memory.winning_structures records these as historically effective.`,
        });
      }
    } else if ((dim === 'brandVoice' || dim === 'objectiveAlignment') && (mem.narrativeStyles || mem.successfulMessaging)) {
      const styles = asRefStringArray(mem.narrativeStyles ?? mem.successfulMessaging).map(humanizeKey).filter(Boolean).slice(0, 3);
      if (styles.length) {
        refs.push({
          kind: 'successful_messaging',
          dimension: dim,
          note: `Messaging that has resonated for you leans on: ${styles.join('; ')}.`,
          evidence: `learning_memory records these narrative styles / messaging as historically successful.`,
        });
      }
    }
  }

  return refs;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Generate deterministic, explainable, block-scoped recommendations for every
 * WEAK dimension in the scorecard. Fail-safe: any internal error yields `[]`.
 */
export function generateRecommendations(input: GenerateRecommendationsInput): Recommendation[] {
  try {
    if (!input || !input.scorecard) return [];
    const blocks = input.blocks && input.blocks.length ? input.blocks : deriveBlocks(input.content ?? '');
    if (!blocks.length) return [];

    const dims = normalizeDimensions(input.scorecard);

    // Fold the Wave-2 originality signal in when the scorecard lacks the dim.
    if (dims.originality == null && input.originality) {
      const near = Array.isArray(input.originality.nearestMatches) ? input.originality.nearestMatches.length : 0;
      const os = typeof input.originality.score === 'number' ? input.originality.score : null;
      const osPct = os == null ? null : os <= 1 ? os * 100 : os;
      if (near > 0) dims.originality = 35;
      else if (osPct != null) dims.originality = osPct;
    }

    const ctx: TransformCtx = { content: input.content ?? '', originality: input.originality };
    const recs: Recommendation[] = [];

    for (const dim of DIMENSION_ORDER) {
      const score = dims[dim];
      if (score == null || score >= WEAK_THRESHOLD) continue;
      const cfg = DIMENSION_CONFIG[dim];
      if (!cfg) continue;

      const target = pickTargetBlock(blocks, cfg.preferred, cfg.fallback);
      if (!target) continue; // e.g. only candidate blocks are locked

      const before = target.text ?? '';
      if (!before.trim()) continue;

      let after: string;
      try {
        after = cfg.transform(before, ctx);
      } catch {
        continue; // a broken transform never blocks the rest
      }
      if (!after || after.trim() === before.trim()) continue; // no-op → no rec

      const rec = buildRec(dim, cfg, score, target, before, after);
      // Wave-5: attach explainable learning references ONLY when learning was
      // supplied. Absent ⇒ `rec` is byte-identical to Wave 4 (no field added).
      if (input.learningMemory || (Array.isArray(input.intelligence) && input.intelligence.length > 0)) {
        const learningRefs = buildLearningReferences(dim, input);
        if (learningRefs.length > 0) rec.learningReferences = learningRefs;
      }
      recs.push(rec);
    }

    return recs;
  } catch {
    return [];
  }
}
