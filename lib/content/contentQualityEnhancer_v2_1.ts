/**
 * Content Quality Enhancer v2.3
 *
 * Runs AFTER contentDepthAndInsightEngine (v2).
 *
 * v2.1 fixes (retained):
 *   A) Template injection detection — skips bridge placeholder strings.
 *   B) Signal poverty detection.
 *   C) Anti-bloat word budget.
 *
 * v2.2 upgrades (retained):
 *   1. MAX_SECTION_WORDS = 350 ceiling.
 *   2. Synthetic signal derivation for signal-poor cards.
 *   3. Multi-layer injection (mechanism → example → insight → decision).
 *   4. Decision-depth link per section.
 *   5. Shallow = no mechanism OR no decision implication.
 *
 * v2.3 upgrades:
 *   1. Real Mechanism Enforcement: generated mechanism MUST contain Step / works by /
 *      because — causal structure required, no abstract assertions.
 *   2. Completeness overrides redundancy: insight and example are NEVER skipped
 *      due to wouldBeRedundant() when those layers are confirmed missing.
 *   3. Real Decision Language: injected decision text MUST include
 *      "Use this when", "Avoid this when", "Choose this if" — fully actionable.
 *   4. Synthetic Signal Upgrade: deriveSyntheticSignals() returns a structured
 *      {actor, constraint, failure_mode, desired_outcome} object used by all
 *      three generators (mechanism, example, decision).
 *   5. Insight Guarantee: every evaluable section ends with a Key Insight line
 *      even if the body already contains insight-adjacent language.
 *
 * NEW in v2.1 (retained):
 *   Step 2 — Internal Linking Engine (contextual, token-matched, no duplicates)
 *   Step 3 — GEO Optimization (answer blocks, entity clarity, structured insight lines)
 *
 * Pipeline:
 *   1. Depth hard enforcement (template-aware, 350-word ceiling, synthetic fallback)
 *   2. Internal linking (catalog-matched, ≤2 per section, no duplicates)
 *   3. GEO optimization (answer blocks + entity clarity + insight markers)
 *   4. Anti-shallow filter (upgraded v2.2 — reports still-failing sections)
 *   5. Reassemble + validation report
 *
 * Exports:
 *   runContentQualityEnhancer(input) → QualityEnhancerOutput
 */

import type { BlogGenerationOutput } from '../blog/blogGenerationEngine';
import type { ContentGenerationInput, DepthMapEntry } from './cardToContentBridge';
import { htmlToBlocks } from '../blog/htmlToBlocks';

// ── Stop-words (shared pattern with v2 engine) ────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','but','by',
  'for','from','had','has','have','if','in','into','is','it','its','of',
  'on','or','that','the','their','there','these','this','those','to','was',
  'were','will','with','you','your','they','them','we','our','all','about',
  'more','can','when','what','how','its','which','so','do','also','just',
  'not','any','than','then','use','used','some','other','most',
]);

// ── Template string patterns ──────────────────────────────────────────────────
// These are the bridge placeholders that should never reach injected content.

const TEMPLATE_PATTERNS: RegExp[] = [
  /^Detailed explanation of HOW .+ works in practice\.?$/i,
  /^Concrete .+-specific example\.?$/i,
  /^Challenge the most common assumption about .+\.?$/i,
  /^Evidence from .+ execution patterns\.?$/i,
  /^\[.*\]$/,                                  // bare [placeholder]
];

// ── Depth regex (mirrors v2 engine) ──────────────────────────────────────────

const MECHANISM_RE = /\b(because|work[s]? by|process|system|sequence|driver|caus|mechanism|operat|step[s]?|how it|the reason)\b/i;
const EXAMPLE_RE   = /\b(for example|for instance|example|case study|scenario|consider|imagine|such as|like when|in practice|real.world)\b/i;
const INSIGHT_RE   = /\b(this means|which means|therefore|however|the implication|why this matters|so what|the key insight|trade.?off|vs\.|versus|unlike|the difference|what this reveals|the consequence)\b/i;

// ── GEO markers ───────────────────────────────────────────────────────────────

const GEO_ANSWER_BLOCK_RE  = /class="geo-answer"/i;
const GEO_KEY_INSIGHT_RE   = /<strong>Key Insight:<\/strong>/i;
const GEO_WHY_MATTERS_RE   = /<strong>Why this matters:<\/strong>/i;
const GEO_ENTITY_RE        = /<dfn/i;

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

interface ParsedSection {
  id:              string;
  heading:         string;
  body:            string;
  is_reference:    boolean;
  is_key_insights: boolean;
}

interface DepthState {
  explanation: boolean;
  mechanism:   boolean;
  example:     boolean;
  insight:     boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3 && !STOP_WORDS.has(t));
}

function wordCount(html: string): number {
  return stripHtml(html).split(/\s+/).filter(Boolean).length;
}

function isTemplate(value: string): boolean {
  if (!value || value.length < 5) return true;
  return TEMPLATE_PATTERNS.some((re) => re.test(value.trim()));
}

// ── Section parser (same logic as v2 engine) ──────────────────────────────────

function parseSections(html: string): ParsedSection[] {
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

function assembleSections(sections: ParsedSection[]): string {
  return sections.map((s) => {
    if (s.is_key_insights) return s.body;
    return `<h2>${esc(s.heading)}</h2>\n${s.body}`;
  }).join('\n\n');
}

// ── Depth evaluator ───────────────────────────────────────────────────────────

function evalDepthState(body: string, wc: number): DepthState {
  return {
    explanation: wc > 50 || /\b(is|are|means|refers|defined as|describes|represents)\b/i.test(body),
    mechanism:   MECHANISM_RE.test(body),
    example:     EXAMPLE_RE.test(body),
    insight:     INSIGHT_RE.test(body),
  };
}

function depthScore(state: DepthState): number {
  return ([state.explanation, state.mechanism, state.example, state.insight].filter(Boolean).length / 4) * 100;
}

function aggregateDepthScoreFromSections(sections: ParsedSection[]): number {
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

function matchDepthEntry(heading: string, idx: number, depthMap: DepthMapEntry[]): DepthMapEntry {
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
const MAX_SECTION_WORDS = 350;
/** v2.5: depth layers (mechanism + example + insight) budget per section. */
const MAX_DEPTH_WORDS = 120;
/** v2.5: decision injection has its own budget, never blocking depth layers. */
const MAX_DECISION_WORDS = 80;
/** v2.5: hard total injection cap per section (anti-overcorrection). */
const MAX_TOTAL_INJECTION = 150;
/** Signal token count below which synthetic derivation activates. */
const SIGNAL_POVERTY_THRESHOLD = 5;

// ── v2.3: Structured synthetic signals ───────────────────────────────────────

interface SyntheticSignals {
  actor:           string;   // who is acting (audience / practitioner type)
  constraint:      string;   // the core limiting condition
  failure_mode:    string;   // what goes wrong without this
  desired_outcome: string;   // what success looks like
}

/**
 * v2.3: Derive structured synthetic signals for signal-poor cards.
 * Returns an object with actor/constraint/failure_mode/desired_outcome
 * used by the three structured generators below.
 */
function deriveSyntheticSignals(cgi: ContentGenerationInput): SyntheticSignals {
  const audienceWords = cgi.audience
    ? cgi.audience.split(/[,\s]+/).filter((w) => w.length > 3).slice(0, 2).join(' ')
    : '';
  const actor = audienceWords || `${cgi.topic} practitioners`;

  const constraint =
    cgi.selected_angle.split(/[.!?]/)[0].trim() ||
    cgi.strategic_core.core_problem.split(/[.!?]/)[0].trim() ||
    `the complexity of ${cgi.topic}`;

  const failure_mode =
    cgi.strategic_core.core_problem.split(/[.!?]/)[0].trim() ||
    `failing to apply ${cgi.topic} effectively`;

  const desired_outcome =
    cgi.strategic_core.transformation_goal ||
    cgi.key_messages[0] ||
    `improved results through systematic ${cgi.topic.toLowerCase()}`;

  return { actor, constraint, failure_mode, desired_outcome };
}

/**
 * v2.3: Generate a mechanism with causal step structure.
 * MUST include "Step" or "works by" or "because" — no abstract assertions.
 */
function generateMechanism(
  heading:  string,
  dmMech:   string,
  signals:  SyntheticSignals,
): string {
  if (!isTemplate(dmMech) && dmMech.length > 20) return dmMech;

  const topic = heading || 'this approach';
  return [
    `Step 1: ${signals.actor} identify where ${signals.constraint.toLowerCase()}.`,
    `Step 2: Apply the ${topic.toLowerCase()} process by resolving the core blocker in sequence rather than all at once.`,
    `Step 3: Measure the outcome against ${signals.desired_outcome.toLowerCase()}.`,
    `Because ${signals.failure_mode.toLowerCase()}, each step must complete before the next begins — skipping steps reintroduces the original failure mode.`,
  ].join(' ');
}

/**
 * v2.3: Generate a specific example with actor, context, and outcome.
 */
function generateExample(
  heading:  string,
  dmEx:     string,
  signals:  SyntheticSignals,
): string {
  if (!isTemplate(dmEx) && dmEx.length > 20) return dmEx;

  const topic = heading || 'this';
  return (
    `For example, a ${signals.actor} team facing ${signals.constraint.toLowerCase()} ` +
    `applied ${topic.toLowerCase()} systematically and achieved ${signals.desired_outcome.toLowerCase()}. ` +
    `In practice, the key difference was sequencing the work so each stage produced a measurable result ` +
    `before the next was started — which resulted in faster adoption and reduced rework.`
  );
}

/**
 * v2.3: Generate actionable decision language.
 * MUST include "Use this when", "Avoid this when", "Choose this if".
 */
function generateDecision(
  heading:  string,
  dmWhy:    string,
  signals:  SyntheticSignals,
): string {
  const context = !isTemplate(dmWhy) && dmWhy.length > 20
    ? dmWhy
    : signals.desired_outcome;

  const topic = heading || 'this approach';
  return (
    `Use this when ${signals.actor.toLowerCase()} need to address ${signals.constraint.toLowerCase()} ` +
    `and ${context.toLowerCase()}. ` +
    `Avoid this when the problem is not yet clearly defined or when ${signals.failure_mode.toLowerCase()} ` +
    `is caused by external factors outside your team's control. ` +
    `Choose this if you need a repeatable, step-based system for ${topic.toLowerCase()} ` +
    `that surfaces measurable progress at each stage.`
  );
}

/** Returns true if injecting `text` into `body` would create detectable redundancy. */
function wouldBeRedundant(body: string, text: string): boolean {
  if (!text || text.length < 10) return true;
  // Sample the first 8 tokens of the candidate injection
  const injTokens = tokenize(text).slice(0, 8);
  if (injTokens.length === 0) return true;
  const bodyText  = stripHtml(body).toLowerCase();
  // If ≥ 5 of the 8 leading tokens already appear in the body, skip
  const hits = injTokens.filter((t) => bodyText.includes(t)).length;
  return hits >= 5;
}

interface EnforceDepthResult {
  sections:     ParsedSection[];
  fixes:        string[];
  rewritten:    string[];
  shallowFixed: number;
  overcorrectionDetected: boolean;
}

function enforceDepth(
  sections: ParsedSection[],
  cgi:      ContentGenerationInput,
): EnforceDepthResult {
  const fixes: string[]     = [];
  const rewritten: string[] = [];
  let shallowFixed          = 0;
  let overcorrectionDetected = false;

  // ── Signal preparation ─────────────────────────────────────────────────────
  const primarySignalText = [
    cgi.topic, cgi.selected_angle, cgi.trend_context, cgi.uniqueness_directive,
    ...cgi.must_include_points,
    ...Object.values(cgi.answers),
    ...cgi.key_messages,
  ].filter(Boolean).join(' ');
  const signalTokenCount = tokenize(primarySignalText).length;

  // v2.3: always derive structured synth signals; used when signal-poor
  if (signalTokenCount < SIGNAL_POVERTY_THRESHOLD) {
    fixes.push(`signal-poverty → synthetic signals derived from topic/angle/trend (primaryTokens=${signalTokenCount})`);
  }

  let evaluableIdx = 0;

  const updated = sections.map((section) => {
    if (section.is_reference || section.is_key_insights) return section;

    const wcBefore = wordCount(section.body);
    const ds        = evalDepthState(section.body, wcBefore);

    // Stop injection (but not insight guarantee) when over ceiling
    const overCeiling = wcBefore >= MAX_SECTION_WORDS;

    const dmEntry = matchDepthEntry(section.heading, evaluableIdx, cgi.depth_map);
    evaluableIdx++;

    let body                  = section.body;
    let depthWordsInjected    = 0;   // mechanism + example + insight
    let decisionWordsInjected = 0;   // decision only (v2.5 independent budget)
    let changed               = false;

    if (!overCeiling) {
      // ── v2.3: structured signal object (real or synthetic) ────────────────
      const synth: SyntheticSignals = signalTokenCount < SIGNAL_POVERTY_THRESHOLD
        ? deriveSyntheticSignals(cgi)
        : {
            actor:           cgi.audience || `${cgi.topic} practitioners`,
            constraint:      cgi.selected_angle.split(/[.!?]/)[0].trim(),
            failure_mode:    cgi.strategic_core.core_problem.split(/[.!?]/)[0].trim(),
            desired_outcome: cgi.strategic_core.transformation_goal || cgi.key_messages[0] || cgi.topic,
          };

      // v2.3 fix 1: Real mechanism — step/causal structure guaranteed
      const mechanismText = generateMechanism(section.heading, dmEntry.mechanism, synth);
      // v2.3 fix 4: Real example — actor + context + outcome
      const exampleText   = generateExample(section.heading, dmEntry.example_direction, synth);
      // Insight: depth_map contrarian_take if real; else signal-derived
      const insightText   = !isTemplate(dmEntry.contrarian_take) && dmEntry.contrarian_take.length > 20
        ? dmEntry.contrarian_take
        : `The key insight: ${synth.desired_outcome}. ` +
          `However, ${synth.failure_mode.toLowerCase()} — which means the teams that succeed address ` +
          `${synth.constraint.toLowerCase()} before scaling effort.`;
      // v2.3 fix 3: Real decision language — use/avoid/choose
      const decisionText  = generateDecision(section.heading, dmEntry.why_it_matters, synth);

      // ── v2.5 fix 1+2: split budget — depth vs decision, total cap reserves decision slot ──
      const decisionWords         = tokenize(decisionText).length;
      const decisionWillFire      = decisionWords <= MAX_DECISION_WORDS;
      const effectiveDepthBudget  = decisionWillFire
        ? Math.min(MAX_DEPTH_WORDS, MAX_TOTAL_INJECTION - decisionWords)
        : MAX_DEPTH_WORDS;

      // ── v2.3 fix 2: completeness overrides redundancy for insight + example ─
      const tryInject = (
        missing:            boolean,
        rawValue:           string,
        label:              string,
        prefix:             string,
        overrideRedundancy: boolean = false,
      ): void => {
        if (!missing) return;
        if (isTemplate(rawValue)) { fixes.push(`[${section.id}] ${label}: template — skipped`); return; }
        if (!overrideRedundancy && wouldBeRedundant(body, rawValue)) {
          fixes.push(`[${section.id}] ${label}: redundant — skipped`);
          return;
        }
        const candidateWords = tokenize(rawValue).length;
        if (depthWordsInjected + candidateWords > effectiveDepthBudget) {
          fixes.push(`[${section.id}] ${label}: depth budget exhausted (${depthWordsInjected}+${candidateWords}>${effectiveDepthBudget}) — skipped`);
          return;
        }
        body                = `${body}\n<p><strong>${prefix}</strong> ${esc(rawValue)}</p>`;
        depthWordsInjected += candidateWords;
        fixes.push(`[${section.id}] ${label} injected`);
        changed = true;
      };

      tryInject(!ds.mechanism, mechanismText, 'mechanism', 'How this works:',          true);
      tryInject(!ds.example,   exampleText,   'example',   'In practice:',             true);
      tryInject(!ds.insight,   insightText,   'insight',   'The strategic implication:', true);

      // v2.5: decision injection — fire only when section lacks BOTH full Use/Avoid/Choose
      // structure AND any legacy actionable language (when to use, should you, etc.).
      const hasFullDecisionStructure =
        body.includes('Use this when') &&
        body.includes('Avoid this when') &&
        body.includes('Choose this if');
      const hasLegacyActionable = /\b(when to use|should you|if you (?:are|have|need)|before choosing|apply this when|use this when)\b/i.test(stripHtml(body));
      if (!hasFullDecisionStructure && !hasLegacyActionable) {
        if (decisionWordsInjected + decisionWords <= MAX_DECISION_WORDS) {
          body = `${body}\n<p><strong>What this means for decision-making:</strong> ${esc(decisionText)}</p>`;
          decisionWordsInjected += decisionWords;
          fixes.push(`[${section.id}] decision-depth link injected`);
          changed = true;
        }
      }
    }

    // ── v2.3 fix 5: Insight guarantee — applies even when over ceiling ──────
    // v2.5: also match plain-text versions (no <strong> tag) so sections with existing
    // strategic implication / key insight prose don't get redundant injection.
    const KEY_INSIGHT_PRESENT        = /<strong>Key Insight:<\/strong>|key insight:/i;
    const STRATEGIC_IMPL_PRESENT     = /<strong>The strategic implication:<\/strong>|the strategic implication:/i;
    if (!KEY_INSIGHT_PRESENT.test(body) && !STRATEGIC_IMPL_PRESENT.test(body)) {
      const insightGuarantee = !isTemplate(dmEntry.insight_angle) && dmEntry.insight_angle.length > 20
        ? dmEntry.insight_angle
        : !isTemplate(dmEntry.contrarian_take) && dmEntry.contrarian_take.length > 20
          ? dmEntry.contrarian_take
          : `Teams that apply this systematically outperform those that treat it as a one-time task — ` +
            `which means treating ${section.heading.toLowerCase()} as an ongoing process is the ` +
            `highest-leverage change you can make.`;
      body    = `${body}\n<p><strong>Key Insight:</strong> ${esc(insightGuarantee)}</p>`;
      fixes.push(`[${section.id}] insight guarantee appended`);
      changed = true;
    }

    // Anti-bloat check — v2.5: ceiling-based, not delta-based.
    // Delta-based checks false-positively flag stub sections that legitimately grow a lot.
    const wcAfter = wordCount(body);
    if (wcAfter > MAX_SECTION_WORDS) {
      overcorrectionDetected = true;
      fixes.push(`[${section.id}] WARN: section is ${wcAfter} words — exceeds section ceiling`);
    }

    if (changed) {
      shallowFixed++;
      rewritten.push(`[${section.id}] "${section.heading}"`);
    }

    return { ...section, body };
  });

  return { sections: updated, fixes, rewritten, shallowFixed, overcorrectionDetected };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — INTERNAL LINKING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const MIN_TOKEN_OVERLAP = 3;  // minimum shared tokens to qualify a link
const MAX_LINKS_PER_SECTION = 2;

function buildCatalogTokenSets(
  catalog: BlogCatalogEntry[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const entry of catalog) {
    const text   = [entry.title, entry.excerpt, ...entry.tags, entry.category || ''].join(' ');
    const tokens = new Set(tokenize(text));
    map.set(entry.slug, tokens);
  }
  return map;
}

function findLinksForSection(
  section:      ParsedSection,
  catalog:      BlogCatalogEntry[],
  catalogIndex: Map<string, Set<string>>,
  usedSlugs:    Set<string>,
): InternalLink[] {
  const bodyText   = stripHtml(section.body + ' ' + section.heading);
  const bodyTokens = new Set(tokenize(bodyText));

  type Candidate = { entry: BlogCatalogEntry; overlap: number };
  const candidates: Candidate[] = [];

  for (const entry of catalog) {
    if (usedSlugs.has(entry.slug)) continue;

    const catalogTokens = catalogIndex.get(entry.slug);
    if (!catalogTokens) continue;

    const overlap = [...catalogTokens].filter((t) => bodyTokens.has(t)).length;
    if (overlap >= MIN_TOKEN_OVERLAP) {
      candidates.push({ entry, overlap });
    }
  }

  // Sort descending by overlap, take top N
  candidates.sort((a, b) => b.overlap - a.overlap);
  const selected = candidates.slice(0, MAX_LINKS_PER_SECTION);

  return selected.map(({ entry, overlap }) => ({
    section_id:  section.id,
    anchor_text: entry.title.length > 60 ? entry.title.slice(0, 57) + '...' : entry.title,
    target_slug: `/blog/${entry.slug}`,
    context:     `${overlap} shared content tokens with section "${section.heading}" — category: ${entry.category || 'uncategorised'}`,
  }));
}

function injectLinksIntoSection(section: ParsedSection, links: InternalLink[]): string {
  if (links.length === 0) return section.body;

  const linkHtml = links
    .map((l) => `<a href="${l.target_slug}">${esc(l.anchor_text)}</a>`)
    .join(', ');

  // Append a "See also" line at the end of the section body (before any h3s if present)
  return `${section.body}\n<p class="internal-links"><em>Related reading: ${linkHtml}</em></p>`;
}

function runInternalLinking(
  sections: ParsedSection[],
  catalog:  BlogCatalogEntry[],
): { sections: ParsedSection[]; links: InternalLink[] } {
  if (catalog.length === 0) return { sections, links: [] };

  const catalogIndex = buildCatalogTokenSets(catalog);
  const usedSlugs    = new Set<string>();
  const allLinks: InternalLink[] = [];

  const updated = sections.map((section) => {
    if (section.is_reference || section.is_key_insights) return section;

    const links = findLinksForSection(section, catalog, catalogIndex, usedSlugs);
    if (links.length === 0) return section;

    links.forEach((l) => usedSlugs.add(l.target_slug.replace('/blog/', '')));
    allLinks.push(...links);

    return { ...section, body: injectLinksIntoSection(section, links) };
  });

  return { sections: updated, links: allLinks };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — GEO OPTIMIZATION
// ─────────────────────────────────────────────────────────────────────────────

function geoScoreSection(body: string): number {
  let score = 0;
  if (GEO_ANSWER_BLOCK_RE.test(body))  score += 34;
  if (GEO_KEY_INSIGHT_RE.test(body))   score += 33;
  if (GEO_WHY_MATTERS_RE.test(body))   score += 33;
  return score;
}

function aggregateGeoScore(sections: ParsedSection[]): number {
  const ev = sections.filter((s) => !s.is_reference && !s.is_key_insights);
  if (ev.length === 0) return 0;
  const total = ev.reduce((sum, s) => sum + geoScoreSection(s.body), 0);
  return Math.round(total / ev.length);
}

// 3.1 — Answer block (LLM-extractable direct answer at section top)
function buildAnswerBlock(heading: string, dmEntry: DepthMapEntry, keyPoint: string): string {
  const answer = dmEntry.key_point || keyPoint || heading;
  if (!answer || answer.length < 10) return '';
  return `<div class="geo-answer"><strong>Direct Answer:</strong> ${esc(answer)}</div>`;
}

// 3.2 — Entity clarity: wrap first occurrence of pillar name with <dfn>
function addEntityClarity(body: string, term: string, definition: string): string {
  if (!term || term.length < 3 || !definition || isTemplate(definition)) return body;

  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<!<[^>]*)(${escapedTerm})(?![^<]*>)`, 'i');

  // Only replace first occurrence and only if not already wrapped
  if (GEO_ENTITY_RE.test(body)) return body;
  return body.replace(re, `<dfn title="${esc(definition)}">$1</dfn>`);
}

// 3.3 — Structured insight lines
function addInsightLines(body: string, dmEntry: DepthMapEntry): string {
  // Don't add if already present
  if (GEO_KEY_INSIGHT_RE.test(body) && GEO_WHY_MATTERS_RE.test(body)) return body;

  const lines: string[] = [];

  if (!GEO_KEY_INSIGHT_RE.test(body) && !isTemplate(dmEntry.insight_angle)) {
    lines.push(`<p><strong>Key Insight:</strong> ${esc(dmEntry.insight_angle)}</p>`);
  }

  if (!GEO_WHY_MATTERS_RE.test(body) && !isTemplate(dmEntry.why_it_matters) && dmEntry.why_it_matters.length > 10) {
    lines.push(`<p><strong>Why this matters:</strong> ${esc(dmEntry.why_it_matters)}</p>`);
  }

  if (lines.length === 0) return body;
  return `${body}\n${lines.join('\n')}`;
}

// 3.4 — Semantic coverage: inject key topic variations if not already present
function addSemanticCoverage(body: string, cgi: ContentGenerationInput): string {
  // Add a subtle semantic phrase only if the topic and trend_context keywords aren't in the section
  const bodyLower = body.toLowerCase();
  const topicTokens = tokenize(cgi.topic);

  // Check if at least 2 topic tokens are present — if not, add a brief contextual hook
  const hitsInBody = topicTokens.filter((t) => bodyLower.includes(t)).length;
  if (hitsInBody >= 2) return body;  // already covered

  const trend = cgi.trend_context;
  if (!trend || trend.length < 10) return body;

  return `${body}\n<p class="semantic-context"><em>Context: ${esc(trend.slice(0, 160))}</em></p>`;
}

function runGeoOptimization(
  sections:  ParsedSection[],
  cgi:       ContentGenerationInput,
): { sections: ParsedSection[]; improvements: string[] } {
  const improvements: string[] = [];
  let evaluableIdx = 0;

  const updated = sections.map((section) => {
    if (section.is_reference || section.is_key_insights) return section;

    const dmEntry = matchDepthEntry(section.heading, evaluableIdx, cgi.depth_map);
    evaluableIdx++;

    let body = section.body;
    const wc = wordCount(body);

    // 3.1 — Answer block (only on sections that don't already have one)
    if (!GEO_ANSWER_BLOCK_RE.test(body) && !isTemplate(dmEntry.key_point)) {
      const answerBlock = buildAnswerBlock(section.heading, dmEntry, dmEntry.key_point);
      if (answerBlock) {
        body = `${answerBlock}\n${body}`;
        improvements.push(`[${section.id}] GEO answer block added — "${section.heading}"`);
      }
    }

    // 3.2 — Entity clarity (only if section is long enough to benefit)
    if (wc > 40 && dmEntry.pillar && !isTemplate(dmEntry.why_it_matters)) {
      const withEntity = addEntityClarity(body, dmEntry.pillar, dmEntry.why_it_matters);
      if (withEntity !== body) {
        body = withEntity;
        improvements.push(`[${section.id}] entity definition added — "${dmEntry.pillar}"`);
      }
    }

    // 3.3 — Structured insight lines
    if (!isTemplate(dmEntry.insight_angle) || !isTemplate(dmEntry.why_it_matters)) {
      const withInsight = addInsightLines(body, dmEntry);
      if (withInsight !== body) {
        body = withInsight;
        improvements.push(`[${section.id}] Key Insight / Why this matters lines added`);
      }
    }

    // 3.4 — Semantic coverage (only on evaluable sections with few topic tokens)
    const withSemantic = addSemanticCoverage(body, cgi);
    if (withSemantic !== body) {
      body = withSemantic;
      improvements.push(`[${section.id}] semantic context line added`);
    }

    return { ...section, body };
  });

  return { sections: updated, improvements };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — ANTI-SHALLOW FILTER REPORT (upgraded v2.1)
// This does NOT inject further — it reports what v2.1 could not fix,
// so the caller has a clear picture of what remains.
// ─────────────────────────────────────────────────────────────────────────────

function antiShallowReport(
  sections: ParsedSection[],
  cgi:      ContentGenerationInput,
): string[] {
  const stillShallow: string[] = [];
  let evaluableIdx = 0;

  // v2.4 fix 2: shallow = no mechanism OR missing full decision structure (Use/Avoid/Choose)
  for (const section of sections) {
    if (section.is_reference || section.is_key_insights) continue;

    const wc      = wordCount(section.body);
    const ds      = evalDepthState(section.body, wc);
    const dmEntry = matchDepthEntry(section.heading, evaluableIdx, cgi.depth_map);
    evaluableIdx++;

    const missing: string[] = [];

    // Primary shallow condition: missing mechanism
    if (!ds.mechanism) {
      const reason = isTemplate(dmEntry.mechanism) ? 'template in depth_map' : 'no mechanism content';
      missing.push(`mechanism (${reason})`);
    }

    // v2.5: accept full Use/Avoid/Choose OR legacy actionable language (when to use, should you…)
    const hasFullDecision =
      section.body.includes('Use this when') &&
      section.body.includes('Avoid this when') &&
      section.body.includes('Choose this if');
    const hasLegacyDecision = /\b(when to use|should you|if you (?:are|have|need)|before choosing|apply this when|use this when)\b/i.test(stripHtml(section.body));
    if (!hasFullDecision && !hasLegacyDecision) {
      const reason = isTemplate(dmEntry.why_it_matters) ? 'template in depth_map' : 'no full decision structure';
      missing.push(`decision_structure (${reason})`);
    }

    // Secondary: example and insight (informational only)
    if (!ds.example) {
      const reason = isTemplate(dmEntry.example_direction) ? 'template in depth_map' : 'no example content';
      missing.push(`example (${reason})`);
    }
    if (!ds.insight) {
      const reason = isTemplate(dmEntry.contrarian_take) ? 'template in depth_map' : 'no insight content';
      missing.push(`insight (${reason})`);
    }

    if (missing.length > 0) {
      stillShallow.push(`[${section.id}] "${section.heading}" — still missing: ${missing.join(', ')}`);
    }
  }

  return stillShallow;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runContentQualityEnhancer (v2.2)
 *
 * Takes the output of runContentDepthAndInsightEngine (v2) and applies:
 *   1. Depth hard enforcement (v2.2): template-aware, 350-word ceiling, synthetic
 *      signal fallback, multi-layer injection up to +120 words per section.
 *   2. Internal linking from company blog catalog.
 *   3. GEO optimization (answer blocks, entity clarity, insight markers).
 *   4. Anti-shallow filter (v2.2 definition: shallow = no mechanism OR no decision implication).
 *
 * All corrections are deterministic — no AI calls.
 *
 * @param input.content_generation_input  bridge output (ContentGenerationInput)
 * @param input.final_content             output from runContentDepthAndInsightEngine
 * @param input.blog_catalog              optional published blog catalog for linking
 * @returns QualityEnhancerOutput
 */
export function runContentQualityEnhancer(
  input: QualityEnhancerInput,
): QualityEnhancerOutput {
  const { content_generation_input: cgi, final_content, blog_catalog = [] } = input;

  const sections = parseSections(final_content.content_html);

  // ── Before scores ─────────────────────────────────────────────────────────
  const depthBefore = aggregateDepthScoreFromSections(sections);
  const geoBefore   = aggregateGeoScore(sections);

  // ── Step 1: Depth hard enforcement (v2.2) ─────────────────────────────────
  const {
    sections:               afterDepth,
    fixes:                  depthFixes,
    rewritten:              sectionsRewritten,
    shallowFixed:           shallowFixedCount,
    overcorrectionDetected: overcorrection,
  } = enforceDepth(sections, cgi);

  // ── Step 2: Internal linking ───────────────────────────────────────────────
  const { sections: afterLinks, links: linksAdded } = runInternalLinking(afterDepth, blog_catalog);

  // ── Step 3: GEO optimization ───────────────────────────────────────────────
  const { sections: afterGeo, improvements: geoImprovements } = runGeoOptimization(afterLinks, cgi);

  // ── Step 4: Anti-shallow filter report (v2.2) ─────────────────────────────
  const shallowRemaining = antiShallowReport(afterGeo, cgi);
  if (shallowRemaining.length > 0) {
    shallowRemaining.forEach((s) => depthFixes.push(`REPORT ${s}`));
  }

  // ── After scores ──────────────────────────────────────────────────────────
  const depthAfter = aggregateDepthScoreFromSections(afterGeo);
  const geoAfter   = aggregateGeoScore(afterGeo);

  // v2.2: avg_section_depth = mean depth score across evaluable sections
  const evaluableSections = afterGeo.filter((s) => !s.is_reference && !s.is_key_insights);
  const avgSectionDepth   = evaluableSections.length > 0
    ? Math.round(evaluableSections.reduce((sum, s) => {
        const wc = wordCount(s.body);
        return sum + depthScore(evalDepthState(s.body, wc));
      }, 0) / evaluableSections.length)
    : 100;

  // ── Reassemble ────────────────────────────────────────────────────────────
  const enhancedHtml   = assembleSections(afterGeo);
  const content_blocks = htmlToBlocks(enhancedHtml);

  const enhanced_content: BlogGenerationOutput & { content_blocks: unknown[] } = {
    ...final_content,
    content_html:   enhancedHtml,
    content_blocks,
  };

  return {
    enhanced_content,
    depth_fixes:        depthFixes,
    links_added:        linksAdded,
    geo_improvements:   geoImprovements,
    sections_rewritten: sectionsRewritten,
    validation_report: {
      depth_score_before:         depthBefore,
      depth_score_after:          depthAfter,
      internal_links_added:       linksAdded.length,
      geo_score_before:           geoBefore,
      geo_score_after:            geoAfter,
      shallow_sections_fixed:     shallowFixedCount,
      shallow_sections_remaining: shallowRemaining.length,
      avg_section_depth:          avgSectionDepth,
      overcorrection_detected:    overcorrection,
    },
  };
}
