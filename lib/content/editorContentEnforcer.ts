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
const THIN_SECTION_THRESHOLD = 80;
/** Inject links until this count is reached. */
const MIN_INTERNAL_LINKS     = 2;
/** CSS class that identifies the GEO summary block. */
const GEO_SUMMARY_CLASS      = 'geo-summary';
/** Minimum shared token count between section and catalog entry to qualify a link. */
const MIN_TOKEN_OVERLAP      = 2;

// ── Stop-words ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','but','by',
  'for','from','had','has','have','if','in','into','is','it','its','of',
  'on','or','that','the','their','there','these','this','those','to','was',
  'were','will','with','you','your','they','them','we','our','all','about',
  'more','can','when','what','how','which','so','do','also','just',
  'not','any','than','then','use','used','some','other','most',
]);

// ── Depth-detection regex ─────────────────────────────────────────────────────

const MECHANISM_RE = /\b(because|work[s]? by|process|system|sequence|driver|caus|mechanism|operat|step[s]?|how it|the reason)\b/i;
const EXAMPLE_RE   = /\b(for example|for instance|example|case study|scenario|consider|imagine|such as|like when|in practice|real.world)\b/i;
const DECISION_RE  = /\b(decision|implication|therefore|which means|trade.?off|when to use|should you|use this when|avoid this when)\b/i;

/** Matches any existing geo-summary div regardless of attribute order. */
const GEO_SUMMARY_RE = new RegExp(`class="${GEO_SUMMARY_CLASS}"`, 'i');

// ── Internal helpers ──────────────────────────────────────────────────────────

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

interface EnforcerSection {
  id:           string;
  heading:      string;   // plain text (no HTML)
  body:         string;   // HTML
  is_intro:     boolean;  // content before the first <h2>
  is_reference: boolean;  // "References?" heading — skip depth enforcement
}

function parseSections(html: string): EnforcerSection[] {
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

function assembleSections(sections: EnforcerSection[]): string {
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
function expandSection(
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

function detectAndExpandThinSections(
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

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — GEO SUMMARY BLOCK
// ─────────────────────────────────────────────────────────────────────────────

function buildGeoSummary(cgi: ContentGenerationInput): string {
  const topic = cgi.topic || 'this topic';

  // Core insight: prefer authority_basis then first key message then selected_angle
  const insight =
    cgi.strategic_core?.authority_basis ||
    cgi.key_messages[0] ||
    cgi.selected_angle;

  // Decision implication: prefer first when_to_use then transformation_goal then fallback
  const implication =
    cgi.decision_blocks?.[0]?.when_to_use?.[0] ||
    cgi.strategic_core?.transformation_goal ||
    `Understanding ${topic} allows teams to make faster, higher-confidence decisions.`;

  const summary = [
    `${esc(topic)} is a strategic lever for teams looking to improve outcomes.`,
    esc(insight),
    esc(cgi.selected_angle),
    esc(implication),
  ].join(' ');

  return (
    `<div class="${GEO_SUMMARY_CLASS}">\n` +
    `<strong>Article Summary:</strong>\n` +
    `<p>${summary}</p>\n` +
    `</div>`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — INTERNAL LINK AUTO-INJECTION
// ─────────────────────────────────────────────────────────────────────────────

function countExistingInternalLinks(html: string): number {
  return (html.match(/<a\s[^>]*href=["']\/blog\//gi) ?? []).length;
}

/**
 * Find the best catalog matches for sections that don't yet have a link from
 * that entry. Returns at most `max` matches, one per section, deduplicated by slug.
 */
function findTopCatalogMatches(
  sections:  EnforcerSection[],
  catalog:   BlogCatalogEntry[],
  max:       number,
): Array<{ section: EnforcerSection; entry: BlogCatalogEntry; overlap: number }> {
  type Match = { section: EnforcerSection; entry: BlogCatalogEntry; overlap: number };

  // Pre-compute token sets for catalog entries
  const catalogTokens = new Map<string, Set<string>>();
  for (const entry of catalog) {
    const text = [entry.title, entry.excerpt, ...entry.tags, entry.category ?? ''].join(' ');
    catalogTokens.set(entry.slug, new Set(tokenize(text)));
  }

  const candidates: Match[] = [];

  for (const section of sections) {
    if (section.is_intro || section.is_reference) continue;
    const bodyTokens = new Set(tokenize(stripHtml(section.body + ' ' + section.heading)));

    for (const entry of catalog) {
      const entryTokens = catalogTokens.get(entry.slug) ?? new Set<string>();
      const overlap     = [...entryTokens].filter((t) => bodyTokens.has(t)).length;
      if (overlap >= MIN_TOKEN_OVERLAP) {
        candidates.push({ section, entry, overlap });
      }
    }
  }

  // Sort by overlap descending, then pick top N with no repeated section or slug
  candidates.sort((a, b) => b.overlap - a.overlap);

  const picked: Match[]       = [];
  const usedSections          = new Set<string>();
  const usedSlugs             = new Set<string>();

  for (const c of candidates) {
    if (picked.length >= max) break;
    if (usedSections.has(c.section.id) || usedSlugs.has(c.entry.slug)) continue;
    picked.push(c);
    usedSections.add(c.section.id);
    usedSlugs.add(c.entry.slug);
  }

  return picked;
}

function injectInternalLinks(
  sections:      EnforcerSection[],
  catalog:       BlogCatalogEntry[],
  existingCount: number,
): { sections: EnforcerSection[]; added: InternalLink[] } {
  const needed = MIN_INTERNAL_LINKS - existingCount;
  if (needed <= 0 || catalog.length === 0) return { sections, added: [] };

  const toInject = Math.min(needed, MIN_INTERNAL_LINKS);
  const matches  = findTopCatalogMatches(sections, catalog, toInject);
  const added:     InternalLink[] = [];

  const sectionMap = new Map(sections.map((s) => [s.id, s]));

  for (const { section, entry, overlap } of matches) {
    const linkHtml =
      `<p class="internal-links">Related reading: ` +
      `<a href="/blog/${entry.slug}">${esc(entry.title)}</a></p>`;

    const current = sectionMap.get(section.id)!;
    sectionMap.set(section.id, { ...current, body: `${current.body}\n${linkHtml}` });

    added.push({
      section_id:  section.id,
      anchor_text: entry.title,
      target_slug: `/blog/${entry.slug}`,
      context:     `Token overlap: ${overlap} — matched via "${section.heading}"`,
    });
  }

  return {
    sections: sections.map((s) => sectionMap.get(s.id) ?? s),
    added,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — DEPTH ENFORCEMENT (LIGHT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Light depth pass — runs after Step 1 expansion.
 * For any section still under the THIN_SECTION_THRESHOLD, ensure at least
 * one depth layer is present (mechanism | example | decision insight).
 */
function lightDepthEnforce(
  sections: EnforcerSection[],
  cgi:      ContentGenerationInput,
): EnforcerSection[] {
  let evaluableIdx = 0;

  return sections.map((section) => {
    if (section.is_intro || section.is_reference) return section;

    const dmEntry = cgi.depth_map?.[evaluableIdx] ?? null;
    evaluableIdx++;

    // Only apply to still-thin sections (those expansion couldn't bring over threshold)
    if (wordCount(section.body) >= THIN_SECTION_THRESHOLD) return section;

    // If at least one depth layer is already present, nothing to do
    const hasMechanism = MECHANISM_RE.test(section.body);
    const hasExample   = EXAMPLE_RE.test(section.body);
    const hasDecision  = DECISION_RE.test(section.body);
    if (hasMechanism || hasExample || hasDecision) return section;

    // Inject the cheapest available layer from depth_map
    let body = section.body;
    if (dmEntry?.mechanism && dmEntry.mechanism.length > 20) {
      body = `${body}\n<p><strong>How this works:</strong> ${esc(dmEntry.mechanism)}</p>`;
    } else if (dmEntry?.example_direction && dmEntry.example_direction.length > 20) {
      body = `${body}\n<p><strong>In practice:</strong> ${esc(dmEntry.example_direction)}</p>`;
    } else if (dmEntry?.insight_angle && dmEntry.insight_angle.length > 20) {
      body = `${body}\n<p>${esc(dmEntry.insight_angle)}</p>`;
    }

    return { ...section, body };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — HARD BLOCK CONDITIONS
// ─────────────────────────────────────────────────────────────────────────────

function evaluateHardBlockConditions(
  sections:          EnforcerSection[],
  geoSummaryPresent: boolean,
  internalLinkCount: number,
): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Thin section count is checked on the FINAL sections (post all expansion)
  const thinCount = sections.filter(
    (s) => !s.is_intro && !s.is_reference && wordCount(s.body) < THIN_SECTION_THRESHOLD,
  ).length;

  if (thinCount > 2) {
    reasons.push(
      `thin_sections_count=${thinCount} — more than 2 sections remain under ${THIN_SECTION_THRESHOLD} words after auto-fix`,
    );
  }

  if (internalLinkCount === 0) {
    reasons.push('internal_links=0 — at least 1 internal link required to publish');
  }

  if (!geoSummaryPresent) {
    reasons.push('geo_summary_missing — article summary block is required before publish');
  }

  return { blocked: reasons.length > 0, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

function runEditorContentEnforcer(input: EditorEnforcerInput): EditorEnforcerOutput {
  const { content_generation_input: cgi, blog_catalog = [] } = input;
  const originalHtml = input.content_html;

  // ── Step 1: Thin section detection + expansion ────────────────────────────
  let sections = parseSections(originalHtml);
  const { sections: s1, thinFixed } = detectAndExpandThinSections(sections, cgi);
  sections = s1;

  // ── Step 2: GEO summary block ─────────────────────────────────────────────
  // Check on the original HTML so we don't double-inject if the author already
  // has the block hand-written.
  const isGeoPresent = GEO_SUMMARY_RE.test(originalHtml);
  const geoAdded     = !isGeoPresent;
  const geoBlock     = isGeoPresent ? '' : buildGeoSummary(cgi);

  // ── Step 3: Internal link auto-injection ─────────────────────────────────
  const existingLinks = countExistingInternalLinks(originalHtml);
  const { sections: s3, added: linksAdded } = injectInternalLinks(
    sections,
    blog_catalog,
    existingLinks,
  );
  sections = s3;

  // ── Step 4: Light depth enforcement (second pass for still-thin sections) ─
  sections = lightDepthEnforce(sections, cgi);

  // ── Assemble final HTML ───────────────────────────────────────────────────
  const bodyHtml  = assembleSections(sections);
  const finalHtml = geoBlock ? `${geoBlock}\n\n${bodyHtml}` : bodyHtml;

  // ── Step 5: Hard block evaluation ────────────────────────────────────────
  const finalLinkCount    = existingLinks + linksAdded.length;
  const geoSummaryPresent = isGeoPresent || geoAdded;  // always true after this pipeline
  const { blocked, reasons } = evaluateHardBlockConditions(
    sections,
    geoSummaryPresent,
    finalLinkCount,
  );

  return {
    thin_sections_fixed: thinFixed,
    geo_block_added:     geoAdded,
    links_added:         linksAdded,
    publish_blocked:     blocked,
    block_reasons:       reasons,
    enhanced_html:       finalHtml,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION HOOKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * beforePublish — hard gate. Call before any publish action.
 *
 * If `output.publish_blocked` is true the caller MUST prevent the post from
 * being submitted to the publish pipeline. Inspect `output.block_reasons` to
 * surface per-reason feedback in the editor UI.
 *
 * Typical integration:
 * ```ts
 * const enforcement = beforePublish({ content_html, content_generation_input, blog_catalog });
 * if (enforcement.publish_blocked) {
 *   return { error: enforcement.block_reasons.join(' | ') };
 * }
 * await publishNow({ ... });
 * ```
 */
export function beforePublish(input: EditorEnforcerInput): EditorEnforcerOutput {
  return runEditorContentEnforcer(input);
}

/**
 * onEditorSave — advisory pass. Call on every draft auto-save or manual save.
 *
 * Runs the full enforcement pipeline and returns the enhanced HTML (with all
 * auto-fixes applied) but `publish_blocked` is always `false` in the returned
 * value — saving is never blocked. Use `block_reasons` to display inline
 * warnings in the editor without interrupting the author's flow.
 *
 * Typical integration:
 * ```ts
 * const enforcement = onEditorSave({ content_html, content_generation_input, blog_catalog });
 * await saveDraft(enforcement.enhanced_html);
 * if (enforcement.block_reasons.length > 0) {
 *   showEditorWarnings(enforcement.block_reasons);
 * }
 * ```
 */
export function onEditorSave(input: EditorEnforcerInput): EditorEnforcerOutput {
  const result = runEditorContentEnforcer(input);
  return {
    ...result,
    publish_blocked: false, // saving is always allowed; hard block fires at publish time
  };
}
