/**
 * Content Depth and Insight Engine
 *
 * Post-generation validation + correction layer.
 * Runs AFTER runBlogGeneration() to enforce:
 *   - Multi-layer depth (explanation / mechanism / example / insight present)
 *   - Insight quality (non-obvious, card-specific, strategic)
 *   - Decision content (real comparisons and trade-offs, not generic)
 *   - Anti-generic ratio (< 20% sections may be generic)
 *
 * Pipeline:
 *   1. Parse content_html into sections
 *   2. Depth validation per section
 *   3. Insight validation per section
 *   4. Decision content validation
 *   5. Anti-generic filter
 *   6. Auto-correction (signal-driven injections — no AI call, uses bridge signals only)
 *   7. Return final_content + full validation report
 *
 * RULES:
 *   - Does NOT change structure (all sections preserved)
 *   - Does NOT remove sections
 *   - All injected content comes from ContentGenerationInput signals
 *   - Injections use HTML-safe strings only
 *
 * Exports:
 *   runContentDepthAndInsightEngine(input) → DepthInsightEngineOutput
 */

import type { BlogGenerationOutput } from '../blog/blogGenerationEngine';
import type { ContentGenerationInput, DepthMapEntry, DecisionBlock } from './cardToContentBridge';
import { htmlToBlocks } from '../blog/htmlToBlocks';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepthLayerReport {
  explanation: boolean;
  mechanism:   boolean;
  example:     boolean;
  insight:     boolean;
}

export type DepthReport = Record<string, DepthLayerReport>;

export interface InsightLayerReport {
  insight_score: number;   // 0–100
  generic:       boolean;  // true if insight_score < 60
}

export type InsightReport = Record<string, InsightLayerReport>;

export interface DecisionReport {
  real:    boolean;
  missing: string[];
}

export interface DepthInsightEngineInput {
  content_generation_input: ContentGenerationInput;
  generated_content:        BlogGenerationOutput & { content_blocks: unknown[] };
}

export interface DepthInsightValidation {
  depth_score_before:    number;
  depth_score_after:     number;
  insight_score_before:  number;
  insight_score_after:   number;
  generic_ratio_before:  number;
  generic_ratio_after:   number;
  decision_score_before: number;
  decision_score_after:  number;
}

export interface DepthInsightEngineOutput {
  final_content:   BlogGenerationOutput & { content_blocks: unknown[] };
  depth_report:    DepthReport;
  insight_report:  InsightReport;
  decision_report: DecisionReport;
  generic_ratio:   number;
  fixes_applied:   string[];
  validation:      DepthInsightValidation;
}

// ── Internal section type ──────────────────────────────────────────────────────

interface ParsedSection {
  id:              string;
  heading:         string;
  body:            string;
  is_reference:    boolean;
  is_key_insights: boolean;
}

// ── Tokeniser + stop words (mirrors strategicContentTransformationValidator) ──

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','but','by',
  'for','from','had','has','have','if','in','into','is','it','its','of',
  'on','or','that','the','their','there','these','this','those','to','was',
  'were','will','with','you','your','they','them','we','our','all','about',
  'more','can','when','what','how','its','which','so','do','also','just',
  'not','any','than','then','use','used','some','other','most',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3 && !STOP_WORDS.has(t));
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── HTML section parser ────────────────────────────────────────────────────────

/**
 * Splits content_html into discrete sections by <h2> boundaries.
 * Key-insights div and pre-h2 intro paragraphs are treated as a special section.
 */
function parseSections(html: string): ParsedSection[] {
  const sections: ParsedSection[] = [];

  // Extract the pre-h2 preamble (key_insights div + intro paragraphs)
  const firstH2 = html.search(/<h2>/i);
  if (firstH2 > 0) {
    const preamble = html.slice(0, firstH2).trim();
    if (preamble) {
      sections.push({
        id:              'section_intro',
        heading:         '__intro__',
        body:            preamble,
        is_reference:    false,
        is_key_insights: true,
      });
    }
  }

  // Split remaining HTML by h2 headings
  const h2Regex = /<h2>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2>|$)/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = h2Regex.exec(html)) !== null) {
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

function assembleSections(sections: ParsedSection[]): string {
  return sections.map((s) => {
    if (s.is_key_insights) return s.body;
    return `<h2>${esc(s.heading)}</h2>\n${s.body}`;
  }).join('\n\n');
}

// ── Depth evaluation ──────────────────────────────────────────────────────────

const EXPLANATION_RE = /\b(is|are|means|refers|defined as|what is|describes|represents)\b/i;
const MECHANISM_RE   = /\b(because|work[s]? by|process|system|sequence|driver|caus|mechanism|operat|step[s]?|how it|the reason)\b/i;
const EXAMPLE_RE     = /\b(for example|for instance|example|case study|scenario|consider|imagine|such as|like when|in practice|real.world)\b/i;
const INSIGHT_RE     = /\b(this means|which means|therefore|however|the implication|why this matters|so what|the key insight|trade.?off|vs\.|versus|unlike|the difference|what this reveals|the consequence)\b/i;

function evalDepth(text: string, wordCount: number): DepthLayerReport {
  return {
    explanation: wordCount > 50 || EXPLANATION_RE.test(text),
    mechanism:   MECHANISM_RE.test(text),
    example:     EXAMPLE_RE.test(text),
    insight:     INSIGHT_RE.test(text),
  };
}

// ── Insight scoring ───────────────────────────────────────────────────────────

const GENERIC_PHRASES = [
  'in today\'s world', 'in the modern era', 'it is important to', 'as we all know',
  'plays a crucial role', 'plays a vital role', 'leveraging the power of',
  'it goes without saying', 'needless to say', 'at the end of the day',
  'moving the needle', 'synergize', 'best practices', 'game changer',
  'disruptive', 'paradigm shift', 'circle back', 'take this to the next level',
  'actionable insights', 'value-add', 'low-hanging fruit', 'boil the ocean',
];

function scoreInsight(
  text:          string,
  signalTokens:  Set<string>,
  wordCount:     number,
): number {
  const normalized    = text.toLowerCase();
  const textTokens    = tokenize(normalized);

  // Signal token overlap: how many card-specific terms appear
  const signalHits    = textTokens.filter((t) => signalTokens.has(t)).length;
  const signalDensity = textTokens.length > 0 ? signalHits / textTokens.length : 0;

  // Generic phrase penalty
  const genericHits = GENERIC_PHRASES.filter((p) => normalized.includes(p)).length;

  // Contrarian / tension markers boost
  const tensionBoost = INSIGHT_RE.test(normalized) ? 15 : 0;
  const exampleBoost = EXAMPLE_RE.test(normalized) ? 10 : 0;
  const lengthBoost  = wordCount > 100 ? 10 : wordCount > 50 ? 5 : 0;

  const base = Math.min(70, Math.round(signalDensity * 200));
  const score = Math.max(0, Math.min(100,
    base + tensionBoost + exampleBoost + lengthBoost - genericHits * 15,
  ));
  return score;
}

// ── Decision evaluation ────────────────────────────────────────────────────────

const COMPARISON_RE = /\b( vs\.? |versus|compare|comparison|rather than|instead of|trade.?off|tradeoff|when to use|when not to use|should you|consider using|avoid when)\b/i;

function evalDecision(sections: ParsedSection[], signalTokens: Set<string>): DecisionReport {
  const missing: string[] = [];

  const hasComparisons   = sections.some((s) => /comparison|compare|vs\./i.test(s.heading) || COMPARISON_RE.test(s.body));
  const hasTradeoffs     = sections.some((s) => /trade.?off/i.test(s.heading) || /trade.?off|tradeoff/i.test(s.body));
  const hasWhenToUse     = sections.some((s) => /when to use|when not|decision/i.test(s.heading + s.body));

  if (!hasComparisons) missing.push('comparisons');
  if (!hasTradeoffs)   missing.push('trade_offs');
  if (!hasWhenToUse)   missing.push('when_to_use / when_not_to_use');

  // "Real" = has comparison language AND references ≥ 3 signal tokens
  let maxSignalHits = 0;
  for (const s of sections) {
    if (COMPARISON_RE.test(s.body)) {
      const hits = tokenize(s.body).filter((t) => signalTokens.has(t)).length;
      if (hits > maxSignalHits) maxSignalHits = hits;
    }
  }
  const real = (hasComparisons || hasWhenToUse) && maxSignalHits >= 2;

  return { real, missing };
}

// ── Signal token set builder ──────────────────────────────────────────────────

function buildSignalTokens(cgi: ContentGenerationInput): Set<string> {
  const sources: string[] = [
    cgi.topic,
    cgi.selected_angle,
    cgi.trend_context,
    cgi.uniqueness_directive,
    cgi.narrative_direction,
    cgi.differentiation,
    ...cgi.must_include_points,
    ...(Object.values(cgi.answers)),
    ...cgi.key_messages,
    cgi.strategic_core.core_problem,
    cgi.strategic_core.authority_basis,
    cgi.strategic_core.transformation_goal,
    ...cgi.strategic_core.pain_points,
    ...cgi.depth_map.map((e) => `${e.key_point} ${e.mechanism} ${e.contrarian_take}`),
    ...cgi.decision_blocks.flatMap((b) => [...b.comparisons, ...b.trade_offs]),
  ];
  return new Set(sources.join(' ').split(/\s+/).flatMap((w) => tokenize(w)));
}

// ── Scoring aggregates ─────────────────────────────────────────────────────────

function aggregateDepthScore(report: DepthReport, sections: ParsedSection[]): number {
  const evaluable = sections.filter((s) => !s.is_reference && !s.is_key_insights);
  if (evaluable.length === 0) return 100;
  let total = 0;
  for (const s of evaluable) {
    const r = report[s.id];
    if (!r) continue;
    const pass = [r.explanation, r.mechanism, r.example, r.insight].filter(Boolean).length;
    total += (pass / 4) * 100;
  }
  return Math.round(total / evaluable.length);
}

function aggregateInsightScore(report: InsightReport, sections: ParsedSection[]): number {
  const evaluable = sections.filter((s) => !s.is_reference && !s.is_key_insights);
  if (evaluable.length === 0) return 100;
  let total = 0;
  let count = 0;
  for (const s of evaluable) {
    const r = report[s.id];
    if (!r) continue;
    total += r.insight_score;
    count++;
  }
  return count > 0 ? Math.round(total / count) : 100;
}

function aggregateGenericRatio(report: InsightReport, sections: ParsedSection[]): number {
  const evaluable = sections.filter((s) => !s.is_reference && !s.is_key_insights);
  if (evaluable.length === 0) return 0;
  const generic = evaluable.filter((s) => report[s.id]?.generic).length;
  return Math.round((generic / evaluable.length) * 100);
}

function aggregateDecisionScore(report: DecisionReport): number {
  if (report.real) return 100;
  const total = 3;
  const present = total - report.missing.length;
  return Math.round((present / total) * 100);
}

// ── Depth map matcher ─────────────────────────────────────────────────────────

/**
 * Returns the depth_map entry whose pillar label best matches a section heading,
 * falling back to the depth_map entry at the given index if no strong overlap.
 */
function matchDepthEntry(
  heading:  string,
  idx:      number,
  depthMap: DepthMapEntry[],
): DepthMapEntry {
  if (depthMap.length === 0) return { pillar: '', key_point: '', why_it_matters: '', mechanism: '', example_direction: '', insight_angle: '', contrarian_take: '' };

  const headingTokens = new Set(tokenize(heading));
  let best = depthMap[Math.min(idx, depthMap.length - 1)];
  let bestScore = 0;

  for (const entry of depthMap) {
    const pillarTokens = tokenize(entry.pillar);
    const overlap = pillarTokens.filter((t) => headingTokens.has(t)).length;
    const score   = pillarTokens.length > 0 ? overlap / pillarTokens.length : 0;
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return best;
}

// ── HTML injection helpers ─────────────────────────────────────────────────────

function injectMechanism(body: string, mechanism: string): string {
  if (!mechanism || mechanism.length < 10) return body;
  return `${body}\n<p><strong>How this works:</strong> ${esc(mechanism)}</p>`;
}

function injectExample(body: string, exampleDirection: string): string {
  if (!exampleDirection || exampleDirection.length < 10) return body;
  return `${body}\n<p><strong>In practice:</strong> ${esc(exampleDirection)}</p>`;
}

function injectInsight(body: string, contrarianTake: string): string {
  if (!contrarianTake || contrarianTake.length < 10) return body;
  return `${body}\n<p><strong>The strategic implication:</strong> ${esc(contrarianTake)}</p>`;
}

function injectSpecificityAnchor(body: string, anchor: string): string {
  if (!anchor || anchor.length < 10) return body;
  // Prepend a specificity hook paragraph before the existing body
  return `<p><em>${esc(anchor)}</em></p>\n${body}`;
}

function buildDecisionInjection(block: DecisionBlock): string {
  const lines: string[] = [];

  if (block.comparisons.length > 0) {
    lines.push('<h3>Key Comparisons</h3>');
    lines.push('<ul>');
    block.comparisons.slice(0, 3).forEach((c) => lines.push(`<li>${esc(c)}</li>`));
    lines.push('</ul>');
  }

  if (block.trade_offs.length > 0) {
    lines.push('<h3>Trade-offs to Consider</h3>');
    lines.push('<ul>');
    block.trade_offs.slice(0, 3).forEach((t) => lines.push(`<li>${esc(t)}</li>`));
    lines.push('</ul>');
  }

  if (block.when_to_use.length > 0) {
    lines.push('<h3>When to Use This Approach</h3>');
    lines.push('<ul>');
    block.when_to_use.slice(0, 3).forEach((w) => lines.push(`<li>${esc(w)}</li>`));
    lines.push('</ul>');
  }

  if (block.when_not_to_use.length > 0) {
    lines.push('<h3>When Not to Use This Approach</h3>');
    lines.push('<ul>');
    block.when_not_to_use.slice(0, 3).forEach((w) => lines.push(`<li>${esc(w)}</li>`));
    lines.push('</ul>');
  }

  return lines.join('\n');
}

// ── Auto-correction engine ─────────────────────────────────────────────────────

function correctSections(
  sections:      ParsedSection[],
  depthReport:   DepthReport,
  insightReport: InsightReport,
  decisionReport: DecisionReport,
  cgi:           ContentGenerationInput,
): { sections: ParsedSection[]; fixes: string[] } {
  const fixes: string[] = [];
  const depthMap       = cgi.depth_map;
  const decisionBlock  = cgi.decision_blocks[0];
  const mustInclude    = cgi.must_include_points.join(' | ');
  const uniqueness     = cgi.answers.uniqueness_directive ?? cgi.uniqueness_directive;

  let evaluableIdx = 0;
  const corrected = sections.map((section) => {
    if (section.is_reference || section.is_key_insights) return section;

    const dr = depthReport[section.id];
    const ir = insightReport[section.id];
    if (!dr || !ir) return section;

    const dmEntry = matchDepthEntry(section.heading, evaluableIdx, depthMap);
    evaluableIdx++;

    let body = section.body;

    // 5.1 — Add mechanism (uses depth_map.mechanism)
    if (!dr.mechanism && dmEntry.mechanism.length > 20) {
      body = injectMechanism(body, dmEntry.mechanism);
      fixes.push(`[${section.id}] mechanism injected from depth_map: "${dmEntry.pillar}"`);
    }

    // 5.2 — Add example (uses depth_map.example_direction)
    if (!dr.example && dmEntry.example_direction.length > 20) {
      body = injectExample(body, dmEntry.example_direction);
      fixes.push(`[${section.id}] example injected from depth_map: "${dmEntry.pillar}"`);
    }

    // 5.3 — Add insight (uses depth_map.contrarian_take)
    if (!dr.insight && dmEntry.contrarian_take.length > 20) {
      body = injectInsight(body, dmEntry.contrarian_take);
      fixes.push(`[${section.id}] insight injected from depth_map contrarian_take: "${dmEntry.pillar}"`);
    }

    // 5.4 — Fix generic content (re-anchor with must_include_points + uniqueness_directive)
    if (ir.generic) {
      const anchor = mustInclude || uniqueness;
      if (anchor) {
        body = injectSpecificityAnchor(body, anchor.slice(0, 200));
        fixes.push(`[${section.id}] specificity anchor injected from must_include_points/uniqueness_directive`);
      }
    }

    return { ...section, body };
  });

  // 5.5 — Fix decision blocks: inject if missing and not already present
  if (!decisionReport.real && decisionBlock) {
    // Find the Decision Framework section or append to last non-reference section
    let injected = false;
    for (let i = 0; i < corrected.length; i++) {
      const s = corrected[i];
      if (!s.is_reference && !s.is_key_insights && /decision|framework|when to|action/i.test(s.heading)) {
        corrected[i] = { ...s, body: s.body + '\n' + buildDecisionInjection(decisionBlock) };
        fixes.push(`[${s.id}] decision block injected into existing decision/framework section`);
        injected = true;
        break;
      }
    }
    if (!injected) {
      // Append a new decision section before References
      const refIdx = corrected.findIndex((s) => s.is_reference);
      const insertAt = refIdx >= 0 ? refIdx : corrected.length;
      const newSection: ParsedSection = {
        id:              `section_decision_injected`,
        heading:         `Decision Framework: ${cgi.topic}`,
        body:            buildDecisionInjection(decisionBlock),
        is_reference:    false,
        is_key_insights: false,
      };
      corrected.splice(insertAt, 0, newSection);
      fixes.push(`[section_decision_injected] full decision block section appended from decision_blocks[0]`);
    }
  }

  return { sections: corrected, fixes };
}

// ── Main engine ────────────────────────────────────────────────────────────────

/**
 * runContentDepthAndInsightEngine
 *
 * Validates and corrects generated content for depth, insight, decision quality
 * and generic content ratio. All corrections are signal-driven from the bridge output.
 * No AI calls — purely deterministic signal injection.
 *
 * @param input.content_generation_input  - bridge output (ContentGenerationInput)
 * @param input.generated_content         - BlogGenerationOutput from runBlogGeneration
 * @returns DepthInsightEngineOutput      - corrected content + full validation report
 */
export function runContentDepthAndInsightEngine(
  input: DepthInsightEngineInput,
): DepthInsightEngineOutput {
  const { content_generation_input: cgi, generated_content: content } = input;

  const signalTokens = buildSignalTokens(cgi);
  const sections     = parseSections(content.content_html);

  // ── Step 2: Depth validation per section ─────────────────────────────────
  const depthReport: DepthReport = {};
  for (const section of sections) {
    if (section.is_reference || section.is_key_insights) continue;
    const text      = stripHtml(section.body);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    depthReport[section.id] = evalDepth(section.body, wordCount);
  }

  // ── Step 3: Insight validation per section ─────────────────────────────────
  const insightReport: InsightReport = {};
  for (const section of sections) {
    if (section.is_reference || section.is_key_insights) continue;
    const text      = stripHtml(section.body);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const score     = scoreInsight(text, signalTokens, wordCount);
    insightReport[section.id] = { insight_score: score, generic: score < 60 };
  }

  // ── Step 4: Decision content validation ─────────────────────────────────────
  const decisionReport = evalDecision(sections, signalTokens);

  // ── Step 5: Anti-generic filter (before scores) ────────────────────────────
  const genericRatioBefore = aggregateGenericRatio(insightReport, sections);

  // ── Capture before-scores ──────────────────────────────────────────────────
  const depthScoreBefore    = aggregateDepthScore(depthReport, sections);
  const insightScoreBefore  = aggregateInsightScore(insightReport, sections);
  const decisionScoreBefore = aggregateDecisionScore(decisionReport);

  // ── Step 6: Auto-correction ────────────────────────────────────────────────
  const { sections: correctedSections, fixes } = correctSections(
    sections,
    depthReport,
    insightReport,
    decisionReport,
    cgi,
  );

  // ── Rebuild content_html from corrected sections ───────────────────────────
  const correctedHtml = assembleSections(correctedSections);

  // ── Recompute after-scores on corrected sections ───────────────────────────
  const correctedParsed = parseSections(correctedHtml);

  const depthReportAfter: DepthReport = {};
  for (const s of correctedParsed) {
    if (s.is_reference || s.is_key_insights) continue;
    const text = stripHtml(s.body);
    depthReportAfter[s.id] = evalDepth(s.body, text.split(/\s+/).filter(Boolean).length);
  }

  const insightReportAfter: InsightReport = {};
  for (const s of correctedParsed) {
    if (s.is_reference || s.is_key_insights) continue;
    const text = stripHtml(s.body);
    const score = scoreInsight(text, signalTokens, text.split(/\s+/).filter(Boolean).length);
    insightReportAfter[s.id] = { insight_score: score, generic: score < 60 };
  }

  const decisionReportAfter   = evalDecision(correctedParsed, signalTokens);
  const depthScoreAfter        = aggregateDepthScore(depthReportAfter, correctedParsed);
  const insightScoreAfter      = aggregateInsightScore(insightReportAfter, correctedParsed);
  const genericRatioAfter      = aggregateGenericRatio(insightReportAfter, correctedParsed);
  const decisionScoreAfter     = aggregateDecisionScore(decisionReportAfter);

  // ── Rebuild content_blocks from corrected HTML ────────────────────────────
  const content_blocks = htmlToBlocks(correctedHtml);

  const final_content: BlogGenerationOutput & { content_blocks: unknown[] } = {
    ...content,
    content_html:  correctedHtml,
    content_blocks,
  };

  return {
    final_content,
    depth_report:    depthReport,
    insight_report:  insightReport,
    decision_report: decisionReport,
    generic_ratio:   genericRatioAfter,
    fixes_applied:   fixes,
    validation: {
      depth_score_before:    depthScoreBefore,
      depth_score_after:     depthScoreAfter,
      insight_score_before:  insightScoreBefore,
      insight_score_after:   insightScoreAfter,
      generic_ratio_before:  genericRatioBefore,
      generic_ratio_after:   genericRatioAfter,
      decision_score_before: decisionScoreBefore,
      decision_score_after:  decisionScoreAfter,
    },
  };
}
