/** Part 1/2 of blogStructureTemplates.ts — verbatim split (barrel preserved; importers unchanged). */
/**
 * Blog Structure Templates
 *
 * Defines format-specific structural rules for blog generation.
 * Replaces the fixed skeleton in buildGenerationSystemPrompt with
 * dynamic structure rules based on the chosen format type.
 *
 * For 'standard' format, returns null so the existing hardcoded
 * logic in buildGenerationSystemPrompt is used unchanged.
 */

// ── Format type ──────────────────────────────────────────────────────────────


export type BlogFormatType =
  | 'standard'
  | 'listicle'
  | 'tutorial'
  | 'case-study'
  | 'comparison'
  | 'pillar';

export const BLOG_FORMAT_OPTIONS: { value: BlogFormatType; label: string; description: string; wordRange: string }[] = [
  { value: 'standard',    label: 'Standard',    description: 'Structured deep-dive with H2 sections, key insights, and summary', wordRange: '800–1,600 words' },
  { value: 'listicle',    label: 'Listicle',    description: 'Numbered list items (5–10), each a standalone insight', wordRange: '800–1,200 words' },
  { value: 'tutorial',    label: 'Tutorial',    description: 'Step-by-step guide with prerequisites and common mistakes', wordRange: '1,200–2,000 words' },
  { value: 'case-study',  label: 'Case Study',  description: 'Background → Challenge → Solution → Results narrative', wordRange: '1,200–2,000 words' },
  { value: 'comparison',  label: 'Comparison',  description: 'Feature-by-feature comparison with pros/cons and verdict', wordRange: '1,200–2,000 words' },
  { value: 'pillar',      label: 'Pillar Content', description: 'Comprehensive evergreen resource — deep authority', wordRange: '3,000–5,000 words' },
];

// ── Validation overrides ────────────────────────────────────────────────────
//
// Phase 3.4 — These were previously HARD mandates ("min_h2 ≥ N", "FAQ
// required", "Summary required"). They are now SOFT advisory floors used
// only by intent-driven validation. Generation prompts no longer carry
// "MUST" language for structure; the structure_rules_prompt is now
// adaptive guidance keyed to content depth + intent.

export interface FormatValidationOverrides {
  min_h2?:                  number;
  max_h2?:                  number;
  /**
   * Phase 3.4 — These were `boolean` (forced). They are now optional and,
   * when set, treated as ADVISORY by downstream validation (the validator
   * surfaces a soft warning but does not fail the article).
   */
  requires_key_insights?:   boolean;
  requires_summary?:        boolean;
  requires_references?:     boolean;
  requires_list_items?:     number;   // listicle: min numbered items
  requires_steps?:          number;   // tutorial: min step count
  requires_results_section?: boolean; // case-study: must have results H2
  requires_comparison?:     boolean;  // comparison: must have comparison H2s
}

// ── Structure rules output ──────────────────────────────────────────────────

export interface StructureRules {
  structure_rules_prompt: string;
  validation_overrides:   FormatValidationOverrides;
  /**
   * Phase 3.4 — Dynamic guidance object surfaced separately so callers
   * can introspect ranges + conditional sections without parsing the prompt.
   */
  dynamic_guidance?: DynamicStructureGuidance;
}

// ── Phase 3.4: Dynamic structure guidance ───────────────────────────────────
//
// Replaces hard "MUST include N H2s / FAQ / Summary / References" mandates
// with adaptive, intent-driven recommendations. The system prompt now tells
// the model "the topic should determine structure" rather than "use this
// exact skeleton". Templates (listicle/tutorial/comparison/case-study) can
// still REQUEST a shape, but the engine will not inflate empty sections to
// satisfy a count.

export type ContentIntent =
  | 'authority'     // strategic, POV-led, short and dense beats long and thin
  | 'operational'   // practitioner-facing how-to with concrete steps
  | 'narrative'     // story-driven, freer structure
  | 'comparison'    // option weighing, must surface decision criteria
  | 'list'          // explicitly enumerative; numbered structure expected
  | 'reference';    // looked-up answer, scannable, can be terse

export interface DynamicStructureGuidance {
  /** Recommended H2 count range — advisory only, not a gate. */
  recommendedStructureRange: { min: number; max: number };
  /**
   * Sections that ARE typical for the format but only if topic depth warrants.
   * Each entry says when the section makes sense; the model decides
   * adaptively rather than always including the section.
   */
  conditionalSections: Array<{
    name: string;
    appliesWhen: string;
    skipWhen: string;
  }>;
  /**
   * Depth-aware expansion rules. Generation respects target word count but
   * does not pad — fewer sections at higher per-section depth is preferred
   * over many thin sections.
   */
  contentDepthAwareExpansion: {
    perSectionWordTarget: number;
    preferFewerDeeperSections: boolean;
    minWordsPerSection: number;
  };
  /** Intent-driven structural hints surfaced into the prompt. */
  intentAwareStructureHints: string[];
  /** The primary intent inferred for this format (or supplied by caller). */
  primaryIntent: ContentIntent;
}

// ── Main function ───────────────────────────────────────────────────────────

/**
 * Returns format-specific structure rules for prompt injection.
 * Returns null for 'standard' — caller falls through to existing logic.
 */
export function getStructureRules(
  formatType: BlogFormatType,
  targetWordCount: number,
): StructureRules | null {
  const tw = targetWordCount && targetWordCount >= 300 ? targetWordCount : 1200;

  switch (formatType) {

    case 'listicle': {
      // Listicles are inherently enumerative — the format ITSELF demands a
      // sequence of numbered items. Item count is the one structural floor
      // we keep, because removing it would invalidate the format choice.
      // Every other element (key-insights / summary / references) is now
      // adaptive: include when the topic genuinely benefits, not by rote.
      const recommendedItems = tw <= 800 ? '5–7' : tw <= 1200 ? '6–9' : '7–10';
      const minItems  = tw <= 800 ? 4 : tw <= 1200 ? 5 : 6;
      const wordsPerItem = Math.round((tw - 200) / Math.max(minItems, 5));
      return {
        structure_rules_prompt: `## LISTICLE STRUCTURE (adaptive)

This is a list-format article. Item count and depth should serve the topic — never inflate to hit a number.

- Hook intro (60–150 words). Frame why this list matters. Avoid generic openers.
- ${recommendedItems} numbered H2 items, each titled with a specific insight (e.g., "1. Specific Insight Title"). At least ${minItems} items are typical for this length.
  - Each item: H2 heading + 1–3 paragraphs (target ~${Math.max(120, wordsPerItem)} words; vary as warranted).
  - Items should build progressively, but skip items if they would be redundant.
- Closing paragraph (50–150 words): single recommendation or call to action — only if it adds value. Skip if the items already conclude themselves.

CONDITIONAL SECTIONS — include ONLY when warranted:
- Key Insights block (4–5 bullets): include if the list is long (≥ 7 items) or the reader will likely scan first. Skip for short, punchy lists.
- Summary: include only if synthesis adds new framing the items haven't already delivered.
- References section: include when claims rely on outside data, statistics, or named research. Do NOT add a references stub just for the format.

Each item must have substantive analysis — examples, data, or practitioner implications. A one-sentence item is fine only if the insight is genuinely complete in that sentence.`,
        validation_overrides: {
          max_h2:               14,
          requires_list_items:   minItems,
          // Key-insights, summary, references no longer forced.
        },
        dynamic_guidance: {
          recommendedStructureRange: { min: minItems, max: 14 },
          conditionalSections: [
            { name: 'Key Insights', appliesWhen: 'list has ≥ 7 items OR readers will scan first', skipWhen: 'short focused list (≤ 6 items)' },
            { name: 'Summary', appliesWhen: 'synthesis would add new framing', skipWhen: 'items conclude themselves' },
            { name: 'References', appliesWhen: 'claims rely on outside data/research', skipWhen: 'list is opinion or experience-driven' },
          ],
          contentDepthAwareExpansion: {
            perSectionWordTarget: Math.max(120, wordsPerItem),
            preferFewerDeeperSections: false,
            minWordsPerSection: 80,
          },
          intentAwareStructureHints: [
            'Items should be specific and actionable, not vague labels.',
            'Order items by escalating insight, not arbitrary alphabetic order.',
          ],
          primaryIntent: 'list',
        },
      };
    }

    case 'tutorial': {
      // Tutorials are operational by nature — sequential steps are
      // intrinsic to the format. We keep the step floor but let the rest
      // (Prerequisites, Common Mistakes, Summary, References, Key Insights)
      // become adaptive.
      const stepCount = tw <= 800 ? '3–4' : tw <= 1200 ? '4–5' : '5–7';
      const minSteps  = tw <= 800 ? 3 : tw <= 1200 ? 4 : 5;
      const wordsPerStep = Math.round((tw - 350) / Math.max(minSteps, 3));
      return {
        structure_rules_prompt: `## TUTORIAL STRUCTURE (adaptive, operational intent)

This is a how-to tutorial. Step depth and section count should serve the practitioner — never inflate to hit a count.

- Hook intro (80–150 words). State the problem this tutorial solves and what success looks like.
- ${stepCount} step-by-step H2 sections (e.g., "Step 1: Set Up Your Environment").
  - Each step: H2 heading + 2–4 paragraphs (~${Math.max(120, wordsPerStep)} words; deeper steps are fine when warranted).
  - Steps must be sequential and concrete — specific commands, settings, or actions.
  - Indicate what success looks like after each step when ambiguous.

CONDITIONAL SECTIONS — include ONLY when warranted:
- <h2>Prerequisites</h2>: include if the reader needs specific tools, accounts, or prior knowledge to start. Skip for tutorials that work end-to-end with no setup.
- <h2>Common Mistakes</h2>: include if the practitioner is genuinely likely to hit a pitfall worth flagging. Skip if no real pitfalls exist.
- Key Insights block: include if the tutorial has more than ~5 steps and a scannable summary helps. Skip for short focused tutorials.
- Summary: include if there is non-obvious synthesis or next-steps beyond the final step. Skip if the final step already concludes.
- References: include when steps cite or rely on outside documentation. Do not add a references stub for the format alone.

Every step must include enough detail that a practitioner can execute it without guessing.`,
        validation_overrides: {
          max_h2:               12,
          requires_steps:        minSteps,
          // Prerequisites / Common Mistakes / Key Insights / Summary / References no longer forced.
        },
        dynamic_guidance: {
          recommendedStructureRange: { min: minSteps, max: 12 },
          conditionalSections: [
            { name: 'Prerequisites', appliesWhen: 'reader needs specific setup', skipWhen: 'tutorial works end-to-end with no prep' },
            { name: 'Common Mistakes', appliesWhen: 'real pitfalls exist worth flagging', skipWhen: 'no genuine failure modes' },
            { name: 'Key Insights', appliesWhen: '> 5 steps; scannable summary helps', skipWhen: 'short focused tutorial' },
            { name: 'Summary', appliesWhen: 'non-obvious synthesis or next-steps', skipWhen: 'final step concludes naturally' },
            { name: 'References', appliesWhen: 'cites outside docs/research', skipWhen: 'fully self-contained' },
          ],
          contentDepthAwareExpansion: {
            perSectionWordTarget: Math.max(150, wordsPerStep),
            preferFewerDeeperSections: false,
            minWordsPerSection: 100,
          },
          intentAwareStructureHints: [
            'Concrete > abstract: every step must contain specific actions, commands, or settings.',
            'Validate progress: tell the reader how to know each step worked.',
          ],
          primaryIntent: 'operational',
        },
      };
    }

    case 'case-study': {
      // Case studies are narrative-around-evidence. The narrative ARC
      // (Background → Challenge → Solution → Results → Takeaways) is what
      // makes the format what it is, so we keep that as a recommended
      // structure. We drop the hard MIN H2 / forced references / forced
      // key-insights mandates and let depth follow the available evidence.
      return {
        structure_rules_prompt: `## CASE STUDY STRUCTURE (adaptive, narrative-around-evidence)

This is a case study. Lead with what changed. Depth per section should match the evidence available — never pad to hit a word target.

Recommended arc (deviate only when the topic genuinely demands it):
- Hook intro (80–150 words): lead with the result or transformation achieved.
- <h2>Background</h2>: who, what industry, starting position (~${Math.max(120, Math.round(tw * 0.10))} words).
- <h2>Challenge</h2>: specific problem + business impact + why prior approaches failed (~${Math.max(120, Math.round(tw * 0.15))} words).
- <h2>Solution</h2>: approach taken + why + key decisions (~${Math.max(150, Math.round(tw * 0.18))} words).
- <h2>Implementation</h2>: execution detail, timeline, obstacles (~${Math.max(120, Math.round(tw * 0.15))} words). Skip if Solution already covers execution end-to-end.
- <h2>Results</h2>: specific, measurable outcomes — use data points and before/after comparisons.
- <h2>Key Takeaways</h2>: lessons other practitioners can apply (3–5 takeaways is typical).

CONDITIONAL — include only when warranted:
- Key Insights block: include if results are dense and a scannable upfront block helps. Skip if the hook already does this work.
- References section: include when external research, public data, or named sources are cited. Do not add a references stub just to satisfy the format.

The Results section should contain specific numbers or measurable outcomes — quantify wherever real evidence allows. If genuine numbers are not available, write the outcome qualitatively rather than fabricating data.`,
        validation_overrides: {
          max_h2:                  10,
          requires_results_section: true,
          // Key-insights and references no longer forced.
        },
        dynamic_guidance: {
          recommendedStructureRange: { min: 4, max: 8 },
          conditionalSections: [
            { name: 'Implementation', appliesWhen: 'execution detail is non-obvious and adds value', skipWhen: 'Solution already covers execution' },
            { name: 'Key Insights', appliesWhen: 'dense results need scannable upfront block', skipWhen: 'hook does that work' },
            { name: 'References', appliesWhen: 'external research/data cited', skipWhen: 'internal experience only' },
          ],
          contentDepthAwareExpansion: {
            perSectionWordTarget: Math.round(tw / 6),
            preferFewerDeeperSections: true,
            minWordsPerSection: 120,
          },
          intentAwareStructureHints: [
            'Lead with the change, not the company name.',
            'Quantify results when real numbers exist; never fabricate data to satisfy the format.',
          ],
          primaryIntent: 'narrative',
        },
      };
    }

    case 'comparison': {
      const featureCount = tw <= 800 ? '3–4' : tw <= 1200 ? '4–5' : '5–6';
      const minFeatures  = tw <= 800 ? 2 : tw <= 1200 ? 3 : 4;
      return {
        structure_rules_prompt: `## COMPARISON STRUCTURE (adaptive, decision-led)

This is a comparison. Focus is helping the reader decide — never inflate sections to hit a count.

- Hook intro (80–150 words): frame the decision the reader faces.
- <h2>Overview</h2> (optional): introduce the options being compared. Skip if the hook already does this.
- ${featureCount} comparison H2 sections covering the dimensions that actually decide the choice (e.g., "Ease of Setup", "Pricing and Value", "Performance at Scale"). Use the dimensions that matter — at least ${minFeatures} are typical.
  - Each dimension: balanced analysis of all options; specific data points where possible; <strong> for key differences.
  - Section depth follows evidence: ~${Math.max(120, Math.round((tw - 350) / Math.max(minFeatures, 3)))} words is typical, more when warranted.
- <h2>Verdict</h2>: clear recommendation by use case — "Choose X if…", "Choose Y if…".

CONDITIONAL — include only when warranted:
- Key Insights block: include if the article is long (>1500 words) and a scannable upfront recommendation block helps. Skip for short focused comparisons.
- <h2>Pros and Cons</h2>: include when the comparison spans many small differences best summarized at the end. Skip if pros/cons are clear from the comparison sections themselves.
- References section: include when claims rely on independent benchmarks or third-party data. Do not add a references stub for the format alone.

The comparison must be balanced — present trade-offs, not winners. Avoid favoring an option without data to support it.`,
        validation_overrides: {
          max_h2:               12,
          requires_comparison:   true,
          // Key-insights and references no longer forced.
        },
        dynamic_guidance: {
          recommendedStructureRange: { min: minFeatures + 1, max: 10 },
          conditionalSections: [
            { name: 'Overview', appliesWhen: 'options need brief positioning before deep comparison', skipWhen: 'hook already positions them' },
            { name: 'Key Insights', appliesWhen: 'long comparison (>1500 words)', skipWhen: 'short focused comparison' },
            { name: 'Pros and Cons', appliesWhen: 'many small differences need final summary', skipWhen: 'differences are clear in-line' },
            { name: 'References', appliesWhen: 'independent benchmarks/data cited', skipWhen: 'opinion-led comparison' },
          ],
          contentDepthAwareExpansion: {
            perSectionWordTarget: Math.max(120, Math.round((tw - 350) / Math.max(minFeatures, 3))),
            preferFewerDeeperSections: true,
            minWordsPerSection: 100,
          },
          intentAwareStructureHints: [
            'Compare on dimensions that decide the choice, not on every possible feature.',
            'Verdict must be use-case-based ("Choose X if…"), not a universal winner.',
          ],
          primaryIntent: 'comparison',
        },
      };
    }

    case 'pillar': {
      const sectionCount = tw <= 2500 ? '5–7' : tw <= 4000 ? '6–9' : '7–10';
      const minSections  = tw <= 2500 ? 4 : tw <= 4000 ? 5 : 6;
      const wordsPerSection = Math.round((tw - 400) / Math.max(minSections, 5));
      return {
        structure_rules_prompt: `## GUIDE / PILLAR CONTENT STRUCTURE (adaptive, depth-led)

This is a comprehensive guide. Prefer FEWER, DEEPER sections over MANY thin sections — depth follows the topic, not a section count.

- <h2>Introduction</h2>: What this guide covers and who it's for (~150–250 words). Frame the scope explicitly.
- ${sectionCount} deep H2 sections — each a substantive chapter:
  - Section depth target: ~${Math.max(200, wordsPerSection)} words. Vary as the topic warrants.
  - H3 sub-headings only when they genuinely break down a complex idea. Do not subdivide for the sake of subdivision.
  - Concrete examples, data points, frameworks, and actionable advice. <blockquote> only when the line earns it as a quote-worthy definition or insight.

CONDITIONAL — include only when warranted:
- Key Insights block: include if the guide is >2500 words AND a scannable upfront block helps readers who'll come back to specific sections. Skip for shorter focused guides.
- <h2>Summary</h2>: include if synthesis or next-actions go beyond what the closing section already delivers. Skip if the final section concludes naturally.
- References section: include when external research, standards, or authoritative sources are cited. Do not add a references stub to satisfy the format.

QUALITY REQUIREMENTS:
- Each section must earn its place — substantive enough to stand as its own article. If a section can't, merge it with a stronger neighbor.
- Build progressively: foundational concepts first, then advanced strategies.
- Cross-reference between sections only when the reference adds value ("Building on the framework above..." rather than mechanical signposting).
- Use <blockquote> for genuinely quote-worthy lines, not as decoration.`,
        validation_overrides: {
          max_h2:               14,
          // Key-insights / Summary / References / min H2 no longer forced.
        },
        dynamic_guidance: {
          recommendedStructureRange: { min: minSections, max: 12 },
          conditionalSections: [
            { name: 'Key Insights', appliesWhen: '>2500 words and readers will scan or return', skipWhen: 'shorter focused guide' },
            { name: 'Summary', appliesWhen: 'synthesis goes beyond what final section delivers', skipWhen: 'final section concludes naturally' },
            { name: 'References', appliesWhen: 'external research/standards cited', skipWhen: 'experience-driven guide' },
          ],
          contentDepthAwareExpansion: {
            perSectionWordTarget: Math.max(200, wordsPerSection),
            preferFewerDeeperSections: true,
            minWordsPerSection: 150,
          },
          intentAwareStructureHints: [
            'Depth over breadth: 5 deep sections beats 9 thin ones.',
            'H3 sub-headings only when they break down genuine complexity.',
            'Blockquotes earn their place by being quotable — not by adding decoration.',
          ],
          primaryIntent: 'authority',
        },
      };
    }

    case 'standard':
    default:
      // Return null — caller uses existing hardcoded structure logic unchanged
      return null;
  }
}

// ── Helper: check if format is valid ────────────────────────────────────────

export function isValidBlogFormat(value: unknown): value is BlogFormatType {
  return typeof value === 'string' && ['standard', 'listicle', 'tutorial', 'case-study', 'comparison', 'pillar'].includes(value);
}

// ══════════════════════════════════════════════════════════════════════════════
// Article Format Types (separate from blog — journalistic, with quotes/highlights)
// ══════════════════════════════════════════════════════════════════════════════

export type ArticleFormatType =
  | 'narrative'
  | 'investigative'
  | 'opinion';

export const ARTICLE_FORMAT_OPTIONS: { value: ArticleFormatType; label: string; description: string; wordRange: string }[] = [
  { value: 'narrative',      label: 'Narrative',      description: 'Story-driven with expert quotes, highlighted insights, and a clear arc', wordRange: '1,200–2,000 words' },
  { value: 'investigative',  label: 'Investigative',  description: 'Evidence-first deep-dive with data callouts, sourced quotes, and findings', wordRange: '1,600–2,500 words' },
  { value: 'opinion',        label: 'Opinion / Editorial', description: 'Perspective-led with counterpoints, pull quotes, and a strong thesis', wordRange: '1,200–1,800 words' },
];

export function isValidArticleFormat(value: unknown): value is ArticleFormatType {
  return typeof value === 'string' && ['narrative', 'investigative', 'opinion'].includes(value);
}

/**
 * Returns article-specific structure rules for prompt injection.
 * All article formats mandate blockquotes and highlighted insight callouts.
 */
export function getArticleStructureRules(
  formatType: ArticleFormatType,
  targetWordCount: number,
): StructureRules {
  const tw = targetWordCount && targetWordCount >= 300 ? targetWordCount : 1600;

  const ARTICLE_COMMON = `
## ARTICLE-WIDE FORMATTING REQUIREMENTS
- Include **at least 2 blockquote elements** (<blockquote>) — use them for:
  - Expert quotes or attributed insights (real or plausible).
  - Pull quotes that summarise a key paragraph into one sentence.
- Include **at least 1 highlighted-insight callout** per major section — format as:
  <blockquote><strong>Key insight:</strong> One-sentence distillation of the section's most important point.</blockquote>
- Do NOT place all quotes at the end. Distribute them naturally within the flow.
- Avoid generic filler quotes. Every quote must add a specific data point, perspective, or nuance.`;

  switch (formatType) {

    case 'narrative': {
      const sections = tw <= 1200 ? '3–4' : tw <= 1600 ? '4–5' : '5–7';
      return {
        structure_rules_prompt: `## NARRATIVE ARTICLE STRUCTURE (mandatory)

- Opening hook (120–180 words): Start with a scene, anecdote, or surprising fact that draws the reader in. Do NOT open with a question.
- Thesis paragraph: One clear sentence stating the article's central argument.
- ${sections} H2 sections — each section advances the narrative arc:
  - Each H2: 2–4 paragraphs with concrete examples, data, or expert perspective.
  - Include at least one <blockquote> with an expert quote per every 2 sections.
  - Include at least one <blockquote><strong>Key insight:</strong> ...</blockquote> per section.
- Closing section (150–200 words): Synthesises the narrative, returns to the opening hook, and offers a forward-looking insight.
- References (minimum 4 real sources)
${ARTICLE_COMMON}`,
        validation_overrides: {
          min_h2: tw <= 1200 ? 3 : 4,
          max_h2: 8,
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary: false, // Phase 3.4 — advisory only, never forced
          requires_references: false, // Phase 3.4 — advisory only, never forced
        },
      };
    }

    case 'investigative': {
      const findingsCount = tw <= 1200 ? '3' : tw <= 1600 ? '4' : '5';
      return {
        structure_rules_prompt: `## INVESTIGATIVE ARTICLE STRUCTURE (mandatory)

- <h2>Executive Summary</h2>: 3–5 bullet points of the key findings — standalone value, no filler.
- Opening (120–150 words): State what was investigated and why it matters NOW.
- <h2>Background & Context</h2>: History, market context, or regulatory landscape (${Math.max(200, Math.round(tw * 0.15))}+ words).
- ${findingsCount} Findings sections — each an H2 (e.g., "Finding 1: ...", "Finding 2: ..."):
  - Each finding: H2 heading + 2–4 paragraphs with sourced evidence.
  - At least one <blockquote> with a data callout or expert attribution per finding.
  - At least one <blockquote><strong>Key insight:</strong> ...</blockquote> per finding.
- <h2>Implications</h2>: What these findings mean for practitioners/industry (${Math.max(150, Math.round(tw * 0.12))}+ words).
- <h2>What Comes Next</h2>: Forward-looking analysis — trends, expected developments.
- References (minimum 5 real sources — reports, studies, official data)
${ARTICLE_COMMON}`,
        validation_overrides: {
          min_h2: parseInt(findingsCount) + 3, // findings + background + implications + what's next
          max_h2: 10,
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary: false,
          requires_references: false, // Phase 3.4 — advisory only, never forced
        },
      };
    }

    case 'opinion': {
      return {
        structure_rules_prompt: `## OPINION / EDITORIAL ARTICLE STRUCTURE (mandatory)

- Bold opening (100–150 words): State your thesis clearly and provocatively. Take a position.
- <h2>The Conventional View</h2>: Fairly represent the mainstream perspective. Use a <blockquote> to quote a prominent defender of this view.
- <h2>Why It's Wrong</h2> (or "Why It's Incomplete"): Dismantle with evidence. Include data, examples, or case studies.
  - Include a <blockquote><strong>Key insight:</strong> ...</blockquote> capturing the core counter-argument.
- <h2>The Better Framework</h2>: Present your alternative with specific, actionable detail (${Math.max(250, Math.round(tw * 0.25))}+ words).
  - Include at least one <blockquote> with supporting expert opinion or data.
  - Include a <blockquote><strong>Key insight:</strong> ...</blockquote> with the new framework's core principle.
- <h2>Implications & What To Do Now</h2>: 3–5 specific actions the reader should take.
- Closing paragraph (80–120 words): Restate thesis, acknowledge trade-offs, end with conviction.
- References (minimum 4 real sources — including at least 1 opposing source)
${ARTICLE_COMMON}`,
        validation_overrides: {
          min_h2: 4,
          max_h2: 7,
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary: false, // Phase 3.4 — advisory only, never forced
          requires_references: false, // Phase 3.4 — advisory only, never forced
        },
      };
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Whitepaper Format Types (long-form, research-grade, authority-driven)
// ══════════════════════════════════════════════════════════════════════════════

export type WhitepaperFormatType =
  | 'research'
  | 'strategic'
  | 'technical';

export const WHITEPAPER_FORMAT_OPTIONS: { value: WhitepaperFormatType; label: string; description: string; wordRange: string }[] = [
  { value: 'research',   label: 'Research Report',       description: 'Data-driven findings with methodology, evidence sections, and cited conclusions', wordRange: '2,500–4,000 words' },
  { value: 'strategic',  label: 'Strategic Brief',       description: 'Executive-level framework with market analysis, recommendations, and roadmap', wordRange: '2,000–3,500 words' },
  { value: 'technical',  label: 'Technical Deep-Dive',   description: 'Architecture-level detail with diagrams, implementation guidance, and benchmarks', wordRange: '3,000–5,000 words' },
];

export function isValidWhitepaperFormat(value: unknown): value is WhitepaperFormatType {
  return typeof value === 'string' && ['research', 'strategic', 'technical'].includes(value);
}

/**
 * Returns whitepaper-specific structure rules for prompt injection.
 * All whitepaper formats require executive summary, citations, and formal tone.
 */
export function getWhitepaperStructureRules(
  formatType: WhitepaperFormatType,
  targetWordCount: number,
): StructureRules {
  const tw = targetWordCount && targetWordCount >= 300 ? targetWordCount : 2500;

  const WP_COMMON = `
## WHITEPAPER-WIDE FORMATTING REQUIREMENTS
- Begin with an **Executive Summary** (150–250 words) that can standalone as a shareable abstract.
- Include **at least 3 blockquote callouts** (<blockquote>) distributed through the body for:
  - Key statistics or data findings (<blockquote><strong>Key finding:</strong> ...</blockquote>)
  - Expert or source attributions
  - Critical recommendations
- Use **numbered or bulleted lists** for frameworks, steps, and criteria — whitepapers demand scannable structure.
- End every major section with a **one-sentence takeaway** in bold.
- References section MUST contain **minimum 5 real, specific citations** (reports, studies, standards, docs).
- Maintain formal, third-person tone throughout. No casual language, no first-person narrative.`;

  switch (formatType) {

    case 'research': {
      const findingsCount = tw <= 2000 ? '3–4' : tw <= 3000 ? '4–5' : '5–7';
      return {
        structure_rules_prompt: `## RESEARCH REPORT STRUCTURE (mandatory)

- <h2>Executive Summary</h2>: 150–250 words. State the research question, methodology, key findings, and primary recommendation.
- <h2>Introduction & Background</h2>: Frame the problem, why it matters now, market context (${Math.max(200, Math.round(tw * 0.1))}+ words).
- <h2>Methodology</h2>: How data was gathered, what was analyzed, limitations (${Math.max(150, Math.round(tw * 0.08))}+ words).
- ${findingsCount} Findings sections — each an H2 (e.g., "Finding 1: Market Adoption Exceeds Expectations"):
  - Each finding: H2 + 3–5 paragraphs with sourced evidence, data points, and analysis.
  - Include <blockquote><strong>Key finding:</strong> ...</blockquote> per finding.
  - Reference specific data (percentages, dollar figures, time ranges).
- <h2>Analysis & Implications</h2>: Cross-cutting themes, what the findings mean together (${Math.max(200, Math.round(tw * 0.12))}+ words).
- <h2>Recommendations</h2>: 3–5 specific, prioritized actions based on evidence (${Math.max(200, Math.round(tw * 0.1))}+ words).
- <h2>Conclusion</h2>: Restate the core insight, forward-looking statement.
- References (minimum 5 citations — academic papers, industry reports, official data)
${WP_COMMON}`,
        validation_overrides: {
          min_h2: 7,
          max_h2: 12,
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary: false,
          requires_references: false, // Phase 3.4 — advisory only, never forced
        },
      };
    }

    case 'strategic': {
      return {
        structure_rules_prompt: `## STRATEGIC BRIEF STRUCTURE (mandatory)

- <h2>Executive Summary</h2>: 150–250 words. The decision-maker should get the full picture from this alone.
- <h2>Market Context</h2>: Current state, macro trends, competitive landscape (${Math.max(250, Math.round(tw * 0.12))}+ words).
  - Include a <blockquote><strong>Key finding:</strong> ...</blockquote> with the most critical market data point.
- <h2>Problem Statement</h2>: What strategic challenge this addresses, cost of inaction (${Math.max(200, Math.round(tw * 0.1))}+ words).
- <h2>Strategic Framework</h2>: Your proposed model/approach — use a numbered framework with 3–5 pillars/phases (${Math.max(300, Math.round(tw * 0.2))}+ words).
  - Each pillar: sub-heading (H3) + rationale + implementation guidance.
  - Include <blockquote><strong>Key finding:</strong> ...</blockquote> for the most impactful pillar.
- <h2>Implementation Roadmap</h2>: Phased timeline (30/60/90 day or Q1/Q2/Q3), resource requirements, KPIs (${Math.max(250, Math.round(tw * 0.12))}+ words).
- <h2>Risk Assessment</h2>: 3–5 risks with mitigation strategies.
- <h2>Expected Outcomes</h2>: Quantified projections, ROI indicators, success criteria.
- <h2>Conclusion & Next Steps</h2>: Call to action for decision-makers.
- References (minimum 5 citations — market reports, analyst research, case studies)
${WP_COMMON}`,
        validation_overrides: {
          min_h2: 8,
          max_h2: 11,
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary: false,
          requires_references: false, // Phase 3.4 — advisory only, never forced
        },
      };
    }

    case 'technical': {
      const componentCount = tw <= 2000 ? '3–4' : tw <= 3000 ? '4–5' : '5–6';
      return {
        structure_rules_prompt: `## TECHNICAL DEEP-DIVE STRUCTURE (mandatory)

- <h2>Executive Summary</h2>: 150–200 words. State what technology/approach is covered and the primary recommendation.
- <h2>Technical Background</h2>: Architecture context, current state, why this matters technically (${Math.max(200, Math.round(tw * 0.1))}+ words).
- <h2>Problem Analysis</h2>: Technical challenges, performance bottlenecks, scalability issues — be specific (${Math.max(200, Math.round(tw * 0.1))}+ words).
  - Include <blockquote><strong>Key finding:</strong> ...</blockquote> with the most critical technical constraint.
- ${componentCount} Solution sections — each an H2 covering a technical component/layer:
  - Each section: H2 + detailed explanation with architecture decisions, trade-offs, benchmarks.
  - Include code patterns, configuration examples, or pseudocode where helpful.
  - Include <blockquote><strong>Key finding:</strong> ...</blockquote> per component.
- <h2>Benchmarks & Performance</h2>: Quantified comparisons — latency, throughput, cost, reliability (${Math.max(200, Math.round(tw * 0.12))}+ words).
- <h2>Implementation Guide</h2>: Step-by-step deployment/adoption guidance, prerequisites, dependencies.
- <h2>Conclusion</h2>: Summary of recommended approach, expected outcomes.
- References (minimum 5 citations — documentation, RFCs, benchmarks, technical papers)
${WP_COMMON}`,
        validation_overrides: {
          min_h2: 8,
          max_h2: 12,
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary: false,
          requires_references: false, // Phase 3.4 — advisory only, never forced
        },
      };
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Newsletter Format Types (audience-focused, engagement-driven, recurring)
// ══════════════════════════════════════════════════════════════════════════════

