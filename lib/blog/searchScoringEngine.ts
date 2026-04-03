/**
 * Search Scoring Engine
 *
 * Deterministic, pure-function scoring for three search paradigms:
 *   SEO — Search Engine Optimization   (keywords, structure, depth, linking)
 *   AEO — Answer Engine Optimization   (FAQ pairs, summaries, snippet clarity)
 *   GEO — Generative Engine Optimization (entities, references, semantic richness)
 *
 * No AI calls. No external APIs. No DB access.
 * All scores 0–100. All inputs are content-block data or pre-computed counts.
 *
 * Block types supported (from blockTypes.ts):
 *   paragraph, heading, key_insights, callout, quote, image, media,
 *   divider, list, references, internal_link, summary
 */

// ── Input / Output types ──────────────────────────────────────────────────────

export interface BlogPost {
  title:            string;
  tags:             string[];
  /** Pre-computed InternalLinkBlock count (from companyPerformanceAdapter). */
  internal_links:   number;
  /** Pre-computed ReferencesBlock item count (from companyPerformanceAdapter). */
  references_count: number;
  /** Raw JSONB content_blocks array from DB. Treated as unknown at boundary. */
  content_blocks:   unknown;
}

export interface SearchScores {
  seo_score: number;  // 0–100
  aeo_score: number;  // 0–100
  geo_score: number;  // 0–100
  breakdown: {
    seo: Record<string, number>;
    aeo: Record<string, number>;
    geo: Record<string, number>;
  };
}

// ── Text utilities ────────────────────────────────────────────────────────────

const SEO_STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall',
  'this','that','these','those','it','its','not','no','so','if','as','up',
  'out','all','any','can','how','why','what','when','where','who','which',
]);

/** Strip HTML tags and decode common HTML entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Returns lowercase tokens with stop words and short words removed. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !SEO_STOP_WORDS.has(w));
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ── Block parser ──────────────────────────────────────────────────────────────

interface ParsedHeading {
  level:  2 | 3;
  text:   string;
}

interface FaqPair {
  question:        string;
  answerWordCount: number;
}

interface ParsedBlocks {
  headings:              ParsedHeading[];
  h2Count:               number;
  h3Count:               number;
  hasProperHierarchy:    boolean; // no H3 appears before the first H2
  wordCount:             number;
  firstHundredWords:     string;  // concatenated, lowercase
  hasSummary:            boolean;
  summaryWordCount:      number;
  hasKeyInsights:        boolean;
  keyInsightsText:       string;  // joined items for semantic analysis
  faqPairs:              FaqPair[];
  definitionCount:       number;  // paragraphs matching definition patterns
  allSemanticText:       string;  // tags + headings + key_insights for token analysis
}

/** Patterns that identify definition-style sentences for GEO snippet readiness. */
const DEFINITION_PATTERNS: RegExp[] = [
  /^[A-Za-z][a-z]+ (is|are|refers? to|means?|describes?|defines?)\b/,
  /^(A|An|The) [A-Za-z][a-z]+ (is|are)\b/,
  /^In (the context of|[a-z]+ terms?)[,\s]/,
  /^[A-Za-z][a-z]+ can be defined as\b/,
];

function isDefinitionParagraph(text: string): boolean {
  const trimmed = text.trimStart();
  return DEFINITION_PATTERNS.some(re => re.test(trimmed));
}

/**
 * Safely iterates content_blocks (unknown JSONB) and extracts all scoring signals.
 * Mirrors the safe accessor pattern in blockExtractor.ts.
 */
export function parseBlocks(blocks: unknown, tags: string[]): ParsedBlocks {
  const headings:        ParsedHeading[] = [];
  const textParts:       string[]        = [];
  const faqPairs:        FaqPair[]       = [];
  let   hasSummary       = false;
  let   summaryWordCount = 0;
  let   hasKeyInsights   = false;
  let   keyInsightsItems: string[]       = [];
  let   definitionCount  = 0;

  // FAQ detection state machine: track pending question heading
  let pendingQuestion: string | null = null;

  const blockArray = Array.isArray(blocks) ? blocks : [];

  for (const raw of blockArray) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    const type = typeof b['type'] === 'string' ? b['type'] : '';

    switch (type) {
      case 'paragraph': {
        const html = typeof b['html'] === 'string' ? b['html'] : '';
        const text = stripHtml(html);
        if (text) {
          textParts.push(text);
          if (isDefinitionParagraph(text)) definitionCount++;
        }
        // If a question heading preceded this paragraph, form a FAQ pair
        if (pendingQuestion !== null) {
          faqPairs.push({ question: pendingQuestion, answerWordCount: countWords(text) });
          pendingQuestion = null;
        }
        break;
      }

      case 'heading': {
        const level = (b['level'] === 2 || b['level'] === 3) ? b['level'] : 2;
        const text  = typeof b['text'] === 'string' ? b['text'].trim() : '';
        if (text) {
          headings.push({ level, text });
          textParts.push(text);
          // Question heading: starts FAQ pair detection
          if (text.endsWith('?')) {
            pendingQuestion = text;
          } else {
            pendingQuestion = null;
          }
        }
        break;
      }

      case 'key_insights': {
        hasKeyInsights = true;
        const items = Array.isArray(b['items']) ? b['items'] : [];
        const strs  = items.filter((i): i is string => typeof i === 'string' && i.trim().length > 0);
        keyInsightsItems = [...keyInsightsItems, ...strs];
        textParts.push(strs.join(' '));
        // Key insights items can also be FAQ questions
        for (const item of strs) {
          if (item.trim().endsWith('?')) {
            faqPairs.push({ question: item, answerWordCount: 0 });
          }
        }
        pendingQuestion = null;
        break;
      }

      case 'summary': {
        const body = typeof b['body'] === 'string' ? b['body'].trim() : '';
        if (body) {
          hasSummary     = true;
          summaryWordCount = countWords(body);
          textParts.push(body);
        }
        pendingQuestion = null;
        break;
      }

      case 'callout': {
        const title = typeof b['title'] === 'string' ? b['title'] : '';
        const body  = typeof b['body']  === 'string' ? b['body']  : '';
        if (title) textParts.push(title);
        if (body)  textParts.push(stripHtml(body));
        // Question callout titles can be FAQ starters
        if (title.trim().endsWith('?')) {
          faqPairs.push({ question: title, answerWordCount: countWords(stripHtml(body)) });
        }
        pendingQuestion = null;
        break;
      }

      case 'quote': {
        const text = typeof b['text'] === 'string' ? b['text'] : '';
        if (text) textParts.push(text);
        pendingQuestion = null;
        break;
      }

      case 'list': {
        const items = Array.isArray(b['items']) ? b['items'] : [];
        const flattenItems = (arr: unknown[]): string[] => {
          const result: string[] = [];
          for (const item of arr) {
            if (!item || typeof item !== 'object') continue;
            const li = item as Record<string, unknown>;
            const text = typeof li['text'] === 'string' ? li['text'] : '';
            if (text) result.push(text);
            if (Array.isArray(li['children'])) result.push(...flattenItems(li['children']));
          }
          return result;
        };
        const texts = flattenItems(items);
        textParts.push(texts.join(' '));
        // List items that are questions count as FAQ entries
        for (const t of texts) {
          if (t.trim().endsWith('?')) {
            faqPairs.push({ question: t, answerWordCount: 0 });
          }
        }
        pendingQuestion = null;
        break;
      }

      case 'divider':
        // Dividers do not reset FAQ detection — they're structural separators
        break;

      default:
        pendingQuestion = null;
        break;
    }
  }

  const allText       = textParts.join(' ');
  const wordCount     = countWords(allText);
  const allWords      = allText.toLowerCase().split(/\s+/);
  const firstHundredWords = allWords.slice(0, 100).join(' ');

  // Hierarchy check: no H3 before the first H2
  let firstH2Seen     = false;
  let hasOrphanH3     = false;
  for (const h of headings) {
    if (h.level === 2) { firstH2Seen = true; }
    if (h.level === 3 && !firstH2Seen) { hasOrphanH3 = true; break; }
  }

  const h2Count = headings.filter(h => h.level === 2).length;
  const h3Count = headings.filter(h => h.level === 3).length;

  // Semantic text corpus for GEO richness analysis
  const allSemanticText = [
    ...tags,
    ...headings.map(h => h.text),
    ...keyInsightsItems,
  ].join(' ');

  return {
    headings,
    h2Count,
    h3Count,
    hasProperHierarchy: !hasOrphanH3,
    wordCount,
    firstHundredWords,
    hasSummary,
    summaryWordCount,
    hasKeyInsights,
    keyInsightsText:   keyInsightsItems.join(' '),
    faqPairs,
    definitionCount,
    allSemanticText,
  };
}

// ── Entity extraction ─────────────────────────────────────────────────────────

/**
 * Counts unique entities from tags + capitalized proper-noun words in headings/title
 * (excluding first word of each phrase, which is capitalised by default).
 */
function extractEntities(
  title:    string,
  tags:     string[],
  headings: ParsedHeading[],
): string[] {
  const entities = new Set<string>();

  // Tags are explicit named entities
  for (const tag of tags) {
    const clean = tag.trim().toLowerCase();
    if (clean.length > 1) entities.add(clean);
  }

  // Proper nouns from headings: capitalised words not at position 0
  for (const h of headings) {
    const words = h.text.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const w = words[i].replace(/[^A-Za-z]/g, '');
      if (/^[A-Z][a-z]{2,}$/.test(w)) entities.add(w.toLowerCase());
    }
  }

  // Proper nouns from title (positions 1+)
  const titleWords = title.split(/\s+/);
  for (let i = 1; i < titleWords.length; i++) {
    const w = titleWords[i].replace(/[^A-Za-z]/g, '');
    if (/^[A-Z][a-z]{2,}$/.test(w)) entities.add(w.toLowerCase());
  }

  return [...entities];
}

// ── SEO scoring ───────────────────────────────────────────────────────────────

function computeSEOScore(
  post:   BlogPost,
  parsed: ParsedBlocks,
): { score: number; breakdown: Record<string, number> } {

  // ── 1. Keyword presence (20pts) ──────────────────────────────────────────
  const titleTokens   = tokenize(post.title);
  const primaryKw     = titleTokens[0] ?? '';

  // pts: title has clear primary keyword (≥2 significant tokens)
  const kwInTitle     = titleTokens.length >= 2 ? 7 : 3;

  // pts: primary keyword in first 100 words
  const kwInOpening   = (primaryKw && parsed.firstHundredWords.includes(primaryKw)) ? 7 : 0;

  // pts: primary keyword appears in ≥2 heading texts
  const kwInHeadings  = primaryKw
    ? parsed.headings.filter(h => h.text.toLowerCase().includes(primaryKw)).length >= 2
      ? 6 : 0
    : 0;

  const keyword_presence = kwInTitle + kwInOpening + kwInHeadings;

  // ── 2. Heading structure (20pts) ─────────────────────────────────────────
  const h2pts =
    parsed.h2Count >= 3 && parsed.h2Count <= 5 ? 15 :
    parsed.h2Count >= 6                         ? 10 :
    parsed.h2Count >= 1                         ?  8 : 0;

  const hierarchyPts  = parsed.hasProperHierarchy ? 5 : 0;
  const heading_structure = h2pts + hierarchyPts;

  // ── 3. Internal linking (20pts) ──────────────────────────────────────────
  const internal_linking =
    post.internal_links >= 2 ? 20 :
    post.internal_links === 1 ? 10 : 0;

  // ── 4. Content depth (20pts) ─────────────────────────────────────────────
  const content_depth =
    parsed.wordCount >= 1200 ? 20 :
    parsed.wordCount >=  800 ? 15 :
    parsed.wordCount >=  500 ? 10 :
    parsed.wordCount >=  300 ?  5 : 0;

  // ── 5. Metadata completeness (20pts) ─────────────────────────────────────
  const titlePts    = post.title.trim().length >= 5 && titleTokens.length >= 2 ? 10 : 5;
  const summaryPts  = parsed.hasSummary && parsed.summaryWordCount >= 20 ? 10 : 0;
  const metadata_completeness = titlePts + summaryPts;

  const breakdown = {
    keyword_presence:       clamp(keyword_presence, 0, 20),
    heading_structure:      clamp(heading_structure, 0, 20),
    internal_linking:       clamp(internal_linking, 0, 20),
    content_depth:          clamp(content_depth, 0, 20),
    metadata_completeness:  clamp(metadata_completeness, 0, 20),
  };

  const score = clamp(Object.values(breakdown).reduce((s, v) => s + v, 0));
  return { score, breakdown };
}

// ── AEO scoring ───────────────────────────────────────────────────────────────

function computeAEOScore(
  _post:  BlogPost,
  parsed: ParsedBlocks,
): { score: number; breakdown: Record<string, number> } {

  // ── 1. Summary block (20pts) ─────────────────────────────────────────────
  const summaryExists  = parsed.hasSummary ? 10 : 0;
  const summaryDepth   = parsed.summaryWordCount >= 50 ? 10 :
                         parsed.summaryWordCount >= 20 ?  5 : 0;
  const summary_block  = summaryExists + summaryDepth;

  // ── 2. FAQ section (30pts) ───────────────────────────────────────────────
  const faqCount = parsed.faqPairs.length;
  const faq_section =
    faqCount >= 5 ? 30 :
    faqCount >= 3 ? 20 :
    faqCount >= 1 ? 10 : 0;

  // ── 3. Answer clarity (20pts) ────────────────────────────────────────────
  // Only score if FAQ pairs with measurable answers exist
  const answeredPairs = parsed.faqPairs.filter(p => p.answerWordCount > 0);
  let answer_clarity = 0;
  if (answeredPairs.length > 0) {
    const avgWords = answeredPairs.reduce((s, p) => s + p.answerWordCount, 0) / answeredPairs.length;
    answer_clarity =
      avgWords <= 30 ? 20 :
      avgWords <= 50 ? 15 :
      avgWords <= 80 ? 10 : 5;
  }

  // ── 4. Structured sections (15pts) ───────────────────────────────────────
  const h2Pts          = parsed.h2Count >= 3 ? 8 : parsed.h2Count >= 1 ? 4 : 0;
  const keyInsightsPts = parsed.hasKeyInsights ? 7 : 0;
  const structured_sections = h2Pts + keyInsightsPts;

  // ── 5. Snippet readiness (15pts) ─────────────────────────────────────────
  const snippet_readiness =
    parsed.definitionCount >= 2 ? 15 :
    parsed.definitionCount >= 1 ?  8 : 0;

  const breakdown = {
    summary_block:       clamp(summary_block, 0, 20),
    faq_section:         clamp(faq_section, 0, 30),
    answer_clarity:      clamp(answer_clarity, 0, 20),
    structured_sections: clamp(structured_sections, 0, 15),
    snippet_readiness:   clamp(snippet_readiness, 0, 15),
  };

  const score = clamp(Object.values(breakdown).reduce((s, v) => s + v, 0));
  return { score, breakdown };
}

// ── GEO scoring ───────────────────────────────────────────────────────────────

function computeGEOScore(
  post:   BlogPost,
  parsed: ParsedBlocks,
): { score: number; breakdown: Record<string, number> } {

  // ── 1. Entity presence (30pts) ───────────────────────────────────────────
  const entities    = extractEntities(post.title, post.tags, parsed.headings);
  const entityCount = entities.length;
  const entity_presence =
    entityCount >= 8 ? 30 :
    entityCount >= 5 ? 20 :
    entityCount >= 3 ? 12 :
    entityCount >= 1 ?  5 : 0;

  // ── 2. References (20pts) ────────────────────────────────────────────────
  const references =
    post.references_count >= 3 ? 20 :
    post.references_count === 2 ? 14 :
    post.references_count === 1 ?  7 : 0;

  // ── 3. Internal link graph (20pts) ───────────────────────────────────────
  const internal_graph =
    post.internal_links >= 2 ? 20 :
    post.internal_links === 1 ? 10 : 0;

  // ── 4. Semantic richness (15pts) ─────────────────────────────────────────
  const uniqueTokens = new Set(tokenize(parsed.allSemanticText)).size;
  const semantic_richness =
    uniqueTokens >= 30 ? 15 :
    uniqueTokens >= 20 ? 11 :
    uniqueTokens >= 10 ?  7 :
    uniqueTokens >=  1 ?  3 : 0;

  // ── 5. Knowledge alignment (15pts) ───────────────────────────────────────
  // Tag variety: number and specificity of tags
  const tagScore =
    post.tags.length >= 5 ?  8 :
    post.tags.length >= 3 ?  5 :
    post.tags.length >= 1 ?  2 : 0;

  // Heading topic diversity: unique first tokens across H2 headings
  const h2FirstTokens = new Set(
    parsed.headings
      .filter(h => h.level === 2)
      .map(h => tokenize(h.text)[0])
      .filter((t): t is string => !!t),
  ).size;
  const headingDiversityScore = h2FirstTokens >= 4 ? 7 : h2FirstTokens >= 2 ? 4 : 0;

  const knowledge_alignment = clamp(tagScore + headingDiversityScore, 0, 15);

  const breakdown = {
    entity_presence:    clamp(entity_presence, 0, 30),
    references:         clamp(references, 0, 20),
    internal_graph:     clamp(internal_graph, 0, 20),
    semantic_richness:  clamp(semantic_richness, 0, 15),
    knowledge_alignment,
  };

  const score = clamp(Object.values(breakdown).reduce((s, v) => s + v, 0));
  return { score, breakdown };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function computeSearchScores(post: BlogPost): SearchScores {
  const parsed = parseBlocks(post.content_blocks, post.tags);

  const seo = computeSEOScore(post, parsed);
  const aeo = computeAEOScore(post, parsed);
  const geo = computeGEOScore(post, parsed);

  return {
    seo_score: seo.score,
    aeo_score: aeo.score,
    geo_score: geo.score,
    breakdown: {
      seo: seo.breakdown,
      aeo: aeo.breakdown,
      geo: geo.breakdown,
    },
  };
}
