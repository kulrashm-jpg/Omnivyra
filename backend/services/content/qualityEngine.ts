/**
 * Wave 4 — DETERMINISTIC Quality Engine.
 *
 * Scores a single piece of content across twelve quality dimensions using PURE,
 * rule-based heuristics. It makes NO AI calls, touches NO database, and uses NO
 * `Math.random` / `Date.now` in scoring — the same input always yields a
 * byte-identical `QualityScorecard`. The only non-pure value (`evaluatedAt`) is
 * accepted from the caller and passed through untouched; it is never generated
 * here.
 *
 * This mirrors the spirit of the existing long-form heuristics
 * (`finalBlogOutcomeValidator`, `thoughtLeadershipQualityGate`) — keyword
 * overlap, structural counts, template-leak style checks — generalized to any
 * content type and platform, and reshaped into a per-dimension scorecard.
 *
 * FAIL-SAFE: bad input (empty text, non-string, or an internal error in any one
 * dimension) never throws. A failing dimension degrades to a low-but-valid
 * `DimensionScore`, and a catastrophic failure returns a complete low scorecard.
 */

import { getPlatformProfile } from '../../../lib/content/platformAdaptationProfiles';
import { splitIntoBlocks } from '../../../lib/content/quality/sectionBlocks';
import {
  QUALITY_DIMENSIONS,
  type DimensionScore,
  type QualityDimension,
  type QualityLabel,
  type QualityScorecard,
} from '../../../lib/content/quality/types';

export interface QualityEngineInput {
  companyId?: string;
  contentType: string;
  platform?: string;
  text: string;
  objective?: string;
  audience?: string;
  brandContext?: string;
  /** Originality score 0..1 from Wave 2 (1 = fully original). Optional. */
  originalityScore?: number;
  /**
   * Optional ISO timestamp supplied by the caller. Passed through verbatim to
   * the scorecard — NEVER generated inside the engine (determinism).
   */
  evaluatedAt?: string;
}

/**
 * Per-dimension weights for the overall weighted mean. Sums to exactly 1.0.
 * Kept as a single source of truth so the overall score is reproducible.
 */
const DIMENSION_WEIGHTS: Record<QualityDimension, number> = {
  objectiveAlignment: 0.12,
  brandVoice: 0.08,
  originality: 0.1,
  platformFit: 0.1,
  readability: 0.1,
  hook: 0.08,
  cta: 0.07,
  seo: 0.08,
  trust: 0.07,
  clarity: 0.07,
  grammar: 0.06,
  structure: 0.07,
};

/**
 * Canonical per-platform hard character ceilings. Mirrors
 * `PLATFORM_CHAR_LIMITS` in `unifiedContentProcessor` — replicated locally (not
 * imported) so this engine stays dependency-light and free of that module's
 * service-graph side effects. Keep in sync if the canonical map changes.
 */
const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  linkedin: 3000,
  instagram: 2200,
  twitter: 280,
  x: 280,
  facebook: 63206,
  youtube: 5000,
  tiktok: 2200,
  pinterest: 500,
  reddit: 40000,
};

/** Platforms whose in-body links are not clickable (so a URL there is dead weight). */
const NO_CLICKABLE_LINK_PLATFORMS = new Set(['instagram', 'tiktok']);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'your', 'you', 'are', 'was',
  'were', 'have', 'has', 'had', 'from', 'they', 'them', 'their', 'about',
  'into', 'over', 'more', 'most', 'some', 'such', 'than', 'then', 'when',
  'what', 'which', 'while', 'will', 'would', 'could', 'should', 'been', 'being',
  'here', 'there', 'these', 'those', 'them', 'our', 'ours', 'out', 'not',
  'but', 'all', 'any', 'can', 'get', 'got', 'how', 'why', 'who', 'its',
]);

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const CTA_CUES_G =
  /\b(click|comment|share|subscribe|follow|sign\s?up|learn more|read more|download|register|join|dm me|link in bio|check (?:it|this) out|get started|try (?:it|us|now|free)|book (?:a|your|now)|shop now|save this|visit|explore|discover|reach out|contact us|let'?s (?:talk|chat|connect)|start (?:your|free|today)|see more|swipe|order now)\b/gi;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function scoreToLabel(score: number): QualityLabel {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

function dim(score: number, signals: string[]): DimensionScore {
  const s = clamp(score);
  return { score: s, label: scoreToLabel(s), signals };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/[ \t]+\n/g, '\n');
}

/** Content terms of length >= 3, alpha-led, minus stopwords, de-duplicated in first-seen order. */
function contentTerms(value: string): string[] {
  const matches = value.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of matches) {
    if (STOPWORDS.has(t)) continue;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function wordList(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function sentenceList(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) return line.trim();
  }
  return '';
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function estimateSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g);
  let c = groups ? groups.length : 0;
  if (w.length > 2 && w.endsWith('e') && c > 1) c -= 1;
  return Math.max(1, c);
}

// ---------------------------------------------------------------------------
// Per-dimension heuristics — each is pure and returns a valid DimensionScore.
// ---------------------------------------------------------------------------

function scoreObjectiveAlignment(termSet: Set<string>, objective?: string): DimensionScore {
  const obj = (objective ?? '').trim();
  if (!obj) return dim(60, ['no objective supplied — neutral alignment']);
  const objTerms = contentTerms(obj);
  if (objTerms.length === 0) return dim(60, ['objective had no salient terms — neutral']);
  const matched = objTerms.filter((t) => termSet.has(t));
  const ratio = matched.length / objTerms.length;
  return dim(25 + ratio * 75, [
    `${matched.length}/${objTerms.length} objective terms present in content`,
  ]);
}

function scoreBrandVoice(termSet: Set<string>, lower: string, brandContext?: string): DimensionScore {
  const hasFirstPerson = /\b(we|we're|weve|we've|our|ours|us)\b/i.test(lower);
  const bc = (brandContext ?? '').trim();
  if (!bc) {
    return dim(55 + (hasFirstPerson ? 10 : 0), [
      'no brand context supplied — tone-only assessment',
      hasFirstPerson ? 'first-person brand voice present' : 'no first-person brand voice',
    ]);
  }
  const bcTerms = contentTerms(bc);
  const matched = bcTerms.length ? bcTerms.filter((t) => termSet.has(t)) : [];
  const ratio = bcTerms.length ? matched.length / bcTerms.length : 0;
  return dim(30 + ratio * 60 + (hasFirstPerson ? 10 : 0), [
    `${matched.length}/${bcTerms.length} brand terms echoed`,
    hasFirstPerson ? 'first-person brand voice present' : 'no first-person brand voice',
  ]);
}

function scoreOriginality(originalityScore?: number): DimensionScore {
  if (typeof originalityScore !== 'number' || !Number.isFinite(originalityScore)) {
    return dim(60, ['no originality score supplied — neutral']);
  }
  const pct = clamp(originalityScore * 100);
  return dim(pct, [`originality ${pct}/100 (from upstream originality check)`]);
}

function scorePlatformFit(text: string, platform: string | undefined): DimensionScore {
  const profile = getPlatformProfile(platform);
  const key = profile.platform;
  const [minW, maxW] = profile.wordRange;
  const wc = wordList(text).length;
  const chars = Array.from(text).length;
  const signals: string[] = [];
  let score = 100;

  if (wc < minW) {
    score -= Math.min(35, Math.round(((minW - wc) / Math.max(1, minW)) * 40));
    signals.push(`below ${key} word range (${wc} < ${minW})`);
  } else if (wc > maxW) {
    score -= Math.min(35, Math.round(((wc - maxW) / Math.max(1, maxW)) * 40));
    signals.push(`above ${key} word range (${wc} > ${maxW})`);
  } else {
    signals.push(`within ${key} word range (${minW}-${maxW})`);
  }

  const limit = PLATFORM_CHAR_LIMITS[key];
  if (limit && chars > limit) {
    score -= 40;
    signals.push(`exceeds ${key} char limit (${chars} > ${limit})`);
  }

  const emojiCount = countMatches(text, EMOJI_RE);
  if (profile.emojiPolicy === '' && emojiCount > 0) {
    score -= 15;
    signals.push(`${emojiCount} emoji on a no-emoji surface (${key})`);
  } else if (emojiCount > 8) {
    score -= 10;
    signals.push(`emoji-heavy (${emojiCount})`);
  }

  const hashtagCount = countMatches(text, /(^|\s)#[^\s#]+/g);
  if (key === 'reddit' && hashtagCount > 0) {
    score -= 10;
    signals.push(`hashtags on reddit (${hashtagCount})`);
  } else if (hashtagCount > 12) {
    score -= 8;
    signals.push(`hashtag spam (${hashtagCount})`);
  }

  return dim(score, signals);
}

function scoreReadability(text: string): DimensionScore {
  const words = wordList(text);
  const wc = words.length;
  if (wc === 0) return dim(30, ['no prose to score']);
  const sentences = sentenceList(text);
  const sc = Math.max(1, sentences.length);
  const syllables = words.reduce((sum, w) => sum + estimateSyllables(w), 0);
  const avgSentenceLen = wc / sc;
  const flesch = 206.835 - 1.015 * avgSentenceLen - 84.6 * (syllables / wc);
  const score = clamp(flesch);
  return dim(score, [
    `Flesch ~${score}`,
    `avg sentence length ${avgSentenceLen.toFixed(1)} words`,
  ]);
}

function scoreHook(text: string): DimensionScore {
  const first = firstNonEmptyLine(text);
  if (!first) return dim(20, ['no opening line']);
  const signals: string[] = [];
  let score = 40;
  if (/\?/.test(first)) {
    score += 15;
    signals.push('question hook');
  }
  if (/\d/.test(first)) {
    score += 12;
    signals.push('number/stat in hook');
  }
  if (/\b(how|why|what|secret|mistake|stop|never|avoid|imagine|discover|truth|nobody|everyone|reason|the one)\b/i.test(first)) {
    score += 15;
    signals.push('curiosity marker');
  }
  if (/\b(you|your)\b/i.test(first)) {
    score += 10;
    signals.push('reader-addressed');
  }
  const hookWords = wordList(first).length;
  if (hookWords >= 4 && hookWords <= 14) {
    score += 8;
    signals.push('punchy length');
  } else if (hookWords > 25) {
    score -= 8;
    signals.push('opening line too long');
  }
  if (/^(in this|today|in the world of|as a|welcome|hello|hi there|in recent)/i.test(first)) {
    score -= 12;
    signals.push('generic opener');
  }
  return dim(score, signals);
}

function scoreCta(text: string, blockHasCta: boolean, platform: string | undefined): DimensionScore {
  const cueCount = countMatches(text, CTA_CUES_G);
  const signals: string[] = [];
  let score: number;
  if (!blockHasCta && cueCount === 0) {
    score = 30;
    signals.push('no CTA detected');
  } else if (cueCount > 3) {
    score = 60;
    signals.push(`multiple CTA cues (${cueCount}) dilute focus`);
  } else if (blockHasCta && cueCount <= 2) {
    score = 85;
    signals.push('single clear CTA');
  } else {
    score = 75;
    signals.push('CTA present');
  }
  const key = getPlatformProfile(platform).platform;
  if (NO_CLICKABLE_LINK_PLATFORMS.has(key) && /https?:\/\/|www\./i.test(text)) {
    score -= 15;
    signals.push(`inline link unusable on ${key}`);
  }
  return dim(score, signals);
}

function scoreSeo(termSet: Set<string>, text: string, objective?: string): DimensionScore {
  const signals: string[] = [];
  let score = 45;
  const obj = (objective ?? '').trim();
  if (obj) {
    const objTerms = contentTerms(obj);
    const matched = objTerms.filter((t) => termSet.has(t));
    const ratio = objTerms.length ? matched.length / objTerms.length : 0;
    score += Math.round(ratio * 35);
    signals.push(`${matched.length}/${objTerms.length} keyword terms indexed`);
  } else {
    signals.push('no objective/keywords supplied');
  }
  const hashtagCount = countMatches(text, /(^|\s)#[^\s#]+/g);
  if (hashtagCount >= 1 && hashtagCount <= 8) {
    score += 12;
    signals.push(`${hashtagCount} hashtags`);
  } else if (hashtagCount > 8) {
    score += 4;
    signals.push(`${hashtagCount} hashtags (over-tagged)`);
  }
  if (/\d/.test(text)) {
    score += 8;
    signals.push('contains numerals (listicle/stat signal)');
  }
  return dim(score, signals);
}

function scoreTrust(text: string): DimensionScore {
  const signals: string[] = [];
  let score = 100;
  const fabricated = [
    /\bstudies show\b/i,
    /\bresearch shows\b/i,
    /\bexperts (say|agree)\b/i,
    /\b(scientifically|clinically) proven\b/i,
    /\b100%\s+guarantee/i,
    /\bguaranteed results\b/i,
    /\bproven to\b/i,
    /\bnumber one\b/i,
    /\bworld'?s best\b/i,
    /\bmiracle\b/i,
    /\bovernight\b/i,
  ];
  const hits = fabricated.filter((re) => re.test(text)).length;
  if (hits > 0) {
    score -= Math.min(50, hits * 12);
    signals.push(`${hits} unsupported-proof markers`);
  }
  const superlatives = countMatches(text, /\b(amazing|incredible|revolutionary|game-?changer|unbelievable|insane|mind-?blowing|life-?changing)\b/gi);
  if (superlatives > 2) {
    score -= 12;
    signals.push(`superlative overload (${superlatives})`);
  }
  const hedges = countMatches(text, /\b(may|might|can|could|often|typically|generally|in many cases|tends to)\b/gi);
  if (hedges === 0 && wordList(text).length > 40) {
    score -= 6;
    signals.push('no hedging in a long claim-heavy piece');
  }
  if (signals.length === 0) signals.push('no fabricated-proof markers');
  return dim(score, signals);
}

function scoreClarity(text: string): DimensionScore {
  const wc = Math.max(1, wordList(text).length);
  const sc = Math.max(1, sentenceList(text).length);
  const signals: string[] = [];
  let score = 100;
  const fillers = countMatches(text, /\b(very|really|just|actually|basically|literally|simply|in order to|that said|at the end of the day|needless to say)\b/gi);
  const fillerDensity = fillers / wc;
  if (fillers > 0) {
    score -= Math.min(30, Math.round(fillerDensity * 300));
    signals.push(`${fillers} filler words`);
  }
  const passive = countMatches(text, /\b(?:was|were|is|are|been|being|be)\s+\w+(?:ed|en)\b/gi);
  const passiveDensity = passive / sc;
  if (passive > 0) {
    score -= Math.min(25, Math.round(passiveDensity * 40));
    signals.push(`${passive} passive constructions`);
  }
  if (signals.length === 0) signals.push('lean, active prose');
  return dim(score, signals);
}

function scoreGrammar(text: string): DimensionScore {
  const signals: string[] = [];
  let score = 100;
  const doubleSpaces = countMatches(text, / {2,}/g);
  if (doubleSpaces > 0) {
    score -= 8;
    signals.push(`${doubleSpaces} double-space runs`);
  }
  const repeated = countMatches(text, /\b(\w+)\s+\1\b/gi);
  if (repeated > 0) {
    score -= Math.min(24, repeated * 8);
    signals.push(`${repeated} repeated words`);
  }
  const sentences = sentenceList(text);
  let lowerStarts = 0;
  for (const s of sentences) {
    const m = s.match(/[A-Za-z]/);
    if (m && m[0] === m[0].toLowerCase()) lowerStarts += 1;
  }
  if (lowerStarts > 0) {
    score -= Math.min(20, lowerStarts * 5);
    signals.push(`${lowerStarts} sentences not capitalized`);
  }
  const trimmed = text.trim();
  if (trimmed.length > 0 && !/[.!?…"')\]]$/.test(trimmed) && !/#[^\s#]+$/.test(trimmed) && !EMOJI_RE.test(trimmed.slice(-2))) {
    score -= 6;
    signals.push('missing terminal punctuation');
  }
  if (signals.length === 0) signals.push('no basic grammar issues found');
  return dim(score, signals);
}

function scoreStructure(rawText: string, contentType: string, platform: string | undefined): DimensionScore {
  const blocks = splitIntoBlocks(rawText, contentType);
  const types = new Set(blocks.map((b) => b.blockType));
  const signals: string[] = [`blocks: ${blocks.map((b) => b.blockType).join(', ') || 'none'}`];
  let score = 40;
  if (types.has('hook')) score += 20;
  else signals.push('no hook block');
  if (types.has('body') || types.has('opening')) score += 15;
  else signals.push('no body/opening block');
  if (types.has('cta')) score += 10;
  const key = getPlatformProfile(platform).platform;
  const social = ['instagram', 'x', 'twitter', 'tiktok', 'threads', 'facebook', 'linkedin'].includes(key);
  if (social && types.has('hashtags')) score += 8;
  const firstType = blocks[0]?.blockType;
  if (firstType === 'hook' || firstType === 'opening') score += 10;
  else if (blocks.length > 0) {
    score -= 5;
    signals.push('does not open with a hook');
  }
  if (blocks.length >= 3) score += 7;
  return dim(score, signals);
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/** A complete, valid, low scorecard used as the fail-safe floor. */
function floorScorecard(evaluatedAt?: string, reason = 'unscorable input'): QualityScorecard {
  const dimensions = {} as Record<QualityDimension, DimensionScore>;
  for (const d of QUALITY_DIMENSIONS) {
    dimensions[d] = dim(10, [reason]);
  }
  return { overall: 10, dimensions, ...(evaluatedAt ? { evaluatedAt } : {}) };
}

/**
 * Evaluates content and returns a full 12-dimension scorecard. Deterministic,
 * pure, AI-free, DB-free. Never throws.
 */
export function evaluate(input: QualityEngineInput): QualityScorecard {
  try {
    const rawText = typeof input?.text === 'string' ? input.text : '';
    const contentType = typeof input?.contentType === 'string' ? input.contentType : 'unknown';
    if (rawText.trim().length === 0) {
      return floorScorecard(input?.evaluatedAt, 'empty content');
    }

    const text = stripHtml(rawText);
    const lower = text.toLowerCase();
    const termSet = new Set(contentTerms(text));
    const blocks = splitIntoBlocks(rawText, contentType);
    const blockHasCta = blocks.some((b) => b.blockType === 'cta');

    // Each dimension is independently guarded: a throw in one degrades that
    // single dimension to a low-but-valid score without failing the whole card.
    const guarded = (fn: () => DimensionScore): DimensionScore => {
      try {
        return fn();
      } catch {
        return dim(20, ['dimension unscorable — heuristic error']);
      }
    };

    const dimensions: Record<QualityDimension, DimensionScore> = {
      objectiveAlignment: guarded(() => scoreObjectiveAlignment(termSet, input.objective)),
      brandVoice: guarded(() => scoreBrandVoice(termSet, lower, input.brandContext)),
      originality: guarded(() => scoreOriginality(input.originalityScore)),
      platformFit: guarded(() => scorePlatformFit(text, input.platform)),
      readability: guarded(() => scoreReadability(text)),
      hook: guarded(() => scoreHook(text)),
      cta: guarded(() => scoreCta(text, blockHasCta, input.platform)),
      seo: guarded(() => scoreSeo(termSet, text, input.objective)),
      trust: guarded(() => scoreTrust(text)),
      clarity: guarded(() => scoreClarity(text)),
      grammar: guarded(() => scoreGrammar(text)),
      structure: guarded(() => scoreStructure(rawText, contentType, input.platform)),
    };

    let weighted = 0;
    for (const d of QUALITY_DIMENSIONS) {
      weighted += dimensions[d].score * DIMENSION_WEIGHTS[d];
    }
    const overall = clamp(weighted);

    return {
      overall,
      dimensions,
      ...(input.evaluatedAt ? { evaluatedAt: input.evaluatedAt } : {}),
    };
  } catch {
    return floorScorecard(input?.evaluatedAt, 'engine error');
  }
}
