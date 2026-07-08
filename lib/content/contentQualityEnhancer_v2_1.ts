import { wordCount } from '../../pages/blogs.helpers';

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

// Module layout (Agent-B large-file modularization — behavior-preserving):
//   contentQualityEnhancerCore.ts   — constants, types, text utils, parser, evaluator
//   contentQualityEnhancerDepth.ts  — Step 1 depth hard enforcement (v2.3)
//   contentQualityEnhancerPasses.ts — Steps 2–4 linking / GEO / anti-shallow
// Public surface is re-exported below, so importers keep using this path.
import { wordCount } from '../../pages/blogs.helpers';
import {
  type QualityEnhancerInput, type QualityEnhancerOutput, type ParsedSection,
  parseSections, assembleSections, aggregateDepthScoreFromSections,
} from './contentQualityEnhancerCore';
import { enforceDepth } from './contentQualityEnhancerDepth';
import { runInternalLinking, runGeoOptimization, antiShallowReport, aggregateGeoScore } from './contentQualityEnhancerPasses';

export type { BlogCatalogEntry, InternalLink, QualityEnhancerInput, QualityEnhancerOutput } from './contentQualityEnhancerCore';

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
