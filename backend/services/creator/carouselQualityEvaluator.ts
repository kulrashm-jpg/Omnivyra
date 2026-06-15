/**
 * Carousel Phase B — Commit B1 (SHADOW measurement).
 *
 * Pure, deterministic, zero-API quality evaluator for carousel blueprints. It
 * EMITS an `EditorGradeResult` (the shared editor-grade currency) across five
 * dimensions and nothing more — it makes NO decisions, blocks nothing, and
 * never mutates the blueprint. Gating + regeneration are Commit B2.
 *
 * Dimensions (each → one EditorGradeCheck):
 *   carousel.genericity            carousel.slide_uniqueness
 *   carousel.narrative_progression carousel.insight_density
 *   carousel.cta_quality
 */
import {
  createEditorGradeResult,
  type EditorGradeCheck,
  type EditorGradeResult,
} from '../../../lib/shared/editorGradeReadiness';

export type CarouselSlideLike = {
  role?: unknown;
  headline?: unknown;
  body_text?: unknown;
  visual_description?: unknown;
};

export type CarouselQualityInput = {
  slides: CarouselSlideLike[];
  archetype?: string | null;
  ctaIntensity?: string | null;
  topic?: string | null;
};

/* ── Carousel-tuned pattern banks (replicate the proven post families; the
 *    post validator's banks are not exported, so we keep a local, carousel-
 *    calibrated copy rather than modify lib/shared/postBodyQualityValidator). ── */
const GENERIC_ADVICE = [
  'provide value', 'add value', 'be consistent', 'stay consistent', 'engage with your audience',
  'know your audience', 'focus on quality', 'build trust', 'be authentic', 'do your research',
];
const AI_FILLER = [
  'delve into', 'leverage', 'seamlessly', 'robust', 'game-changer', 'game changer', 'elevate your',
  'cutting-edge', 'unlock the power', "in today's world", 'in todays world', 'navigate the',
  'harness the', 'tapestry', 'realm of', 'ever-evolving', 'fast-paced world',
];
const VAGUE_BUSINESS = [
  'drive growth', 'optimize your', 'maximize your', 'streamline', 'synergy',
  'take it to the next level', 'move the needle', 'best practices',
];
const EMPTY_MOTIVATION = [
  'dream big', 'believe in yourself', 'keep pushing', 'success starts', 'anything is possible',
  'mindset is everything', 'never give up', 'hustle harder',
];
const WEAK_CTA = [
  'learn more', 'click here', 'check it out', 'read more', 'find out more', 'stay tuned',
  'follow for more', 'dm us', 'link in bio', 'swipe up',
];
const STRONG_CTA_VERBS = [
  'sign up', 'try', 'buy', 'book', 'start', 'get', 'download', 'subscribe', 'join', 'claim', 'register',
];
const SOFT_CTA_MARKERS = [
  'what do you think', 'share your', 'save this', 'reflect', 'comment', 'which one', 'let me know', '?',
];
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'are', 'that', 'this', 'have', 'from', 'they', 'will',
  'what', 'when', 'how', 'why', 'into', 'their', 'them', 'our', 'a', 'an', 'to', 'of', 'in', 'on', 'is',
  'it', 'as', 'at', 'be', 'or', 'by', 'we', 'i',
]);

/* ── text helpers ─────────────────────────────────────────────────────── */
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function slideText(slide: CarouselSlideLike): string {
  return `${str(slide.headline)} ${str(slide.body_text)}`.trim();
}
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9%$.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(text: string): string[] {
  return normalize(text).split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t));
}
function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
function countMatches(haystack: string, phrases: string[]): string[] {
  const n = normalize(haystack);
  return phrases.filter((p) => n.includes(normalize(p)));
}
/** Common capitalized words that are NOT proper-noun specificity signals. */
const COMMON_CAPITALIZED = new Set([
  'you', 'your', 'we', 'our', 'be', 'do', 'dont', 'always', 'never', 'keep', 'add', 'provide',
  'leverage', 'believe', 'dream', 'success', 'mindset', 'hustle', 'anything', 'this', 'that', 'the',
  'when', 'how', 'why', 'what', 'it', 'they', 'their', 'start', 'get', 'try', 'make', 'build',
  'focus', 'stay', 'know', 'use', 'learn', 'read', 'follow', 'swipe', 'click', 'most', 'every',
]);

/** Specificity anchor: number/percent/money, evidence words, or a real proper
 *  noun. The proper-noun test is conservative — a Capitalized token preceded by
 *  a lowercase word (mid-sentence) and not in COMMON_CAPITALIZED — to avoid
 *  false positives on title-cased headlines and sentence-initial filler words. */
function hasSpecificity(raw: string): boolean {
  if (/\d|%|\$/.test(raw)) return true;
  if (/\b(source|report|survey|study|data|research|according to|case study|benchmark)\b/i.test(raw)) return true;
  const matches = raw.match(/[a-z]{2,}\s+[A-Z][a-zA-Z]{2,}/g);
  if (matches) {
    for (const seg of matches) {
      const word = (seg.trim().split(/\s+/).pop() || '').toLowerCase();
      if (!COMMON_CAPITALIZED.has(word)) return true;
    }
  }
  return false;
}
function shingles(toks: string[], n = 3): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= toks.length; i += 1) out.add(toks.slice(i, i + n).join(' '));
  return out;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}
function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
function roleOf(slide: CarouselSlideLike, index: number, total: number): string {
  const r = str(slide.role).toLowerCase();
  if (r) return r;
  return index === 0 ? 'hook' : index === total - 1 ? 'cta' : 'insight';
}
function isCtaRole(role: string): boolean {
  return /cta|next_step|next step|call|action/.test(role);
}
function isProofRole(role: string): boolean {
  return /proof|evidence|result|stat|example|outcome/.test(role);
}

/* ── Section B — Genericity ───────────────────────────────────────────── */
function scoreGenericity(slides: CarouselSlideLike[]): EditorGradeCheck {
  const flagged: number[] = [];
  let fillerHits = 0;
  let motivationHits = 0;
  slides.forEach((slide, i) => {
    const text = slideText(slide);
    const generic = countMatches(text, GENERIC_ADVICE).length + countMatches(text, VAGUE_BUSINESS).length;
    const filler = countMatches(text, AI_FILLER).length;
    const motivation = countMatches(text, EMPTY_MOTIVATION).length;
    fillerHits += filler;
    motivationHits += motivation;
    const lowInfo = wordCount(text) < 6 && !hasSpecificity(text);
    if ((generic > 0 || motivation > 0) && !hasSpecificity(text)) flagged.push(i);
    else if (filler >= 2 || lowInfo) flagged.push(i);
  });
  const total = Math.max(1, slides.length);
  const genericRatio = flagged.length / total;
  const score = clamp(100 - genericRatio * 100 - Math.min(20, fillerHits * 4));
  const passed = genericRatio < 0.3 && fillerHits < total && motivationHits === 0;
  return {
    id: 'carousel.genericity',
    phase: 'generation',
    passed,
    severity: 'important',
    score,
    message: passed ? undefined : `Generic/AI-filler content on ${flagged.length}/${total} slides.`,
    metadata: { generic_slide_indices: flagged, generic_ratio: Number(genericRatio.toFixed(2)), filler_hits: fillerHits, motivation_hits: motivationHits },
  };
}

/* ── Section C — Slide uniqueness ─────────────────────────────────────── */
function scoreUniqueness(slides: CarouselSlideLike[]): EditorGradeCheck {
  const texts = slides.map(slideText);
  const tokenSets = texts.map((t) => new Set(tokens(t)));
  const shingleSets = texts.map((t) => shingles(tokens(t)));
  let maxSim = 0;
  let sumSim = 0;
  let pairs = 0;
  let worst: { a: number; b: number; sim: number } | null = null;
  for (let i = 0; i < slides.length; i += 1) {
    for (let j = i + 1; j < slides.length; j += 1) {
      const sim = Math.max(jaccard(tokenSets[i], tokenSets[j]), jaccard(shingleSets[i], shingleSets[j]));
      sumSim += sim;
      pairs += 1;
      if (sim > maxSim) { maxSim = sim; worst = { a: i, b: j, sim: Number(sim.toFixed(2)) }; }
    }
  }
  const meanSim = pairs ? sumSim / pairs : 0;
  const score = clamp(100 - maxSim * 60 - meanSim * 40);
  const passed = maxSim < 0.6 && meanSim < 0.4;
  return {
    id: 'carousel.slide_uniqueness',
    phase: 'generation',
    passed,
    severity: 'important',
    score,
    message: passed ? undefined : `Slides overlap (max similarity ${maxSim.toFixed(2)}).`,
    metadata: { max_similarity: Number(maxSim.toFixed(2)), mean_similarity: Number(meanSim.toFixed(2)), worst_pair: worst },
  };
}

/* ── Section D — Narrative progression ────────────────────────────────── */
function scoreProgression(slides: CarouselSlideLike[]): EditorGradeCheck {
  const total = slides.length;
  const reasons: string[] = [];
  let score = 100;
  const firstRole = total ? roleOf(slides[0], 0, total) : '';
  const lastRole = total ? roleOf(slides[total - 1], total - 1, total) : '';
  const hasHook = /hook|title|problem/.test(firstRole);
  const hasCta = isCtaRole(lastRole);
  if (!hasHook) { score -= 20; reasons.push('missing_hook_beat'); }
  if (!hasCta) { score -= 20; reasons.push('missing_cta_beat'); }
  // Proof/result/example roles should carry a concrete anchor.
  const unbackedProof = slides.filter((s, i) => isProofRole(roleOf(s, i, total)) && !hasSpecificity(slideText(s)));
  if (unbackedProof.length > 0) { score -= 20; reasons.push('proof_without_specifics'); }
  // Escalation: specificity density should not regress from first half to second half.
  if (total >= 4) {
    const mid = Math.floor(total / 2);
    const firstHalf = slides.slice(0, mid).filter((s) => hasSpecificity(slideText(s))).length / Math.max(1, mid);
    const secondHalf = slides.slice(mid).filter((s) => hasSpecificity(slideText(s))).length / Math.max(1, total - mid);
    if (secondHalf + 0.25 < firstHalf) { score -= 20; reasons.push('escalation_regresses'); }
  }
  score = clamp(score);
  const passed = score >= 70 && hasHook && hasCta;
  return {
    id: 'carousel.narrative_progression',
    phase: 'generation',
    passed,
    severity: 'important',
    score,
    message: passed ? undefined : `Weak progression: ${reasons.join(', ')}.`,
    metadata: { reasons, has_hook: hasHook, has_cta: hasCta },
  };
}

/* ── Section E — Insight density ──────────────────────────────────────── */
function scoreInsightDensity(slides: CarouselSlideLike[]): EditorGradeCheck {
  const total = slides.length;
  // content slides = everything except the closing cta slide
  const contentSlides = slides.filter((s, i) => !isCtaRole(roleOf(s, i, total)));
  const denom = Math.max(1, contentSlides.length);
  const specific = contentSlides.filter((s) => {
    const t = slideText(s);
    return hasSpecificity(t) || /\b(for example|e\.g\.|such as|for instance)\b/i.test(t);
  }).length;
  const ratio = specific / denom;
  const unmetRoleSlides = slides.filter((s, i) => isProofRole(roleOf(s, i, total)) && !hasSpecificity(slideText(s)));
  const score = clamp(ratio * 100 - unmetRoleSlides.length * 10);
  const passed = ratio >= 0.6 && unmetRoleSlides.length === 0;
  return {
    id: 'carousel.insight_density',
    phase: 'generation',
    passed,
    severity: 'important',
    score,
    message: passed ? undefined : `Low insight density: only ${specific}/${denom} content slides carry concrete specifics.`,
    metadata: { specific_ratio: Number(ratio.toFixed(2)), specific_slides: specific, content_slides: denom, unmet_proof_roles: unmetRoleSlides.length },
  };
}

/* ── Section F — CTA quality ──────────────────────────────────────────── */
function scoreCtaQuality(slides: CarouselSlideLike[], ctaIntensity: string | null, topic: string | null): EditorGradeCheck {
  const total = slides.length;
  const ctaSlide = total ? slides[total - 1] : undefined;
  const ctaText = ctaSlide ? slideText(ctaSlide) : '';
  const ctaNorm = normalize(ctaText);

  const weakOnly = WEAK_CTA.some((p) => ctaNorm.includes(normalize(p)))
    && !STRONG_CTA_VERBS.some((v) => ctaNorm.includes(normalize(v)));
  const hasAction = STRONG_CTA_VERBS.some((v) => ctaNorm.includes(normalize(v)))
    || /\b(start|get|try|see|grab|save|share|comment|follow)\b/.test(ctaNorm);
  const topicTokens = new Set(tokens(str(topic)));
  const ctaTokens = new Set(tokens(ctaText));
  const relevance = jaccard(topicTokens, ctaTokens) > 0 || hasSpecificity(ctaText);
  const clarity = wordCount(ctaText) > 0 && wordCount(ctaText) <= 14;

  // Archetype alignment vs ctaIntensity.
  const intensity = (ctaIntensity || '').toLowerCase();
  let aligned = true;
  if (intensity === 'strong') aligned = STRONG_CTA_VERBS.some((v) => ctaNorm.includes(normalize(v)));
  else if (intensity === 'subtle') aligned = SOFT_CTA_MARKERS.some((m) => ctaNorm.includes(normalize(m)));
  else if (intensity === 'absent') aligned = !STRONG_CTA_VERBS.some((v) => ctaNorm.includes(normalize(v)));

  const subScores = [
    relevance ? 100 : 50,
    clarity ? 100 : 60,
    hasAction && !weakOnly ? 100 : 50,
    aligned ? 100 : 55,
  ];
  const score = clamp(subScores.reduce((a, b) => a + b, 0) / subScores.length);
  const passed = score >= 70 && aligned && hasAction;
  return {
    id: 'carousel.cta_quality',
    phase: 'generation',
    passed,
    severity: 'important',
    score,
    message: passed ? undefined : `CTA weak/misaligned (intensity=${intensity || 'n/a'}).`,
    metadata: { relevance, clarity, has_action: hasAction, weak_only: weakOnly, archetype_aligned: aligned, intensity: intensity || null },
  };
}

/**
 * Evaluate a carousel blueprint across all five dimensions and return the
 * merged EditorGradeResult. Observational only — callers in B1 record it; they
 * do not act on it.
 */
export function evaluateCarouselQuality(input: CarouselQualityInput): EditorGradeResult {
  const slides = Array.isArray(input.slides) ? input.slides : [];
  const checks: EditorGradeCheck[] = [
    scoreGenericity(slides),
    scoreUniqueness(slides),
    scoreProgression(slides),
    scoreInsightDensity(slides),
    scoreCtaQuality(slides, input.ctaIntensity ?? null, input.topic ?? null),
  ];
  return createEditorGradeResult({ checks });
}
