/**
 * Content Quality Enhancer — linking / GEO / anti-shallow passes (Steps 2–4).
 *
 * Internal linking engine, GEO optimization (answer blocks, entity clarity,
 * insight markers), and the anti-shallow report. Split from
 * contentQualityEnhancer_v2_1.ts (Agent-B large-file modularization).
 */
import { wordCount } from '../../pages/blogs.helpers';
import type { ContentGenerationInput, DepthMapEntry } from './cardToContentBridge';
import {
  type ParsedSection,
  type BlogCatalogEntry, type InternalLink,
  GEO_ANSWER_BLOCK_RE, GEO_KEY_INSIGHT_RE, GEO_WHY_MATTERS_RE, GEO_ENTITY_RE,
  MECHANISM_RE, INSIGHT_RE,
  tokenize, esc, stripHtml, isTemplate,
  evalDepthState, matchDepthEntry,
} from './contentQualityEnhancerCore';

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — INTERNAL LINKING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_TOKEN_OVERLAP = 3;  // minimum shared tokens to qualify a link
export const MAX_LINKS_PER_SECTION = 2;

export function buildCatalogTokenSets(
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

export function findLinksForSection(
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

export function injectLinksIntoSection(section: ParsedSection, links: InternalLink[]): string {
  if (links.length === 0) return section.body;

  const linkHtml = links
    .map((l) => `<a href="${l.target_slug}">${esc(l.anchor_text)}</a>`)
    .join(', ');

  // Append a "See also" line at the end of the section body (before any h3s if present)
  return `${section.body}\n<p class="internal-links"><em>Related reading: ${linkHtml}</em></p>`;
}

export function runInternalLinking(
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

export function geoScoreSection(body: string): number {
  let score = 0;
  if (GEO_ANSWER_BLOCK_RE.test(body))  score += 34;
  if (GEO_KEY_INSIGHT_RE.test(body))   score += 33;
  if (GEO_WHY_MATTERS_RE.test(body))   score += 33;
  return score;
}

export function aggregateGeoScore(sections: ParsedSection[]): number {
  const ev = sections.filter((s) => !s.is_reference && !s.is_key_insights);
  if (ev.length === 0) return 0;
  const total = ev.reduce((sum, s) => sum + geoScoreSection(s.body), 0);
  return Math.round(total / ev.length);
}

// 3.1 — Answer block (LLM-extractable direct answer at section top)
export function buildAnswerBlock(heading: string, dmEntry: DepthMapEntry, keyPoint: string): string {
  const answer = dmEntry.key_point || keyPoint || heading;
  if (!answer || answer.length < 10) return '';
  return `<div class="geo-answer"><strong>Direct Answer:</strong> ${esc(answer)}</div>`;
}

// 3.2 — Entity clarity: wrap first occurrence of pillar name with <dfn>
export function addEntityClarity(body: string, term: string, definition: string): string {
  if (!term || term.length < 3 || !definition || isTemplate(definition)) return body;

  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<!<[^>]*)(${escapedTerm})(?![^<]*>)`, 'i');

  // Only replace first occurrence and only if not already wrapped
  if (GEO_ENTITY_RE.test(body)) return body;
  return body.replace(re, `<dfn title="${esc(definition)}">$1</dfn>`);
}

// 3.3 — Structured insight lines
export function addInsightLines(body: string, dmEntry: DepthMapEntry): string {
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
export function addSemanticCoverage(body: string, cgi: ContentGenerationInput): string {
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

export function runGeoOptimization(
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

export function antiShallowReport(
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

