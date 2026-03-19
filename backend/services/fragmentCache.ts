/**
 * Result Fragment Reuse — #4 Advanced Optimization
 *
 * Breaks GPT outputs into reusable sub-components and stores them
 * independently. When a new content request arrives, it assembles
 * a full response from cached fragments instead of calling GPT.
 *
 * Fragment types:
 *   HOOK    — opening line / attention-grabber (tied to topic + content_type)
 *   CTA     — call-to-action phrase (tied to cta_type + industry)
 *   THEME   — strategic topic frame (tied to pain_point + objective)
 *   STRUCTURE — key_points skeleton (tied to content_type + audience)
 *
 * Reuse logic:
 *   A "complete" blueprint can be assembled if all 3 components
 *   (hook + key_points + cta) have fragments that match the current request.
 *
 *   Match criteria use Jaccard similarity at different thresholds:
 *     hook      — topic similarity ≥ 0.70 (looser, hooks are topic-agnostic in tone)
 *     cta       — exact cta_type match (CTAs are highly reusable)
 *     structure — audience + content_type similarity ≥ 0.75
 *
 * Storage:
 *   Fragments are stored in-process only (fast, no Redis overhead for sub-ms access).
 *   Max 500 entries total, LRU eviction, 30-minute TTL.
 *   For cross-worker reuse, call persistFragments() to write to Redis (optional).
 */

import type { ContentBlueprint } from './contentBlueprintCache';

// ── Config ─────────────────────────────────────────────────────────────────────

const MAX_FRAGMENTS    = 500;
const FRAGMENT_TTL_MS  = 30 * 60 * 1000; // 30 min

const HOOK_SIM_THRESHOLD      = 0.70;
const STRUCTURE_SIM_THRESHOLD = 0.75;

// ── Types ──────────────────────────────────────────────────────────────────────

export type FragmentType = 'hook' | 'cta' | 'structure';

interface HookFragment {
  type: 'hook';
  value: string;
  topicTokens: string[];
  contentType: string;
  /** Edge case #5: scope guardrails — prevent cross-industry leakage */
  industry:   string;
  platform:   string;
  toneKey:    string;   // first 3 words of tone_guidelines, normalized
}

interface CtaFragment {
  type: 'cta';
  value: string;
  ctaType:  string;
  industry: string;
  platform: string;
}

interface StructureFragment {
  type: 'structure';
  keyPoints: string[];
  contentType: string;
  audienceTokens: string[];
  industry: string;
  toneKey:  string;
}

type Fragment = HookFragment | CtaFragment | StructureFragment;

interface FragmentEntry {
  fragment:    Fragment;
  accessOrder: number;
  timestamp:   number;
  useCount:    number;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const _store = new Map<string, FragmentEntry>();
let _accessCounter = 0;
let _reuseCount = 0;
let _storeCount = 0;

// ── Utilities ─────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return Array.from(new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3)
  ));
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function evictLRU(): void {
  let oldest: { key: string; order: number } | null = null;
  for (const [key, e] of _store) {
    if (!oldest || e.accessOrder < oldest.order) {
      oldest = { key, order: e.accessOrder };
    }
  }
  if (oldest) _store.delete(oldest.key);
}

function touch(key: string, entry: FragmentEntry): void {
  _accessCounter++;
  entry.accessOrder = _accessCounter;
  entry.timestamp   = Date.now();
  entry.useCount++;
}

function isStale(entry: FragmentEntry): boolean {
  return Date.now() - entry.timestamp > FRAGMENT_TTL_MS;
}

// ── Store fragments from a blueprint ─────────────────────────────────────────

/**
 * Decompose a ContentBlueprint into fragments and store them.
 * Call this every time a GPT response is received.
 */
/** Normalize tone to a short key for scoping (first 3 meaningful words). */
function toneKey(tone?: string): string {
  return tokenize(tone ?? '').slice(0, 3).join('_') || 'neutral';
}

export function storeFragments(
  blueprint: ContentBlueprint,
  meta: {
    topic:       string;
    contentType: string;
    ctaType?:    string;
    audience?:   string;
    industry?:   string;
    platform?:   string;
    tone?:       string;
  },
): void {
  if (_store.size >= MAX_FRAGMENTS) evictLRU();

  _accessCounter++;
  const now      = Date.now();
  const industry = (meta.industry || 'generic').toLowerCase().slice(0, 30);
  const platform = (meta.platform || 'any').toLowerCase();
  const tk       = toneKey(meta.tone);

  // Hook fragment — scoped by industry + platform + tone (edge case #5)
  if (blueprint.hook) {
    const key = `hook:${tokenize(meta.topic).slice(0, 5).join('_')}:${meta.contentType}:${industry}:${platform}`;
    _store.set(key, {
      fragment: {
        type: 'hook',
        value: blueprint.hook,
        topicTokens: tokenize(meta.topic),
        contentType: meta.contentType,
        industry,
        platform,
        toneKey: tk,
      },
      accessOrder: _accessCounter,
      timestamp: now,
      useCount: 0,
    });
    _storeCount++;
  }

  // CTA fragment — scoped by industry + platform (edge case #5)
  if (blueprint.cta && meta.ctaType) {
    const key = `cta:${meta.ctaType.toLowerCase().replace(/\s+/g, '_')}:${industry}:${platform}`;
    _store.set(key, {
      fragment: {
        type: 'cta',
        value: blueprint.cta,
        ctaType:  meta.ctaType,
        industry,
        platform,
      },
      accessOrder: _accessCounter,
      timestamp: now,
      useCount: 0,
    });
    _storeCount++;
  }

  // Structure fragment — scoped by industry + tone (edge case #5)
  if (Array.isArray(blueprint.key_points) && blueprint.key_points.length >= 2) {
    const audTokens = tokenize(meta.audience ?? '');
    const key = `structure:${meta.contentType}:${audTokens.slice(0, 4).join('_')}:${industry}`;
    _store.set(key, {
      fragment: {
        type: 'structure',
        keyPoints: blueprint.key_points,
        contentType: meta.contentType,
        audienceTokens: audTokens,
        industry,
        toneKey: tk,
      },
      accessOrder: _accessCounter,
      timestamp: now,
      useCount: 0,
    });
    _storeCount++;
  }
}

// ── Retrieve fragments ─────────────────────────────────────────────────────────

function findBestHook(
  topic:       string,
  contentType: string,
  industry:    string,
  platform:    string,
  tk:          string,
): string | null {
  const queryTokens = tokenize(topic);
  let best: { key: string; score: number; entry: FragmentEntry } | null = null;

  for (const [key, entry] of _store) {
    if (isStale(entry)) { _store.delete(key); continue; }
    const f = entry.fragment;
    if (f.type !== 'hook') continue;
    if (f.contentType !== contentType) continue;
    // Edge case #5: scope guardrails — skip cross-industry/platform/tone leakage
    if (f.industry !== industry) continue;
    if (f.platform !== platform) continue;
    if (f.toneKey !== tk) continue;
    const score = jaccard(queryTokens, f.topicTokens);
    if (score >= HOOK_SIM_THRESHOLD && (!best || score > best.score)) {
      best = { key, score, entry };
    }
  }

  if (best) {
    touch(best.key, best.entry);
    return (best.entry.fragment as HookFragment).value;
  }
  return null;
}

function findBestCta(ctaType: string, industry: string, platform: string): string | null {
  const slug = ctaType.toLowerCase().replace(/\s+/g, '_');

  // Exact match: ctaType + industry + platform
  const exactKey = `cta:${slug}:${industry}:${platform}`;
  const exact = _store.get(exactKey);
  if (exact && !isStale(exact)) {
    touch(exactKey, exact);
    return (exact.fragment as CtaFragment).value;
  }

  // Relax platform — same industry, any platform
  const industryKey = `cta:${slug}:${industry}:any`;
  const industryMatch = _store.get(industryKey);
  if (industryMatch && !isStale(industryMatch)) {
    touch(industryKey, industryMatch);
    return (industryMatch.fragment as CtaFragment).value;
  }

  // Relax both — generic CTA (edge case #5: only fall back if generic, never cross-industry)
  const genericKey = `cta:${slug}:generic:any`;
  const generic = _store.get(genericKey);
  if (generic && !isStale(generic)) {
    touch(genericKey, generic);
    return (generic.fragment as CtaFragment).value;
  }

  return null;
}

function findBestStructure(
  contentType: string,
  audience:    string,
  industry:    string,
  tk:          string,
): string[] | null {
  const queryTokens = tokenize(audience);
  let best: { key: string; score: number; entry: FragmentEntry } | null = null;

  for (const [key, entry] of _store) {
    if (isStale(entry)) { _store.delete(key); continue; }
    const f = entry.fragment;
    if (f.type !== 'structure') continue;
    if (f.contentType !== contentType) continue;
    // Edge case #5: scope guardrails
    if (f.industry !== industry) continue;
    if (f.toneKey !== tk) continue;
    const score = jaccard(queryTokens, f.audienceTokens);
    if (score >= STRUCTURE_SIM_THRESHOLD && (!best || score > best.score)) {
      best = { key, score, entry };
    }
  }

  if (best) {
    touch(best.key, best.entry);
    return (best.entry.fragment as StructureFragment).keyPoints;
  }
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Try to assemble a full ContentBlueprint from cached fragments.
 * Returns null if any component is missing (caller should fall through to GPT).
 *
 * @param topic       - Content topic
 * @param contentType - e.g. 'post', 'carousel'
 * @param ctaType     - e.g. 'Soft CTA', 'Hard CTA'
 * @param audience    - Target audience
 * @param industry    - Industry scope (edge case #5: prevents cross-industry leakage)
 * @param platform    - Platform scope (e.g. 'linkedin', 'twitter')
 * @param tone        - Tone guidelines (first 3 words used as scope key)
 */
export function assembleFromFragments(
  topic:       string,
  contentType: string,
  ctaType:     string,
  audience:    string,
  industry?:   string,
  platform?:   string,
  tone?:       string,
): ContentBlueprint | null {
  const ind = (industry || 'generic').toLowerCase().slice(0, 30);
  const plt = (platform  || 'any').toLowerCase();
  const tk  = toneKey(tone);

  const hook      = findBestHook(topic, contentType, ind, plt, tk);
  const cta       = findBestCta(ctaType, ind, plt);
  const keyPoints = findBestStructure(contentType, audience, ind, tk);

  if (!hook || !cta || !keyPoints) return null;

  _reuseCount++;
  return { hook, key_points: keyPoints, cta };
}

export function getFragmentCacheStats() {
  const activeCount = Array.from(_store.values()).filter(e => !isStale(e)).length;
  return {
    totalFragments: activeCount,
    reuseCount:     _reuseCount,
    storeCount:     _storeCount,
    reuseRate:      _storeCount > 0 ? Math.round((_reuseCount / _storeCount) * 1000) / 1000 : 0,
  };
}
