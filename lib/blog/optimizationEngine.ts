/**
 * Optimization Engine
 *
 * Deterministic, pure-function analysis that turns search scores and raw
 * content_blocks into prioritised issues and actionable instructions.
 *
 * Design rules (same as searchScoringEngine):
 *   - No AI calls. No external APIs. No DB access.
 *   - All thresholds are derived from searchScoringEngine constants.
 *   - parseBlocks() from searchScoringEngine is reused — no re-implementation.
 *   - Section-level detection is a single extra pass over content_blocks.
 */

import { parseBlocks, type BlogPost, type SearchScores } from './searchScoringEngine';

// ── Instruction codes ─────────────────────────────────────────────────────────

export type InstructionCode =
  | 'FIX_SEO_SCORE'
  | 'FIX_AEO_SCORE'
  | 'FIX_GEO_SCORE'
  | 'ADD_KEYWORD_TO_HEADINGS'
  | 'ADD_INTERNAL_LINKS'
  | 'EXPAND_CONTENT'
  | 'ADD_SUMMARY'
  | 'ADD_FAQ'
  | 'ADD_DIRECT_ANSWERS'
  | 'ADD_REFERENCES'
  | 'ADD_ENTITIES'
  | 'IMPROVE_SEMANTICS'
  | 'ADD_HEADINGS'
  | 'EXPAND_SECTION'
  | 'ADD_EXAMPLES'
  | 'FIX_TITLE_KEYWORD';

// ── Public types ──────────────────────────────────────────────────────────────

export type OptimizationSeverity = 'high' | 'medium' | 'low';
export type OptimizationPriority = 'high' | 'medium' | 'low';

export interface OptimizationIssue {
  type:     string;
  severity: OptimizationSeverity;
  message:  string;
}

export interface OptimizationAction {
  type:             string;
  instruction_code: InstructionCode;
  priority:         OptimizationPriority;
  instruction:      string;
  /** 0–100 composite of severity × score deficit. */
  impact:           number;
  /** Projected point gains per search dimension if this action is completed. */
  expected_score_gain: {
    seo?: number;
    aeo?: number;
    geo?: number;
  };
  /** Heading text for section-level actions. */
  target?:          string;
  /** Id of the heading block that starts the target section. */
  target_block_id?: string;
}

export interface OptimizationResult {
  priority: OptimizationPriority;
  issues:   OptimizationIssue[];
  actions:  OptimizationAction[];
}

// ── Thresholds (aligned to searchScoringEngine scoring breakpoints) ───────────

const THRESHOLD = {
  SCORE_HIGH:          50,   // any score below this → overall priority = high
  SCORE_MEDIUM:        70,   // any score below this → overall priority = medium
  SEO_LOW:             60,
  AEO_LOW:             60,
  GEO_LOW:             60,
  KW_PRESENCE_FULL:    12,   // ≥12 of 20pts means keyword is in ≥2 headings
  SUMMARY_EXISTS:      10,   // ≥10 of 20pts means summary block exists
  FAQ_ADEQUATE:        20,   // ≥20 of 30pts means ≥3 FAQ pairs
  SNIPPET_ADEQUATE:     8,   // ≥8 of 15pts means ≥1 definition paragraph
  CONTENT_DEEP:        15,   // ≥15 of 20pts means word_count ≥ 800
  ENTITY_ADEQUATE:     20,   // ≥20 of 30pts means ≥5 entities
  SEMANTIC_ADEQUATE:   11,   // ≥11 of 15pts means ≥20 unique semantic tokens
  MIN_INTERNAL_LINKS:   2,
  MIN_REFERENCES:       3,
  MIN_WORD_COUNT:     800,
  MIN_FAQ_PAIRS:        3,
  SECTION_MIN_WORDS:   50,
} as const;

// ── Expected score gains per instruction code ─────────────────────────────────
//
// Conservative, per-action estimates derived from each dimension's max point
// allocation in searchScoringEngine. Used as static expected_score_gain values.

const SCORE_GAIN: Record<InstructionCode, { seo?: number; aeo?: number; geo?: number }> = {
  FIX_SEO_SCORE:           { seo: 10 },
  FIX_AEO_SCORE:           { aeo: 10 },
  FIX_GEO_SCORE:           { geo: 10 },
  ADD_KEYWORD_TO_HEADINGS: { seo: 8 },
  ADD_INTERNAL_LINKS:      { seo: 6 },
  EXPAND_CONTENT:          { seo: 12 },
  ADD_SUMMARY:             { seo: 5, aeo: 8 },
  ADD_FAQ:                 { aeo: 15 },
  ADD_DIRECT_ANSWERS:      { aeo: 6 },
  ADD_REFERENCES:          { geo: 12 },
  ADD_ENTITIES:            { geo: 8 },
  IMPROVE_SEMANTICS:       { geo: 5 },
  ADD_HEADINGS:            { seo: 10 },
  EXPAND_SECTION:          { seo: 4 },
  ADD_EXAMPLES:            { aeo: 3, geo: 3 },
  FIX_TITLE_KEYWORD:       { seo: 8 },
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function severityFromScore(score: number): OptimizationSeverity {
  if (score < THRESHOLD.SCORE_HIGH)   return 'high';
  if (score < THRESHOLD.SCORE_MEDIUM) return 'medium';
  return 'low';
}

/**
 * Overall priority: if ANY of the three scores is below a tier, that tier wins.
 */
function computeOverallPriority(
  seo: number,
  aeo: number,
  geo: number,
): OptimizationPriority {
  if (seo < THRESHOLD.SCORE_HIGH || aeo < THRESHOLD.SCORE_HIGH || geo < THRESHOLD.SCORE_HIGH) {
    return 'high';
  }
  if (seo < THRESHOLD.SCORE_MEDIUM || aeo < THRESHOLD.SCORE_MEDIUM || geo < THRESHOLD.SCORE_MEDIUM) {
    return 'medium';
  }
  return 'low';
}

/**
 * Impact: 0–100 composite of severity base + score deficit contribution.
 * deficit = how many points below 100 the relevant score is (0–100).
 */
function computeImpact(severity: OptimizationSeverity, deficit: number): number {
  const base = severity === 'high' ? 55 : severity === 'medium' ? 30 : 12;
  return Math.min(100, Math.round(base + deficit * 0.45));
}

/**
 * Extracts the first meaningful keyword from the post title.
 */
function primaryKeyword(title: string): string {
  const STOPS = new Set([
    'a','an','the','and','or','in','on','at','to','for','of','with','how','why','what',
  ]);
  const token = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .find(w => w.length > 3 && !STOPS.has(w));
  return token ?? title.toLowerCase().split(/\s+/)[0] ?? '';
}

// ── Deduplication ─────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<OptimizationPriority, number> = { high: 3, medium: 2, low: 1 };

/**
 * Merges actions with the same instruction_code into a single action.
 * Section-level actions are keyed by instruction_code + target_block_id so
 * that distinct sections are never collapsed into one action.
 *
 * Merge rules:
 *   - Keep the highest priority variant's instruction text.
 *   - Keep the highest impact value.
 *   - expected_score_gain is stable (same code → same gain table entry).
 */
export function dedupeActions(actions: OptimizationAction[]): OptimizationAction[] {
  const byKey = new Map<string, OptimizationAction>();

  for (const action of actions) {
    // Section actions are unique per target block — do not merge across blocks
    const key = action.target_block_id
      ? `${action.instruction_code}::${action.target_block_id}`
      : action.instruction_code;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...action });
    } else {
      // Higher-priority variant wins instruction text and bumps impact
      if (PRIORITY_RANK[action.priority] > PRIORITY_RANK[existing.priority]) {
        existing.priority    = action.priority;
        existing.instruction = action.instruction;
      }
      if (action.impact > existing.impact) {
        existing.impact = action.impact;
      }
    }
  }

  return [...byKey.values()];
}

// ── Section-level analysis ────────────────────────────────────────────────────

interface SectionInfo {
  heading:     string;
  /** Id of the heading block that opened this section. */
  blockId:     string;
  wordCount:   number;
  hasExamples: boolean;
  hasList:     boolean;
}

/**
 * Single pass over content_blocks to group paragraph text under the preceding
 * heading. Tracks word count, examples, and list presence per section.
 * Also captures the block id (or positional fallback) of each heading block.
 */
function analyzeContentSections(blocks: unknown): SectionInfo[] {
  const sections: SectionInfo[] = [];

  let heading     = 'Introduction';
  let blockId     = 'intro';
  let wordCount   = 0;
  let hasExamples = false;
  let hasList     = false;

  function flush(): void {
    sections.push({ heading, blockId, wordCount, hasExamples, hasList });
    wordCount   = 0;
    hasExamples = false;
    hasList     = false;
  }

  function textWordCount(html: string): number {
    const t = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? t.split(/\s+/).length : 0;
  }

  const blockArray = Array.isArray(blocks) ? blocks : [];

  blockArray.forEach((raw: unknown, blockIndex: number) => {
    if (!raw || typeof raw !== 'object') return;
    const b    = raw as Record<string, unknown>;
    const type = typeof b['type'] === 'string' ? b['type'] : '';

    switch (type) {
      case 'heading': {
        if (wordCount > 0 || hasExamples || hasList) flush();
        heading = typeof b['text'] === 'string' && b['text'].trim()
          ? b['text'].trim()
          : 'Section';
        // Prefer an explicit block id; fall back to positional index
        blockId = typeof b['id'] === 'string' && b['id']
          ? b['id']
          : `block_${blockIndex}`;
        break;
      }
      case 'paragraph': {
        wordCount += textWordCount(typeof b['html'] === 'string' ? b['html'] : '');
        break;
      }
      case 'callout': {
        const title = (typeof b['title'] === 'string' ? b['title'] : '').toLowerCase();
        if (title.includes('example') || title.includes('e.g.') || title.includes('eg.')) {
          hasExamples = true;
        }
        wordCount += textWordCount(typeof b['body'] === 'string' ? b['body'] : '');
        break;
      }
      case 'list': {
        hasList = true;
        break;
      }
      case 'quote': {
        wordCount += textWordCount(typeof b['text'] === 'string' ? b['text'] : '');
        break;
      }
      // summary / key_insights / divider / image do not contribute to section depth
    }
  });

  if (wordCount > 0 || hasExamples || hasList || sections.length === 0) {
    flush();
  }

  return sections;
}

// ── SEO issue detection ───────────────────────────────────────────────────────

function detectSeoIssues(
  post:    BlogPost,
  parsed:  ReturnType<typeof parseBlocks>,
  scores:  SearchScores,
  issues:  OptimizationIssue[],
  actions: OptimizationAction[],
): void {
  const bd      = scores.breakdown.seo;
  const sev     = severityFromScore(scores.seo_score);
  const deficit = Math.max(0, 100 - scores.seo_score);

  if (scores.seo_score < THRESHOLD.SEO_LOW) {
    issues.push({
      type:     'seo_score_low',
      severity: sev,
      message:  `SEO score ${scores.seo_score}/100 is below the 60-point threshold.`,
    });
    actions.push({
      type:             'seo_general',
      instruction_code: 'FIX_SEO_SCORE',
      priority:         sev,
      instruction:      `Raise SEO score from ${scores.seo_score} to at least 60 by resolving the keyword, heading, and depth issues below.`,
      impact:           computeImpact(sev, deficit),
      expected_score_gain: SCORE_GAIN['FIX_SEO_SCORE'],
    });
  }

  // Keyword not in ≥2 headings
  if ((bd['keyword_presence'] ?? 20) < THRESHOLD.KW_PRESENCE_FULL) {
    const kw = primaryKeyword(post.title);
    issues.push({
      type:     'seo_keyword_headings',
      severity: 'medium',
      message:  kw
        ? `Primary keyword "${kw}" does not appear in at least 2 headings.`
        : 'Title has no clear primary keyword.',
    });
    actions.push({
      type:             'seo_add_keyword_to_headings',
      instruction_code: 'ADD_KEYWORD_TO_HEADINGS',
      priority:         'medium',
      instruction:      kw
        ? `Include "${kw}" in at least 2 H2 or H3 headings.`
        : 'Rewrite the title to lead with a clear primary keyword, then use it in 2+ headings.',
      impact:           computeImpact('medium', deficit),
      expected_score_gain: SCORE_GAIN['ADD_KEYWORD_TO_HEADINGS'],
    });
  }

  // Fewer than 2 internal links
  if (post.internal_links < THRESHOLD.MIN_INTERNAL_LINKS) {
    const missing   = THRESHOLD.MIN_INTERNAL_LINKS - post.internal_links;
    const severity: OptimizationSeverity = post.internal_links === 0 ? 'high' : 'medium';
    issues.push({
      type:     'seo_internal_links',
      severity,
      message:  `${post.internal_links} internal link(s) — minimum ${THRESHOLD.MIN_INTERNAL_LINKS} required.`,
    });
    actions.push({
      type:             'seo_add_internal_links',
      instruction_code: 'ADD_INTERNAL_LINKS',
      priority:         severity,
      instruction:      `Add ${missing} more internal link(s) to related posts on this site.`,
      impact:           computeImpact(severity, deficit),
      expected_score_gain: SCORE_GAIN['ADD_INTERNAL_LINKS'],
    });
  }

  // Word count below 800
  if ((bd['content_depth'] ?? 20) < THRESHOLD.CONTENT_DEEP) {
    const severity: OptimizationSeverity = parsed.wordCount < 500 ? 'high' : 'medium';
    issues.push({
      type:     'seo_word_count',
      severity,
      message:  `Content is ~${parsed.wordCount} words — below the ${THRESHOLD.MIN_WORD_COUNT}-word minimum.`,
    });
    actions.push({
      type:             'seo_expand_content',
      instruction_code: 'EXPAND_CONTENT',
      priority:         severity,
      instruction:      `Expand content to at least ${THRESHOLD.MIN_WORD_COUNT} words by adding examples, data, or deeper explanations.`,
      impact:           computeImpact(severity, deficit),
      expected_score_gain: SCORE_GAIN['EXPAND_CONTENT'],
    });
  }

  // No summary block — shares ADD_SUMMARY code with AEO detector for dedup
  if ((bd['metadata_completeness'] ?? 20) < THRESHOLD.SUMMARY_EXISTS) {
    issues.push({
      type:     'seo_no_summary',
      severity: 'medium',
      message:  'No summary block — summaries improve snippet eligibility and SEO metadata.',
    });
    actions.push({
      type:             'seo_add_summary',
      instruction_code: 'ADD_SUMMARY',
      priority:         'medium',
      instruction:      'Add a summary block (20+ words) to the post.',
      impact:           computeImpact('medium', deficit),
      expected_score_gain: SCORE_GAIN['ADD_SUMMARY'],
    });
  }
}

// ── AEO issue detection ───────────────────────────────────────────────────────

function detectAeoIssues(
  _post:   BlogPost,
  parsed:  ReturnType<typeof parseBlocks>,
  scores:  SearchScores,
  issues:  OptimizationIssue[],
  actions: OptimizationAction[],
): void {
  const bd      = scores.breakdown.aeo;
  const sev     = severityFromScore(scores.aeo_score);
  const deficit = Math.max(0, 100 - scores.aeo_score);

  if (scores.aeo_score < THRESHOLD.AEO_LOW) {
    issues.push({
      type:     'aeo_score_low',
      severity: sev,
      message:  `AEO score ${scores.aeo_score}/100 — post is not optimised for answer engines.`,
    });
    actions.push({
      type:             'aeo_general',
      instruction_code: 'FIX_AEO_SCORE',
      priority:         sev,
      instruction:      `Raise AEO score from ${scores.aeo_score} to at least 60 with FAQ, summary, and direct-answer content.`,
      impact:           computeImpact(sev, deficit),
      expected_score_gain: SCORE_GAIN['FIX_AEO_SCORE'],
    });
  }

  // FAQ section missing or insufficient
  if ((bd['faq_section'] ?? 30) < THRESHOLD.FAQ_ADEQUATE) {
    const current   = parsed.faqPairs.length;
    const severity: OptimizationSeverity = current === 0 ? 'high' : 'medium';
    issues.push({
      type:     'aeo_faq',
      severity,
      message:  current === 0
        ? 'No FAQ section detected.'
        : `Only ${current} FAQ pair(s) — at least ${THRESHOLD.MIN_FAQ_PAIRS} required.`,
    });
    actions.push({
      type:             'aeo_add_faq',
      instruction_code: 'ADD_FAQ',
      priority:         severity,
      instruction:      current === 0
        ? 'Add a FAQ section with 5 questions and answers under 50 words each.'
        : `Add ${THRESHOLD.MIN_FAQ_PAIRS - current} more FAQ question(s) to reach ${THRESHOLD.MIN_FAQ_PAIRS} pairs.`,
      impact:           computeImpact(severity, deficit),
      expected_score_gain: SCORE_GAIN['ADD_FAQ'],
    });
  }

  // Weak or missing summary — shares ADD_SUMMARY code with SEO detector for dedup
  if ((bd['summary_block'] ?? 20) < THRESHOLD.SUMMARY_EXISTS) {
    issues.push({
      type:     'aeo_weak_summary',
      severity: 'medium',
      message:  parsed.hasSummary
        ? 'Summary block is too short (under 20 words).'
        : 'No summary block — required for featured snippet eligibility.',
    });
    actions.push({
      type:             'aeo_improve_summary',
      instruction_code: 'ADD_SUMMARY',
      priority:         'medium',
      instruction:      parsed.hasSummary
        ? 'Expand the summary block to at least 50 words.'
        : 'Add a summary block (50+ words) at the start of the post.',
      impact:           computeImpact('medium', deficit),
      expected_score_gain: SCORE_GAIN['ADD_SUMMARY'],
    });
  }

  // No direct-answer / definition-style sentences
  if ((bd['snippet_readiness'] ?? 15) < THRESHOLD.SNIPPET_ADEQUATE) {
    issues.push({
      type:     'aeo_no_direct_answers',
      severity: 'low',
      message:  'No definition-style sentences detected — post lacks direct-answer snippets.',
    });
    actions.push({
      type:             'aeo_add_direct_answers',
      instruction_code: 'ADD_DIRECT_ANSWERS',
      priority:         'low',
      instruction:      'Add at least 2 sentences starting with "[Topic] is..." or "[Topic] refers to..." near the top of the post.',
      impact:           computeImpact('low', deficit),
      expected_score_gain: SCORE_GAIN['ADD_DIRECT_ANSWERS'],
    });
  }
}

// ── GEO issue detection ───────────────────────────────────────────────────────

function detectGeoIssues(
  post:    BlogPost,
  _parsed: ReturnType<typeof parseBlocks>,
  scores:  SearchScores,
  issues:  OptimizationIssue[],
  actions: OptimizationAction[],
): void {
  const bd      = scores.breakdown.geo;
  const sev     = severityFromScore(scores.geo_score);
  const deficit = Math.max(0, 100 - scores.geo_score);

  if (scores.geo_score < THRESHOLD.GEO_LOW) {
    issues.push({
      type:     'geo_score_low',
      severity: sev,
      message:  `GEO score ${scores.geo_score}/100 — post is not optimised for generative AI citation.`,
    });
    actions.push({
      type:             'geo_general',
      instruction_code: 'FIX_GEO_SCORE',
      priority:         sev,
      instruction:      `Raise GEO score from ${scores.geo_score} to at least 60 by adding references, entities, and semantic depth.`,
      impact:           computeImpact(sev, deficit),
      expected_score_gain: SCORE_GAIN['FIX_GEO_SCORE'],
    });
  }

  // Fewer than 3 references
  if (post.references_count < THRESHOLD.MIN_REFERENCES) {
    const missing   = THRESHOLD.MIN_REFERENCES - post.references_count;
    const severity: OptimizationSeverity = post.references_count === 0 ? 'high' : 'medium';
    issues.push({
      type:     'geo_references',
      severity,
      message:  `${post.references_count} external reference(s) — minimum ${THRESHOLD.MIN_REFERENCES} required for citability.`,
    });
    actions.push({
      type:             'geo_add_references',
      instruction_code: 'ADD_REFERENCES',
      priority:         severity,
      instruction:      `Add ${missing} external reference(s) from authoritative sources (studies, official docs, industry reports).`,
      impact:           computeImpact(severity, deficit),
      expected_score_gain: SCORE_GAIN['ADD_REFERENCES'],
    });
  }

  // Low entity count
  if ((bd['entity_presence'] ?? 30) < THRESHOLD.ENTITY_ADEQUATE) {
    issues.push({
      type:     'geo_low_entities',
      severity: 'medium',
      message:  'Low entity count — post lacks named entities needed for AI knowledge alignment.',
    });
    actions.push({
      type:             'geo_add_entities',
      instruction_code: 'ADD_ENTITIES',
      priority:         'medium',
      instruction:      'Add at least 5 named entities (tools, companies, frameworks, people) in the body and as tags.',
      impact:           computeImpact('medium', deficit),
      expected_score_gain: SCORE_GAIN['ADD_ENTITIES'],
    });
  }

  // Weak semantic richness
  if ((bd['semantic_richness'] ?? 15) < THRESHOLD.SEMANTIC_ADEQUATE) {
    issues.push({
      type:     'geo_weak_semantics',
      severity: 'low',
      message:  'Limited unique vocabulary in headings and key insights — low semantic richness.',
    });
    actions.push({
      type:             'geo_improve_semantics',
      instruction_code: 'IMPROVE_SEMANTICS',
      priority:         'low',
      instruction:      'Diversify heading vocabulary and add a key_insights block with 5+ distinct concept tokens.',
      impact:           computeImpact('low', deficit),
      expected_score_gain: SCORE_GAIN['IMPROVE_SEMANTICS'],
    });
  }
}

// ── Section-level issue detection ─────────────────────────────────────────────

function detectSectionIssues(
  post:    BlogPost,
  parsed:  ReturnType<typeof parseBlocks>,
  issues:  OptimizationIssue[],
  actions: OptimizationAction[],
): void {
  if (parsed.headings.length === 0) {
    issues.push({
      type:     'structure_no_headings',
      severity: 'high',
      message:  'No headings found — post lacks structural hierarchy required for scanning and indexing.',
    });
    actions.push({
      type:             'structure_add_headings',
      instruction_code: 'ADD_HEADINGS',
      priority:         'high',
      instruction:      'Add at least 3 H2 headings to create a clear content hierarchy.',
      impact:           computeImpact('high', 0),
      expected_score_gain: SCORE_GAIN['ADD_HEADINGS'],
    });
    return;
  }

  const sections = analyzeContentSections(post.content_blocks);

  // Sections that are too short
  const shortSections = sections.filter(
    s => s.wordCount > 0 && s.wordCount < THRESHOLD.SECTION_MIN_WORDS,
  );
  for (const s of shortSections) {
    issues.push({
      type:     'section_too_short',
      severity: 'low',
      message:  `Section "${s.heading}" is ~${s.wordCount} words — under the ${THRESHOLD.SECTION_MIN_WORDS}-word minimum.`,
    });
    actions.push({
      type:             'section_expand',
      instruction_code: 'EXPAND_SECTION',
      priority:         'low',
      instruction:      `Expand section "${s.heading}" with examples, data points, or step-by-step details (target: 100+ words).`,
      impact:           computeImpact('low', 0),
      expected_score_gain: SCORE_GAIN['EXPAND_SECTION'],
      target:           s.heading,
      target_block_id:  s.blockId,
    });
  }

  // Sections long enough but with no examples or lists — cap at 2 to avoid noise
  const dryLongSections = sections
    .filter(s => !s.hasExamples && !s.hasList && s.wordCount >= THRESHOLD.SECTION_MIN_WORDS)
    .slice(0, 2);
  for (const s of dryLongSections) {
    actions.push({
      type:             'section_add_examples',
      instruction_code: 'ADD_EXAMPLES',
      priority:         'low',
      instruction:      `Add a callout block or list with concrete examples to section "${s.heading}".`,
      impact:           computeImpact('low', 0),
      expected_score_gain: SCORE_GAIN['ADD_EXAMPLES'],
      target:           s.heading,
      target_block_id:  s.blockId,
    });
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Analyzes a blog post's optimization needs using its search scores and
 * content structure. Fully deterministic — no AI calls or external APIs.
 *
 * @param post   - BlogPost with content_blocks, title, tags, internal_links, references_count
 * @param scores - SearchScores output from computeSearchScores()
 * @returns      OptimizationResult with priority, issues, and deduplicated actions
 */
export function analyzeOptimization(
  post:   BlogPost,
  scores: SearchScores,
): OptimizationResult {
  const parsed     = parseBlocks(post.content_blocks, post.tags);
  const issues:     OptimizationIssue[]  = [];
  const rawActions: OptimizationAction[] = [];

  detectSeoIssues(post, parsed, scores, issues, rawActions);
  detectAeoIssues(post, parsed, scores, issues, rawActions);
  detectGeoIssues(post, parsed, scores, issues, rawActions);
  detectSectionIssues(post, parsed, issues, rawActions);

  return {
    priority: computeOverallPriority(scores.seo_score, scores.aeo_score, scores.geo_score),
    issues,
    actions: dedupeActions(rawActions),
  };
}
