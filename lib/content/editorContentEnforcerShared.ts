/** Part of editorContentEnforcer (Agent-B split — main module keeps the original path). */
import { wordCount } from '../../pages/blogs.helpers';

/**
 * Editor Content Enforcer
 *
 * Pre-publish content enforcement engine. Runs as both an advisory save hook
 * (onEditorSave) and a hard blocking gate (beforePublish).
 *
 * Steps:
 *   1. Thin section detection (< 80 words) + auto-expansion via depth_map /
 *      must_include_points / decision_blocks
 *   2. GEO summary block — insert at TOP if missing
 *   3. Internal link auto-injection — up to 2 links when count < 2
 *   4. Depth enforcement (light) — min 1 layer (mechanism | example | decision)
 *      per still-thin section after Step 1
 *   5. Hard block evaluation — blocks publish if:
 *        thin_sections > 2 | internal_links = 0 | geo_summary missing
 *
 * Integration:
 *   beforePublish(input)  — full pipeline; returns publish_blocked=true when
 *                           hard conditions are unmet. Caller must gate publish.
 *   onEditorSave(input)   — same pipeline; publish_blocked always false.
 *                           Shows warnings without preventing draft save.
 *
 * Output:
 *   {
 *     thin_sections_fixed: string[],
 *     geo_block_added:     boolean,
 *     links_added:         InternalLink[],
 *     publish_blocked:     boolean,
 *     block_reasons:       string[],
 *     enhanced_html:       string,
 *   }
 */

import type { ContentGenerationInput, DepthMapEntry, DecisionBlock } from './cardToContentBridge';
import type { BlogCatalogEntry, InternalLink } from './contentQualityEnhancer_v2_1';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Sections below this word count are flagged as thin. */

export const THIN_SECTION_THRESHOLD = 80;
/** Inject links until this count is reached. */
export const MIN_INTERNAL_LINKS     = 2;
/** CSS class that identifies the GEO summary block. */
export const GEO_SUMMARY_CLASS      = 'geo-summary';
/** Minimum shared token count between section and catalog entry to qualify a link. */
export const MIN_TOKEN_OVERLAP      = 2;

// ── Stop-words ────────────────────────────────────────────────────────────────

export const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','but','by',
  'for','from','had','has','have','if','in','into','is','it','its','of',
  'on','or','that','the','their','there','these','this','those','to','was',
  'were','will','with','you','your','they','them','we','our','all','about',
  'more','can','when','what','how','which','so','do','also','just',
  'not','any','than','then','use','used','some','other','most',
]);

// ── Depth-detection regex ─────────────────────────────────────────────────────

export const MECHANISM_RE = /\b(because|work[s]? by|process|system|sequence|driver|caus|mechanism|operat|step[s]?|how it|the reason)\b/i;
export const EXAMPLE_RE   = /\b(for example|for instance|example|case study|scenario|consider|imagine|such as|like when|in practice|real.world)\b/i;
export const DECISION_RE  = /\b(decision|implication|therefore|which means|trade.?off|when to use|should you|use this when|avoid this when)\b/i;

/** Matches any existing geo-summary div regardless of attribute order. */
export const GEO_SUMMARY_RE = new RegExp(`class="${GEO_SUMMARY_CLASS}"`, 'i');

// ── Internal helpers ──────────────────────────────────────────────────────────

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



// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface EditorEnforcerInput {
  /** Full HTML content of the article being edited or published. */
  content_html:             string;
  /**
   * CGI from cardToContentBridge — provides depth_map, decision_blocks,
   * must_include_points, topic, strategic_core, etc.
   */
  content_generation_input: ContentGenerationInput;
  /**
   * Published blog catalog for internal link auto-injection.
   * If omitted or empty, Step 3 is skipped and internal_links cannot be
   * injected automatically (may trigger publish block if count stays at 0).
   */
  blog_catalog?:            BlogCatalogEntry[];
}

export interface EditorEnforcerOutput {
  /** Section headings expanded from thin state (Step 1). */
  thin_sections_fixed: string[];
  /** True when the geo-summary block was injected in this run (Step 2). */
  geo_block_added:     boolean;
  /** Internal links injected (Step 3). */
  links_added:         InternalLink[];
  /**
   * True when one or more hard block conditions are unmet after all auto-fix
   * passes. In beforePublish() the caller MUST prevent publish. Always false
   * in onEditorSave() results.
   */
  publish_blocked:     boolean;
  /** Human-readable reasons for publish block (empty when publish_blocked=false). */
  block_reasons:       string[];
  /** Post-enforcement HTML — ready to be saved / previewed. */
  enhanced_html:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL SECTION TYPE + PARSER
// ─────────────────────────────────────────────────────────────────────────────

export interface EnforcerSection {
  id:           string;
  heading:      string;   // plain text (no HTML)
  body:         string;   // HTML
  is_intro:     boolean;  // content before the first <h2>
  is_reference: boolean;  // "References?" heading — skip depth enforcement
}

export function parseSections(html: string): EnforcerSection[] {
  const sections: EnforcerSection[] = [];

  // Preamble — everything before the first <h2>
  const firstH2 = html.search(/<h2>/i);
  if (firstH2 > 0) {
    const preamble = html.slice(0, firstH2).trim();
    if (preamble) {
      sections.push({
        id:           'section_intro',
        heading:      '',
        body:         preamble,
        is_intro:     true,
        is_reference: false,
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
      id:           `section_${idx++}`,
      heading,
      body,
      is_intro:     false,
      is_reference: /^references?$/i.test(heading),
    });
  }

  return sections;
}

export function assembleSections(sections: EnforcerSection[]): string {
  return sections
    .map((s) => (s.is_intro ? s.body : `<h2>${esc(s.heading)}</h2>\n${s.body}`))
    .join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — THIN SECTION DETECTION + EXPANSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * expandSection — auto-expands a thin section using available CGI sources
 * in priority order:
 *   1. depth_map[n].mechanism
 *   2. depth_map[n].example_direction
 *   3. must_include_points that share at least one token with the heading
 *   4. decision_blocks whose topic overlaps the heading
 */
export function expandSection(
  section: EnforcerSection,
  cgi:     ContentGenerationInput,
  dmEntry: DepthMapEntry | null,
): string {
  let body = section.body;
  const additions: string[] = [];

  // 1 — Mechanism from depth_map
  if (
    dmEntry?.mechanism &&
    dmEntry.mechanism.length > 20 &&
    !MECHANISM_RE.test(body)
  ) {
    additions.push(
      `<p><strong>How this works:</strong> ${esc(dmEntry.mechanism)}</p>`,
    );
  }

  // 2 — Example from depth_map
  if (
    dmEntry?.example_direction &&
    dmEntry.example_direction.length > 20 &&
    !EXAMPLE_RE.test(body)
  ) {
    additions.push(
      `<p><strong>In practice:</strong> ${esc(dmEntry.example_direction)}</p>`,
    );
  }

  // 3 — must_include_points with token overlap to heading
  const sectionTokens = new Set(tokenize(section.heading));
  for (const point of cgi.must_include_points) {
    const overlap = tokenize(point).filter((t) => sectionTokens.has(t)).length;
    if (overlap > 0) {
      // Only inject if the first 30 chars are not already in the body
      const plainBody = stripHtml(body).toLowerCase();
      if (!plainBody.includes(point.toLowerCase().slice(0, 30))) {
        additions.push(`<p>${esc(point)}</p>`);
      }
    }
  }

  // 4 — decision_blocks with topic token overlap to heading
  const sectionTokenArr = tokenize(section.heading);
  const matchingDecision = cgi.decision_blocks?.find((db: DecisionBlock) =>
    tokenize(db.topic).some((t) => sectionTokenArr.includes(t)),
  );
  if (matchingDecision && !DECISION_RE.test(body)) {
    const useLines  = matchingDecision.when_to_use.slice(0, 2).join('; ');
    const avoidLine = matchingDecision.when_not_to_use[0] ?? '';
    const decisionText =
      `Use this when ${useLines}.` +
      (avoidLine ? ` Avoid this when ${avoidLine}.` : '');
    additions.push(
      `<p><strong>What this means for decision-making:</strong> ${esc(decisionText)}</p>`,
    );
  }

  if (additions.length > 0) {
    body = `${body}\n${additions.join('\n')}`;
  }

  return body;
}

export function detectAndExpandThinSections(
  sections: EnforcerSection[],
  cgi:      ContentGenerationInput,
): { sections: EnforcerSection[]; thinFixed: string[] } {
  const thinFixed: string[] = [];
  let evaluableIdx = 0;

  const updated = sections.map((section) => {
    if (section.is_intro || section.is_reference) return section;

    const dmEntry = cgi.depth_map?.[evaluableIdx] ?? null;
    evaluableIdx++;

    if (wordCount(section.body) < THIN_SECTION_THRESHOLD) {
      const expandedBody = expandSection(section, cgi, dmEntry);
      thinFixed.push(`[${section.id}] "${section.heading}"`);
      return { ...section, body: expandedBody };
    }

    return section;
  });

  return { sections: updated, thinFixed };
}

