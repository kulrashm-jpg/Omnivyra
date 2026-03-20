/**
 * Prediction Feature Extractor
 *
 * Transforms raw campaign plan data into a normalised feature vector (0–1 range)
 * consumed by the prediction engine. All features are deterministic and require
 * no AI calls.
 *
 * Features:
 *   hook_strength      — quality of first line (question, curiosity, pattern interrupt)
 *   readability        — avg sentence length, paragraph density
 *   platform_fit       — content types match platform best-practice norms
 *   authority_score    — passed in from account context (follower tier, trust)
 *   historical         — historical engagement rate from previous campaigns (normalised)
 */

import { scoreHookQuality } from './contentValidationService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureInput = {
  /** Representative content sample (e.g. campaign description or a sample post). */
  content: string;
  platform: string;
  content_type: string;
  /** Hook quality score if already computed; otherwise derived from content. */
  hook_score?: number;
  /** Sentiment score 0–1 (1 = very positive). */
  sentiment_score?: number;
  /** Account authority 0–1 (follower tier + historical credibility). */
  account_authority?: number;
  /** Historical engagement rate from prior campaigns (raw decimal, e.g. 0.045). */
  historical_performance?: number;
};

export type FeatureVector = {
  hook_strength: number;      // 0–1
  readability: number;        // 0–1
  platform_fit: number;       // 0–1
  authority_score: number;    // 0–1
  historical: number;         // 0–1
  sentiment: number;          // 0–1
  /** Raw inputs preserved for trace. */
  raw: {
    hook_score: number;
    avg_sentence_words: number;
    content_type: string;
    platform: string;
    sentiment_score: number;
    account_authority: number;
    historical_engagement_rate: number;
  };
};

// ── Platform → ideal content type affinity map ───────────────────────────────
// Score 1.0 = ideal, 0.7 = acceptable, 0.4 = poor fit
const PLATFORM_CONTENT_AFFINITY: Record<string, Record<string, number>> = {
  linkedin:  { post: 1.0, article: 1.0, carousel: 0.9, video: 0.8, poll: 0.7, story: 0.4 },
  instagram: { post: 1.0, reel: 1.0, story: 1.0, carousel: 0.9, video: 0.8, article: 0.3 },
  twitter:   { post: 1.0, thread: 1.0, tweetstorm: 1.0, poll: 0.8, video: 0.6, article: 0.5 },
  x:         { post: 1.0, thread: 1.0, tweetstorm: 1.0, poll: 0.8, video: 0.6, article: 0.5 },
  tiktok:    { video: 1.0, reel: 1.0, short: 1.0, story: 0.7, post: 0.4, article: 0.2 },
  facebook:  { post: 1.0, video: 1.0, story: 0.9, reel: 0.8, carousel: 0.7, article: 0.7 },
  youtube:   { video: 1.0, short: 0.8, article: 0.6, post: 0.3 },
  pinterest: { image: 1.0, carousel: 0.9, post: 0.7, video: 0.6 },
  reddit:    { post: 1.0, article: 0.9, video: 0.6, image: 0.5 },
};

// ── Readability scoring ───────────────────────────────────────────────────────

function scoreReadability(text: string): number {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  if (sentences.length === 0) return 0.5;

  const avgWords = sentences.reduce((sum, s) => sum + s.split(/\s+/).filter(Boolean).length, 0) / sentences.length;

  // Ideal sentence length: 8–15 words → score 1.0; penalty outside range
  let lengthScore: number;
  if (avgWords < 5) lengthScore = 0.5;
  else if (avgWords <= 15) lengthScore = 1.0 - Math.max(0, (avgWords - 12) / 10);
  else lengthScore = Math.max(0.2, 1.0 - (avgWords - 15) / 30);

  // Paragraph density — prefer 2–4 sentences per paragraph
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const avgSentPerParagraph = paragraphs.length > 0 ? sentences.length / paragraphs.length : sentences.length;
  const densityScore = avgSentPerParagraph <= 4 ? 1.0 : Math.max(0.3, 1.0 - (avgSentPerParagraph - 4) / 10);

  return parseFloat(((lengthScore * 0.6 + densityScore * 0.4)).toFixed(3));
}

// ── Platform fit ──────────────────────────────────────────────────────────────

function scorePlatformFit(platform: string, contentType: string): number {
  const p = platform.toLowerCase();
  const ct = contentType.toLowerCase();
  const affinityMap = PLATFORM_CONTENT_AFFINITY[p];
  if (!affinityMap) return 0.5; // unknown platform → neutral
  return affinityMap[ct] ?? 0.4;
}

// ── Historical normalisation ──────────────────────────────────────────────────
// Converts raw engagement rate to 0–1 score
// 0% = 0.0,  2% = 0.4,  5% = 0.8,  8%+ = 1.0
function normaliseHistorical(rate: number): number {
  if (rate <= 0) return 0;
  if (rate >= 0.08) return 1.0;
  return parseFloat(Math.min(1, rate / 0.08).toFixed(3));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main extractor
// ─────────────────────────────────────────────────────────────────────────────

export function extractFeatures(input: FeatureInput): FeatureVector {
  // Hook strength
  const hookResult = scoreHookQuality(input.content);
  const hookScore = input.hook_score !== undefined ? input.hook_score : hookResult.score;

  // Readability
  const readability = scoreReadability(input.content);

  // Platform fit
  const platformFit = scorePlatformFit(input.platform, input.content_type);

  // Authority — accept passed value or default 0.5
  const authority = Math.max(0, Math.min(1, input.account_authority ?? 0.5));

  // Historical
  const historical = normaliseHistorical(input.historical_performance ?? 0);

  // Sentiment — accept passed value or neutral 0.5
  const sentiment = Math.max(0, Math.min(1, input.sentiment_score ?? 0.5));

  const avgSentenceWords =
    input.content.split(/[.!?]+/).filter(Boolean)
      .reduce((s, sent) => s + sent.trim().split(/\s+/).filter(Boolean).length, 0) /
    Math.max(1, input.content.split(/[.!?]+/).filter(Boolean).length);

  return {
    hook_strength: parseFloat(hookScore.toFixed(3)),
    readability,
    platform_fit: platformFit,
    authority_score: parseFloat(authority.toFixed(3)),
    historical: parseFloat(historical.toFixed(3)),
    sentiment: parseFloat(sentiment.toFixed(3)),
    raw: {
      hook_score: hookScore,
      avg_sentence_words: parseFloat(avgSentenceWords.toFixed(1)),
      content_type: input.content_type,
      platform: input.platform,
      sentiment_score: sentiment,
      account_authority: authority,
      historical_engagement_rate: input.historical_performance ?? 0,
    },
  };
}
