/**
 * Content Quality Enhancer — core layer.
 *
 * Shared constants (stop-words, template patterns, depth/GEO regexes, budgets),
 * public + internal types, text utilities, the section parser, and the depth
 * evaluator. Split from contentQualityEnhancer_v2_1.ts (Agent-B large-file
 * modularization); the main module re-exports the public surface.
 */
import { wordCount } from '../../pages/blogs.helpers';
import type { BlogGenerationOutput } from '../blog/blogGenerationEngine';
import type { ContentGenerationInput, DepthMapEntry } from './cardToContentBridge';

// ── Stop-words (shared pattern with v2 engine) ────────────────────────────────

export const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','but','by',
  'for','from','had','has','have','if','in','into','is','it','its','of',
  'on','or','that','the','their','there','these','this','those','to','was',
  'were','will','with','you','your','they','them','we','our','all','about',
  'more','can','when','what','how','its','which','so','do','also','just',
  'not','any','than','then','use','used','some','other','most',
]);

// ── Template string patterns ──────────────────────────────────────────────────
// These are the bridge placeholders that should never reach injected content.

export const TEMPLATE_PATTERNS: RegExp[] = [
  /^Detailed explanation of HOW .+ works in practice\.?$/i,
  /^Concrete .+-specific example\.?$/i,
  /^Challenge the most common assumption about .+\.?$/i,
  /^Evidence from .+ execution patterns\.?$/i,
  /^\[.*\]$/,                                  // bare [placeholder]
];

// ── Depth regex (mirrors v2 engine) ──────────────────────────────────────────

export const MECHANISM_RE = /\b(because|work[s]? by|process|system|sequence|driver|caus|mechanism|operat|step[s]?|how it|the reason)\b/i;
export const EXAMPLE_RE   = /\b(for example|for instance|example|case study|scenario|consider|imagine|such as|like when|in practice|real.world)\b/i;
export const INSIGHT_RE   = /\b(this means|which means|therefore|however|the implication|why this matters|so what|the key insight|trade.?off|vs\.|versus|unlike|the difference|what this reveals|the consequence)\b/i;

// ── GEO markers ───────────────────────────────────────────────────────────────

export const GEO_ANSWER_BLOCK_RE  = /class="geo-answer"/i;
export const GEO_KEY_INSIGHT_RE   = /<strong>Key Insight:<\/strong>/i;
export const GEO_WHY_MATTERS_RE   = /<strong>Why this matters:<\/strong>/i;
export const GEO_ENTITY_RE        = /<dfn/i;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A single entry from the company's published blog catalog. */
export interface BlogCatalogEntry {
  /** URL slug, e.g. "b2b-content-strategy-pipeline-2025" */
  slug:     string;
  /** Full post title */
  title:    string;
  /** Short excerpt / description (100–200 chars ideal) */
  excerpt:  string;
  /** Post tags */
  tags:     string[];
  /** Post category */
  category: string | null;
}

/** An internal link recommendation produced by Step 2. */
export interface InternalLink {
  /** ID of the section this link was inserted into */
  section_id:  string;
  /** The anchor text used in the HTML <a> element */
  anchor_text: string;
  /** Slug of the linked post, e.g. "/blog/some-slug" */
  target_slug: string;
  /** Human-readable explanation of why this link is contextually relevant */
  context:     string;
}

export interface QualityEnhancerInput {
  content_generation_input: ContentGenerationInput;
  /** Output from runContentDepthAndInsightEngine(). Enhanced by this module. */
  final_content: BlogGenerationOutput & { content_blocks: unknown[] };
  /**
   * Published blog catalog for contextual internal linking.
   * If empty/omitted, Step 2 is skipped.
   */
  blog_catalog?: BlogCatalogEntry[];
}

export interface QualityEnhancerOutput {
  enhanced_content:     BlogGenerationOutput & { content_blocks: unknown[] };
  depth_fixes:          string[];
  links_added:          InternalLink[];
  geo_improvements:     string[];
  sections_rewritten:   string[];
  validation_report: {
    depth_score_before:          number;
    depth_score_after:           number;
    internal_links_added:        number;
    geo_score_before:            number;
    geo_score_after:             number;
    shallow_sections_fixed:      number;
    /** v2.2: sections still shallow after all injection passes */
    shallow_sections_remaining:  number;
    /** v2.2: mean depth score across all evaluable sections (0–100) */
    avg_section_depth:           number;
    /** v2.2: true if any section grew by more than MAX_INJECTION_WORDS */
    overcorrection_detected:     boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedSection {
  id:              string;
  heading:         string;
  body:            string;
  is_reference:    boolean;
  is_key_insights: boolean;
}

export interface DepthState {
  explanation: boolean;
  mechanism:   boolean;
  example:     boolean;
  insight:     boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3 && !STOP_WORDS.has(t));
}



export function isTemplate(value: string): boolean {
  if (!value || value.length < 5) return true;
  return TEMPLATE_PATTERNS.some((re) => re.test(value.trim()));
}

// ── Section parser (same logic as v2 engine) ──────────────────────────────────

export function parseSections(html: string): ParsedSection[] {
  const sections: ParsedSection[] = [];

  const firstH2 = html.search(/<h2>/i);
  if (firstH2 > 0) {
    const preamble = html.slice(0, firstH2).trim();
    if (preamble) {
      sections.push({
        id: 'section_intro',
        heading: '__intro__',
        body: preamble,
        is_reference: false,
        is_key_insights: true,
      });
    }
  }

  const h2Re = /<h2>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2>|$)/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = h2Re.exec(html)) !== null) {
    const heading = stripHtml(match[1]).trim();
    const body    = match[2].trim();
    sections.push({
      id:              `section_${idx++}`,
      heading,
      body,
      is_reference:    /^references?$/i.test(heading),
      is_key_insights: false,
    });
  }

  return sections;
}

export function assembleSections(sections: ParsedSection[]): string {
  return sections.map((s) => {
    if (s.is_key_insights) return s.body;
    return `<h2>${esc(s.heading)}</h2>\n${s.body}`;
  }).join('\n\n');
}

// ── Depth evaluator ───────────────────────────────────────────────────────────

export function evalDepthState(body: string, wc: number): DepthState {
  return {
    explanation: wc > 50 || /\b(is|are|means|refers|defined as|describes|represents)\b/i.test(body),
    mechanism:   MECHANISM_RE.test(body),
    example:     EXAMPLE_RE.test(body),
    insight:     INSIGHT_RE.test(body),
  };
}

export function depthScore(state: DepthState): number {
  return ([state.explanation, state.mechanism, state.example, state.insight].filter(Boolean).length / 4) * 100;
}

export function aggregateDepthScoreFromSections(sections: ParsedSection[]): number {
  const ev = sections.filter((s) => !s.is_reference && !s.is_key_insights);
  if (ev.length === 0) return 100;
  let total = 0;
  for (const s of ev) {
    const wc = wordCount(s.body);
    const ds = evalDepthState(s.body, wc);
    total += depthScore(ds);
  }
  return Math.round(total / ev.length);
}

// ── Best depth_map entry matcher (token overlap) ──────────────────────────────

export function matchDepthEntry(heading: string, idx: number, depthMap: DepthMapEntry[]): DepthMapEntry {
  const empty: DepthMapEntry = {
    pillar: '', key_point: '', why_it_matters: '', mechanism: '',
    example_direction: '', insight_angle: '', contrarian_take: '',
  };
  if (depthMap.length === 0) return empty;

  const headingTokens = new Set(tokenize(heading));
  let best = depthMap[Math.min(idx, depthMap.length - 1)];
  let bestScore = 0;

  for (const entry of depthMap) {
    const pt    = tokenize(entry.pillar);
    const score = pt.length > 0
      ? pt.filter((t) => headingTokens.has(t)).length / pt.length
      : 0;
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — DEPTH HARD ENFORCEMENT (v2.3)
// ─────────────────────────────────────────────────────────────────────────────

// Constants
/** Max section length before injection stops. */
export const MAX_SECTION_WORDS = 350;
/** v2.5: depth layers (mechanism + example + insight) budget per section. */
export const MAX_DEPTH_WORDS = 120;
/** v2.5: decision injection has its own budget, never blocking depth layers. */
export const MAX_DECISION_WORDS = 80;
/** v2.5: hard total injection cap per section (anti-overcorrection). */
export const MAX_TOTAL_INJECTION = 150;
/** Signal token count below which synthetic derivation activates. */
export const SIGNAL_POVERTY_THRESHOLD = 5;
