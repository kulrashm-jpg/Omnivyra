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

export interface FormatValidationOverrides {
  min_h2?:                  number;
  max_h2?:                  number;
  requires_key_insights:    boolean;
  requires_summary:         boolean;
  requires_references:      boolean;
  requires_list_items?:     number;   // listicle: min numbered items
  requires_steps?:          number;   // tutorial: min step count
  requires_results_section?: boolean; // case-study: must have results H2
  requires_comparison?:     boolean;  // comparison: must have comparison H2s
}

// ── Structure rules output ──────────────────────────────────────────────────

export interface StructureRules {
  structure_rules_prompt: string;
  validation_overrides:   FormatValidationOverrides;
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
      const itemCount = tw <= 800 ? '5–7' : tw <= 1200 ? '7–9' : '8–10';
      const minItems  = tw <= 800 ? 5 : tw <= 1200 ? 7 : 8;
      const wordsPerItem = Math.round((tw - 250) / minItems); // subtract intro/summary overhead
      return {
        structure_rules_prompt: `## LISTICLE STRUCTURE (mandatory)

- Key Insights block (4–5 bullet points, standalone value)
- Hook intro (100–150 words, frames why this list matters — NOT a question)
- ${itemCount} numbered H2 items (e.g., "1. Specific Insight Title", "2. Another Insight")
  - Each item: H2 heading + 2–3 paragraphs (${Math.max(100, wordsPerItem)}+ words per item)
  - Each item must be a standalone, actionable insight — not a vague label
  - Items should build progressively (easiest → hardest, or most obvious → most surprising)
- Summary (100–150 words, distills the most important items and tells the reader what to do next)
- References section (minimum 3 real sources)

Each numbered item MUST have substantive analysis — not just a heading and one sentence. Include examples, data, or practitioner implications.`,
        validation_overrides: {
          min_h2:                minItems,
          max_h2:               12,
          requires_key_insights: true,
          requires_summary:      true,
          requires_references:   true,
          requires_list_items:   minItems,
        },
      };
    }

    case 'tutorial': {
      const stepCount = tw <= 800 ? '3–4' : tw <= 1200 ? '4–5' : '5–7';
      const minSteps  = tw <= 800 ? 3 : tw <= 1200 ? 4 : 5;
      const wordsPerStep = Math.round((tw - 400) / minSteps); // subtract overhead for intro, prereqs, mistakes, summary
      return {
        structure_rules_prompt: `## TUTORIAL STRUCTURE (mandatory)

- Key Insights block (4–5 bullet points, what the reader will learn)
- Hook intro (100–150 words, states the problem this tutorial solves — NOT a question)
- <h2>Prerequisites</h2> section (what the reader needs before starting — tools, knowledge, access)
- ${stepCount} step-by-step H2 sections (e.g., "Step 1: Set Up Your Environment", "Step 2: Configure the Pipeline")
  - Each step: H2 heading + 2–4 paragraphs (${Math.max(120, wordsPerStep)}+ words per step)
  - Steps must be sequential — each builds on the previous
  - Include specific commands, settings, or actions the reader must take
  - Where relevant, include what success looks like after completing each step
- <h2>Common Mistakes</h2> section (3–5 mistakes with explanations of why they happen and how to avoid them)
- Summary (100–150 words, confirms what was built/achieved and suggests next steps)
- References section (minimum 3 real sources — documentation, guides, authoritative articles)

Every step MUST include enough detail that a practitioner can execute it without guessing.`,
        validation_overrides: {
          min_h2:                minSteps + 2, // steps + prerequisites + common mistakes
          max_h2:               10,
          requires_key_insights: true,
          requires_summary:      true,
          requires_references:   true,
          requires_steps:        minSteps,
        },
      };
    }

    case 'case-study': {
      return {
        structure_rules_prompt: `## CASE STUDY STRUCTURE (mandatory)

- Key Insights block (4–5 bullet points, the key findings and results)
- Hook intro (100–150 words, leads with the result or transformation achieved — NOT a question)
- <h2>Background</h2> (who, what industry, starting position, context — ${Math.max(150, Math.round(tw * 0.12))}+ words)
- <h2>Challenge</h2> (the specific problem, its business impact, why previous approaches failed — ${Math.max(150, Math.round(tw * 0.15))}+ words)
- <h2>Solution</h2> (the approach taken, why it was chosen, key decisions made — ${Math.max(200, Math.round(tw * 0.2))}+ words)
- <h2>Implementation</h2> (how it was executed, timeline, resources, obstacles overcome — ${Math.max(150, Math.round(tw * 0.15))}+ words)
- <h2>Results</h2> (specific, measurable outcomes — use data points, percentages, before/after comparisons. Include blockquotes for key metrics — ${Math.max(150, Math.round(tw * 0.15))}+ words)
- <h2>Key Takeaways</h2> (3–5 actionable lessons other practitioners can apply — ${Math.max(100, Math.round(tw * 0.1))}+ words)
- References section (minimum 3 real sources)

The Results section MUST contain specific numbers or measurable outcomes. Do not use vague claims like "significant improvement" — quantify everything.`,
        validation_overrides: {
          min_h2:                  6,
          max_h2:                  8,
          requires_key_insights:   true,
          requires_summary:        false, // case studies use Key Takeaways instead
          requires_references:     true,
          requires_results_section: true,
        },
      };
    }

    case 'comparison': {
      const featureCount = tw <= 800 ? '3–4' : tw <= 1200 ? '4–5' : '5–6';
      const minFeatures  = tw <= 800 ? 3 : tw <= 1200 ? 4 : 5;
      return {
        structure_rules_prompt: `## COMPARISON STRUCTURE (mandatory)

- Key Insights block (4–5 bullet points, the key differentiators and recommendation)
- Hook intro (100–150 words, frames the decision the reader faces — NOT a question)
- <h2>Overview</h2> (introduce the options being compared, their positioning, and target audience — ${Math.max(150, Math.round(tw * 0.12))}+ words)
- ${featureCount} comparison H2 sections (e.g., "Ease of Setup", "Pricing and Value", "Performance at Scale")
  - Each comparison: H2 heading + balanced analysis of both/all options
  - Use <strong> to highlight key differences
  - Include specific data points, not just opinions
  - Each section: ${Math.max(120, Math.round((tw - 400) / minFeatures))}+ words
- <h2>Pros and Cons</h2> (clear bullet lists for each option — use <ul> with pros and cons labeled)
- <h2>Verdict</h2> (clear recommendation based on use case — "Choose X if...", "Choose Y if..." — ${Math.max(100, Math.round(tw * 0.1))}+ words)
- References section (minimum 3 real sources — product docs, independent reviews, benchmarks)

The comparison MUST be balanced. Avoid favoring one option without data to support it. Present trade-offs, not winners.`,
        validation_overrides: {
          min_h2:                minFeatures + 3, // features + overview + pros/cons + verdict
          max_h2:               10,
          requires_key_insights: true,
          requires_summary:      false, // comparisons use Verdict instead
          requires_references:   true,
          requires_comparison:   true,
        },
      };
    }

    case 'pillar': {
      const sectionCount = tw <= 2500 ? '5–7' : tw <= 4000 ? '7–9' : '8–10';
      const minSections  = tw <= 2500 ? 5 : tw <= 4000 ? 7 : 8;
      const wordsPerSection = Math.round((tw - 500) / minSections); // subtract intro/summary/insights overhead
      return {
        structure_rules_prompt: `## GUIDE / PILLAR CONTENT STRUCTURE (mandatory)

This is a COMPLETE GUIDE. Depth over brevity. Write comprehensive, in-depth explanations. Assume the reader wants full understanding. Avoid surface-level content.

- Key Insights block (5–7 bullet points, each a standalone takeaway for scanners)
- <h2>Introduction</h2>: What this guide covers, who it's for, and what the reader will gain (150–250 words). Frame the scope clearly.
- ${sectionCount} deep H2 sections — each a comprehensive chapter of the guide:
  - Each section: H2 heading + 3–6 paragraphs (${Math.max(200, wordsPerSection)}+ words per section)
  - Use H3 sub-headings within sections to break down complex ideas (2–4 H3s per H2)
  - Include concrete examples, data points, frameworks, and actionable advice in every section
  - Naturally distribute target keywords across section headings and body text
  - Use <blockquote> for key definitions, expert insights, or critical data points (at least 1 per major section)
- <h2>Summary</h2>: Synthesize the guide's core message, key takeaways, and recommended next actions (150–200 words)
- References section (minimum 5 authoritative sources with URLs)

QUALITY REQUIREMENTS:
- Each section must be substantive enough to stand as its own article — this is pillar content
- Build progressively: foundational concepts first, then advanced strategies
- Cross-reference between sections ("As discussed in Section 2..." or "Building on the framework above...")
- Include at least 2–3 blockquotes for quotable insights throughout the guide`,
        validation_overrides: {
          min_h2:                minSections + 1, // sections + summary
          max_h2:               12,
          requires_key_insights: true,
          requires_summary:      true,
          requires_references:   true,
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
          requires_key_insights: true,
          requires_summary: true,
          requires_references: true,
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
          requires_key_insights: true,
          requires_summary: false,
          requires_references: true,
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
          requires_key_insights: true,
          requires_summary: true,
          requires_references: true,
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
          requires_key_insights: true,
          requires_summary: false,
          requires_references: true,
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
          requires_key_insights: true,
          requires_summary: false,
          requires_references: true,
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
          requires_key_insights: true,
          requires_summary: false,
          requires_references: true,
        },
      };
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Newsletter Format Types (audience-focused, engagement-driven, recurring)
// ══════════════════════════════════════════════════════════════════════════════

export type NewsletterFormatType =
  | 'insight-letter'
  | 'weekly-brief'
  | 'strategic-letter'
  | 'action-letter';

export const LEGACY_NEWSLETTER_FORMAT_OPTIONS: Array<{ value: string; label: string; description: string; wordRange: string }> = [
  { value: 'curated',   label: 'Curated Roundup',    description: 'Curated industry news, trends, and resources with original commentary', wordRange: '800–1,500 words' },
  { value: 'editorial', label: 'Editorial',           description: 'Opinion-driven newsletter with a central thesis, analysis, and takeaways', wordRange: '1,200–2,000 words' },
  { value: 'digest',    label: 'Quick Digest',        description: 'Scannable digest with short summaries, key stats, and action items', wordRange: '600–1,000 words' },
];

export const NEWSLETTER_FORMAT_OPTIONS: { value: NewsletterFormatType; label: string; description: string; wordRange: string }[] = [
  { value: 'insight-letter',   label: 'Share a Deep Idea',          description: 'Original thinking with a sharp insight, deeper frame, and memorable close', wordRange: '800-1,600 words' },
  { value: 'weekly-brief',     label: 'Break Down the Week',        description: 'Curated signals with interpretation, pattern recognition, and quick takes', wordRange: '800-1,600 words' },
  { value: 'strategic-letter', label: 'Analyze a Market Shift',     description: 'Strategy-led market analysis focused on leverage, positioning, and decisive moves', wordRange: '1,200-2,000 words' },
  { value: 'action-letter',    label: 'Teach Something Actionable', description: 'Highly practical operator-style guidance with framework, breakdown, and immediate CTA', wordRange: '800-1,600 words' },
];

export function isValidNewsletterFormat(value: unknown): value is NewsletterFormatType {
  return typeof value === 'string' && ['insight-letter', 'weekly-brief', 'strategic-letter', 'action-letter'].includes(value);
}

/**
 * Returns newsletter-specific structure rules for prompt injection.
 * Newsletters emphasize audience engagement, scannability, and recurring value.
 */
export function getNewsletterStructureRules(
  formatType: NewsletterFormatType,
  targetWordCount: number,
): StructureRules {
  const tw = targetWordCount && targetWordCount >= 300 ? targetWordCount : 1200;

  const NL_COMMON = `
## NEWSLETTER-WIDE FORMATTING REQUIREMENTS
- Write in a **conversational, direct tone** — like a trusted colleague sharing insights over coffee.
- Use **second person** ("you", "your") to create intimacy with the reader.
- Every section must deliver **standalone value** — readers skim newsletters, so each section should reward scanning.
- Include **at least 1 blockquote** (<blockquote>) for a key stat, expert quote, or critical takeaway.
- Use **bold text** for key phrases, stats, and action items to aid scanning.
- End with a clear **call-to-action** — reply, share, visit a link, or try something specific.
- Keep paragraphs SHORT (2–4 sentences max). Newsletters are read on mobile.`;

  switch (formatType) {

    case 'insight-letter': {
      return {
        structure_rules_prompt: `## INSIGHT LETTER STRUCTURE (mandatory)

- Key Insights block: 3-5 standalone, quotable takeaways that make the letter scannable and extractable.
- <h2>Hook</h2>: Open with a contrarian observation or sharp insight.
- <h2>Context</h2>: Explain why this matters now and what tension makes it timely.
- <h2>Insight</h2>: Develop the core idea using original thinking, analogy, or a mental model.
- <h2>Expansion</h2>: Add a second layer, edge case, or deeper frame that sharpens the idea.
- <h2>Implication</h2>: Explain what changes in the reader's thinking, decisions, or behavior.
- <h2>Closing</h2>: End with a memorable line that lands the thesis.
- Summary block: Distill the thesis, changed lens, and one practical implication in a clean synthesis.

GENERATION RULES:
- Avoid summarization.
- Focus on original thinking.
- Use analogies and mental models.
- No curation or links.
- Include at least 1 sharp quote or callout-worthy line that can stand alone in inbox previews or AI extraction.
${NL_COMMON}`,
        validation_overrides: {
          min_h2:                6,
          max_h2:                6,
          requires_key_insights: true,
          requires_summary:      true,
          requires_references:   false,
        },
      };
    }

    case 'weekly-brief': {
      const signalCount = tw <= 800 ? '3' : tw <= 1200 ? '4' : '5';
      return {
        structure_rules_prompt: `## WEEKLY BRIEF STRUCTURE (mandatory)

- <h2>Week Summary</h2>: 2-3 lines on the defining takeaway from the week.
- <h2>Top Signals</h2>: Cover ${signalCount} major signals. For each one, explain what happened and why it matters.
- <h2>Pattern</h2>: Connect the dots across the signals and explain the emerging theme.
- <h2>Quick Takes</h2>: Add concise bullet-style insights or reactions worth scanning.
- <h2>Closing</h2>: End with a purposeful sign-off or next observation to watch.
- Summary block: Distill the defining pattern, why it matters, and what readers should keep watching.
- References block: Include source links, reports, or cited items that anchor the signals.

GENERATION RULES:
- Prioritize signal over noise.
- Always include interpretation.
- Avoid raw dumping of information.
${NL_COMMON}`,
        validation_overrides: {
          min_h2:                5,
          max_h2:                5,
          requires_key_insights: true,
          requires_summary:      true,
          requires_references:   true,
        },
      };
    }

    case 'strategic-letter': {
      return {
        structure_rules_prompt: `## STRATEGIC LETTER STRUCTURE (mandatory)

- <h2>Situation</h2>: Set the market context the reader is navigating.
- <h2>Shift</h2>: Identify the non-obvious change that matters more than most people realize.
- <h2>Analysis</h2>: Break down the forces, constraints, and leverage points.
- <h2>Positioning</h2>: Explain where the opportunity sits and how strong players should frame it.
- <h2>Strategic Moves</h2>: Lay out the concrete decisions, bets, or moves to make.
- <h2>Thesis</h2>: End with a strong strategic conclusion.
- Summary block: Distill the shift, the positioning implication, and the key decision leaders should consider.
- References block: Include cited market signals, reports, or examples that strengthen authority.

GENERATION RULES:
- Focus on leverage and positioning.
- Avoid generic advice.
- Write like a strategy consultant.
${NL_COMMON}`,
        validation_overrides: {
          min_h2:                6,
          max_h2:                6,
          requires_key_insights: true,
          requires_summary:      true,
          requires_references:   true,
        },
      };
    }

    case 'action-letter': {
      return {
        structure_rules_prompt: `## ACTION LETTER STRUCTURE (mandatory)

- <h2>Problem</h2>: Define the concrete issue or execution gap.
- <h2>Outcome</h2>: Clarify the target result and what success looks like.
- <h2>Framework</h2>: Present the step-by-step framework at a high level.
- <h2>Breakdown</h2>: Explain each step clearly so the reader can execute without guesswork.
- <h2>Mistakes</h2>: Call out the common errors or traps to avoid.
- <h2>CTA</h2>: End with immediate action the reader can take next.
- Summary block: Reinforce the workflow, what good execution looks like, and the first step to take.
- References block: Include examples, tools, or supporting resources when they materially help execution.

GENERATION RULES:
- Stay highly practical.
- Prioritize step-by-step clarity.
- Avoid abstract thinking.
${NL_COMMON}`,
        validation_overrides: {
          min_h2:                6,
          max_h2:                6,
          requires_key_insights: true,
          requires_summary:      true,
          requires_references:   true,
        },
      };
    }

    case 'curated': {
      const itemCount = tw <= 800 ? '4–5' : tw <= 1200 ? '5–6' : '6–8';
      const minItems  = tw <= 800 ? 4 : tw <= 1200 ? 5 : 6;
      const wordsPerItem = Math.round((tw - 300) / minItems);
      return {
        structure_rules_prompt: `## CURATED ROUNDUP NEWSLETTER STRUCTURE (mandatory)

- <h2>This Week's Theme</h2>: Opening framing (80–120 words) — what connects all the items and why it matters NOW.
- ${itemCount} curated H2 sections — each a distinct item/topic:
  - Each item: H2 heading (specific, benefit-driven) + 2–3 paragraphs (${Math.max(100, wordsPerItem)}+ words per item)
  - Structure per item: What happened/what it is → Why it matters → Your take / what to do about it
  - Include the source or context for each item (link, report, announcement)
  - Add original commentary — don't just summarize, add YOUR perspective
- <h2>Quick Hits</h2>: 3–5 one-liner items that didn't make the main list but are worth noting
- <h2>Action Items</h2>: 2–3 specific things the reader should do this week based on the content
- References section (minimum 3 sources linked)
${NL_COMMON}`,
        validation_overrides: {
          min_h2:                minItems + 2, // items + quick hits + action items
          max_h2:               12,
          requires_key_insights: true,
          requires_summary:      false,
          requires_references:   true,
        },
      };
    }

    case 'editorial': {
      const sections = tw <= 800 ? '3–4' : tw <= 1200 ? '4–5' : '5–6';
      const minSections = tw <= 800 ? 3 : tw <= 1200 ? 4 : 5;
      return {
        structure_rules_prompt: `## EDITORIAL NEWSLETTER STRUCTURE (mandatory)

- Opening hook (80–120 words): State your thesis clearly. Take a position. Why should the reader care RIGHT NOW?
- ${sections} H2 sections — each builds your argument:
  - Each section: H2 heading + 2–3 paragraphs (${Math.max(120, Math.round((tw - 300) / minSections))}+ words per section)
  - Include evidence, examples, or data to support each point
  - Use <blockquote> for key stats or expert quotes (at least 1 per newsletter)
  - Build progressively: context → evidence → implications → what to do
- <h2>The Bottom Line</h2>: 2–3 sentences distilling your core message and why it changes what the reader should do
- <h2>What To Do Next</h2>: 2–3 specific, actionable steps the reader can take
- References section (minimum 2 sources)
${NL_COMMON}`,
        validation_overrides: {
          min_h2:                minSections + 2, // sections + bottom line + next steps
          max_h2:               9,
          requires_key_insights: true,
          requires_summary:      false,
          requires_references:   true,
        },
      };
    }

    case 'digest': {
      const itemCount = tw <= 800 ? '5–6' : tw <= 1200 ? '6–8' : '8–10';
      const minItems  = tw <= 800 ? 5 : tw <= 1200 ? 6 : 8;
      return {
        structure_rules_prompt: `## QUICK DIGEST NEWSLETTER STRUCTURE (mandatory)

This is a FAST-READ format. Brevity is king. Each item should take < 30 seconds to read.

- <h2>TL;DR</h2>: 3–5 bullet points covering the most important items — standalone value for readers who only read this section.
- ${itemCount} digest H2 sections — each a standalone item:
  - Each item: H2 heading (specific, punchy) + 1–2 short paragraphs (80–150 words max per item)
  - Format per item: **Key stat or hook in bold** → 2–3 sentence explanation → One-line takeaway
  - Vary topics: mix industry news, tools, insights, and contrarian takes
  - Use emoji sparingly for visual scanning (1 per heading max)
- <h2>One Thing To Try</h2>: A single, specific, actionable recommendation (50–80 words)
- References section (minimum 3 sources)
${NL_COMMON}`,
        validation_overrides: {
          min_h2:                minItems + 2, // items + TL;DR + one thing
          max_h2:               14,
          requires_key_insights: true,
          requires_summary:      false,
          requires_references:   true,
        },
      };
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Story Format Types (narrative-driven, emotional, brand storytelling)
// ══════════════════════════════════════════════════════════════════════════════

export type StoryFormatType =
  | 'short_story'
  | 'long_story'
  | 'episodic_story';

export const STORY_FORMAT_OPTIONS: { value: StoryFormatType; label: string; description: string; wordRange: string }[] = [
  { value: 'short_story',    label: 'Short Story',       description: 'Compact narrative with emotional hook, rising tension, and resolution', wordRange: '400–900 words' },
  { value: 'long_story',     label: 'Long Story',        description: 'Deep narrative with character development, multiple scenes, and layered themes', wordRange: '1,200–2,500 words' },
  { value: 'episodic_story', label: 'Episodic / Series',  description: 'Serial narrative per episode with cliffhanger, recurring voice, and continuity', wordRange: '800–1,500 words' },
];

export function isValidStoryFormat(value: unknown): value is StoryFormatType {
  return typeof value === 'string' && ['short_story', 'long_story', 'episodic_story'].includes(value);
}

/**
 * Returns story-specific structure rules for prompt injection.
 * Stories emphasize narrative arc, emotional engagement, and show-don't-tell craft.
 */
export function getStoryStructureRules(
  formatType: StoryFormatType,
  targetWordCount: number,
): StructureRules {
  const tw = targetWordCount && targetWordCount >= 300 ? targetWordCount : 900;

  const STORY_COMMON = `
## STORY-WIDE CRAFT REQUIREMENTS
- **Show, don't tell**: Use sensory details, dialogue, and action to convey meaning — not exposition.
- **Emotional arc**: Every story must take the reader on an emotional journey. Start with tension or curiosity, build through complications, resolve with insight.
- **Authentic voice**: Write in a natural, human voice. No corporate jargon, no marketing speak. The reader should forget they're reading branded content.
- **Concrete details**: Ground the narrative in specific, vivid details — names, places, numbers, textures. Vague stories are forgettable stories.
- **Strategic subtlety**: The brand message or insight should emerge naturally from the narrative, never feel forced or bolted on.
- Use **bold text** sparingly for key turning points or revelations.
- Paragraphs should be SHORT (2–4 sentences) for pacing and readability.`;

  switch (formatType) {

    case 'short_story': {
      return {
        structure_rules_prompt: `## SHORT STORY STRUCTURE (mandatory)

This is a TIGHT narrative. Every word must earn its place. No filler, no padding.

- <h2>The Hook</h2> (60–100 words): Open in the middle of action, a surprising moment, or an emotionally charged scene. Immediately create tension or curiosity. NO slow intros.
- 2–3 narrative H2 sections — each a distinct beat in the story:
  - Each section: H2 heading (evocative, not generic) + 2–3 paragraphs (${Math.max(100, Math.round((tw - 200) / 3))}+ words per section)
  - Rising tension: each beat should escalate the stakes or deepen the conflict
  - Include at least one moment of dialogue or internal thought
  - Use scene transitions (time skip, location change, perspective shift) between sections
- <h2>The Turn</h2> (80–120 words): The insight, resolution, or surprise that reframes everything. This is where the story's meaning crystallizes.
- References section (1–2 sources if applicable — can be testimonials, data, or attribution)
${STORY_COMMON}`,
        validation_overrides: {
          min_h2:                3,
          max_h2:                6,
          requires_key_insights: true,
          requires_summary:      false,
          requires_references:   false,
        },
      };
    }

    case 'long_story': {
      const sceneCount = tw <= 1500 ? '4–5' : tw <= 2000 ? '5–6' : '6–8';
      const minScenes  = tw <= 1500 ? 4 : tw <= 2000 ? 5 : 6;
      const wordsPerScene = Math.round((tw - 400) / minScenes);
      return {
        structure_rules_prompt: `## LONG STORY STRUCTURE (mandatory)

This is a RICH narrative. Take the reader deep. Develop characters, build atmosphere, layer meaning.

- <h2>Opening Scene</h2> (120–200 words): Establish the world, the protagonist, and the central tension. Use vivid, specific details. Hook the reader with a question or conflict they need resolved.
- ${sceneCount} narrative H2 sections — each a distinct scene:
  - Each scene: H2 heading (title each scene like a chapter — evocative, specific) + 3–5 paragraphs (${Math.max(150, wordsPerScene)}+ words per scene)
  - Use H3 sub-headings for scene breaks, flashbacks, or perspective shifts within longer scenes
  - Include dialogue in at least 2 scenes
  - Build character through choices and actions, not descriptions
  - Weave the brand insight or lesson into the fabric of the story — never preach
  - Use <blockquote> for pivotal dialogue, internal revelations, or data that drives the narrative (at least 2 total)
- <h2>Resolution</h2> (120–180 words): The turning point + aftermath. What changed? What did the protagonist learn? What should the reader take away?
- <h2>Reflection</h2> (80–120 words): Brief synthesis connecting the story to the reader's world. How does this narrative apply to THEM?
- References section (2–3 sources if applicable)
${STORY_COMMON}`,
        validation_overrides: {
          min_h2:                minScenes + 2, // scenes + resolution + reflection
          max_h2:               10,
          requires_key_insights: true,
          requires_summary:      false,
          requires_references:   false,
        },
      };
    }

    case 'episodic_story': {
      const sceneCount = tw <= 1000 ? '3–4' : tw <= 1500 ? '4–5' : '5–6';
      const minScenes  = tw <= 1000 ? 3 : tw <= 1500 ? 4 : 5;
      return {
        structure_rules_prompt: `## EPISODIC STORY STRUCTURE (mandatory)

This is ONE EPISODE in an ongoing series. It must work standalone AND hook the reader into coming back.

- <h2>The Recap</h2> (40–80 words): Brief, engaging "Previously..." anchor. If this is episode 1, use this as a world-building teaser instead. Establish stakes quickly.
- ${sceneCount} narrative H2 sections — each a scene in this episode:
  - Each scene: H2 heading + 2–4 paragraphs (${Math.max(120, Math.round((tw - 250) / minScenes))}+ words per scene)
  - Maintain a consistent character voice and recurring motifs across episodes
  - Each episode must have its own mini-arc (problem → complication → partial resolution)
  - Include at least one dialogue exchange per episode
  - Plant a "seed" — a detail, question, or tension that won't be resolved until a future episode
  - Use <blockquote> for key character dialogue or pivotal moments (at least 1)
- <h2>The Cliffhanger</h2> (60–100 words): End on unresolved tension, a revelation, or a question that compels the reader to seek the next episode. Do NOT wrap everything up neatly.
- <h2>Next Time</h2> (30–50 words): 2–3 sentence teaser for the next episode — hint at what's coming without spoiling it.
- References section (1–2 sources if applicable)
${STORY_COMMON}`,
        validation_overrides: {
          min_h2:                minScenes + 2, // scenes + cliffhanger + next time
          max_h2:               9,
          requires_key_insights: true,
          requires_summary:      false,
          requires_references:   false,
        },
      };
    }
  }
}

// ── Guide Format Types ─────────────────────────────────────────────────────

export type GuideFormatType =
  | 'comprehensive'
  | 'quickstart'
  | 'reference';

export const GUIDE_FORMAT_OPTIONS: { value: GuideFormatType; label: string; description: string; wordRange: string }[] = [
  { value: 'comprehensive', label: 'Comprehensive Guide', description: 'Full pillar content — 5-10 deep sections of authoritative expertise', wordRange: '3,000–5,000 words' },
  { value: 'quickstart',    label: 'Quickstart Guide',    description: 'Focused getting-started guide — clear steps, prerequisites, and first wins', wordRange: '1,500–2,500 words' },
  { value: 'reference',     label: 'Reference Handbook',  description: 'Structured lookup resource — definitions, patterns, and best practices', wordRange: '2,000–4,000 words' },
];

export function isValidGuideFormat(value: unknown): value is GuideFormatType {
  return typeof value === 'string' && ['comprehensive', 'quickstart', 'reference'].includes(value);
}

/**
 * Returns guide-specific structure rules for prompt injection.
 * Guides emphasize depth, authority, and evergreen value.
 */
export function getGuideStructureRules(
  formatType: GuideFormatType,
  targetWordCount: number,
): StructureRules {
  const tw = targetWordCount && targetWordCount >= 300 ? targetWordCount : 3000;

  const GUIDE_COMMON = `
## GUIDE-WIDE QUALITY REQUIREMENTS
- Write with **authoritative depth** — every section must be substantive enough to stand as its own article.
- Build **progressively**: foundational concepts first, then advanced strategies and nuance.
- Use **concrete examples, data points, frameworks, and actionable advice** in every section.
- Cross-reference between sections ("As discussed in Section 2..." or "Building on the framework above...").
- Include at least **2–3 blockquotes** for quotable insights, key definitions, or expert-level claims throughout the guide.
- Use **bold text** for key terms, definitions, and critical takeaways.
- Keep each paragraph focused — 3–5 sentences max — and use sub-headings liberally for scannability.`;

  switch (formatType) {

    case 'comprehensive': {
      const sectionCount = tw <= 2500 ? '5–7' : tw <= 4000 ? '7–9' : '8–10';
      const minSections  = tw <= 2500 ? 5 : tw <= 4000 ? 7 : 8;
      const wordsPerSection = Math.round((tw - 500) / minSections);
      return {
        structure_rules_prompt: `## COMPREHENSIVE GUIDE STRUCTURE (mandatory)

This is a COMPLETE GUIDE — depth over brevity. Write comprehensive, in-depth explanations. Assume the reader wants full understanding.

- Key Insights block (5–7 bullet points, each a standalone takeaway for scanners)
- <h2>Introduction</h2>: What this guide covers, who it's for, and what the reader will gain (150–250 words). Frame the scope clearly.
- ${sectionCount} deep H2 sections — each a comprehensive chapter:
  - Each section: H2 heading + 3–6 paragraphs (${Math.max(200, wordsPerSection)}+ words per section)
  - Use H3 sub-headings within sections to break down complex ideas (2–4 H3s per H2)
  - Include concrete examples, data points, frameworks, and actionable advice in every section
  - Naturally distribute target keywords across section headings and body text
  - Use <blockquote> for key definitions, expert insights, or critical data points (at least 1 per major section)
- <h2>Summary</h2>: Synthesize the guide's core message, key takeaways, and recommended next actions (150–200 words)
- References section (minimum 5 authoritative sources with URLs)
${GUIDE_COMMON}`,
        validation_overrides: {
          min_h2:                minSections + 1,
          max_h2:               12,
          requires_key_insights: true,
          requires_summary:      true,
          requires_references:   true,
        },
      };
    }

    case 'quickstart': {
      const stepCount = tw <= 1500 ? '5–7' : tw <= 2000 ? '6–8' : '7–10';
      const minSteps  = tw <= 1500 ? 5 : tw <= 2000 ? 6 : 7;
      return {
        structure_rules_prompt: `## QUICKSTART GUIDE STRUCTURE (mandatory)

This is a QUICKSTART — focused, practical, and results-driven. Get the reader from zero to first win fast.

- Key Insights block (3–5 bullet points summarizing what the reader will accomplish)
- <h2>Before You Start</h2>: Prerequisites, requirements, and what to have ready (80–150 words)
- ${stepCount} H2 step sections — each a clear action:
  - Each step: H2 heading ("Step N: [Action]") + 2–3 paragraphs (${Math.max(120, Math.round((tw - 400) / minSteps))}+ words per step)
  - Include expected outcomes after each step — what the reader should see/have
  - Use H3 sub-headings for variations or common gotchas within steps
  - Include code snippets, commands, or specific values where applicable
  - Use <blockquote> for critical warnings or pro tips (at least 1 per 2 steps)
- <h2>What You've Built</h2>: Summary of what the reader achieved and next steps to go deeper (100–150 words)
- References section (minimum 2 sources — official docs, tutorials)
${GUIDE_COMMON}`,
        validation_overrides: {
          min_h2:                minSteps + 2,
          max_h2:               12,
          requires_key_insights: true,
          requires_summary:      true,
          requires_references:   true,
        },
      };
    }

    case 'reference': {
      const categoryCount = tw <= 2000 ? '4–6' : tw <= 3000 ? '5–8' : '6–10';
      const minCategories = tw <= 2000 ? 4 : tw <= 3000 ? 5 : 6;
      return {
        structure_rules_prompt: `## REFERENCE HANDBOOK STRUCTURE (mandatory)

This is a REFERENCE — structured for lookup and repeated use. Organized by category, not narrative flow.

- Key Insights block (4–6 bullet points — the most important things to know at a glance)
- <h2>Overview</h2>: What this reference covers, how it's organized, and when to use it (100–200 words)
- ${categoryCount} H2 category sections — each covers a distinct topic area:
  - Each category: H2 heading + 2–4 H3 sub-entries (${Math.max(150, Math.round((tw - 400) / minCategories))}+ words per category)
  - Each H3 sub-entry: definition/explanation + when to use + example + common mistakes
  - Use <blockquote> for key definitions and critical distinctions (at least 1 per category)
  - Use tables or structured lists where comparing options or parameters
  - Include cross-references between related entries
- <h2>Quick Reference Table</h2>: Summary table or cheat sheet of the most-used items
- <h2>Further Reading</h2>: Curated resources for deeper exploration
- References section (minimum 3 authoritative sources)
${GUIDE_COMMON}`,
        validation_overrides: {
          min_h2:                minCategories + 2,
          max_h2:               14,
          requires_key_insights: true,
          requires_summary:      false,
          requires_references:   true,
        },
      };
    }
  }
}

// ── Post Format Types ──────────────────────────────────────────────────────

export type PostFormatType = 'standard' | 'thread';

export const POST_FORMAT_OPTIONS: { value: PostFormatType; label: string; description: string }[] = [
  { value: 'standard', label: 'Standard Post', description: 'Single high-impact post for any platform' },
  { value: 'thread',   label: 'Thread / Series', description: 'Multi-post thread for LinkedIn or Twitter/X' },
];

export function isValidPostFormat(value: unknown): value is PostFormatType {
  return value === 'standard' || value === 'thread';
}

export interface ThreadStructureRules {
  structure_rules_prompt: string;
  validation_overrides: {
    min_posts: number;
    max_posts: number;
    max_words_per_post: number;
  };
}

export function getThreadStructureRules(): ThreadStructureRules {
  return {
    structure_rules_prompt: `## THREAD STRUCTURE (mandatory)

STRUCTURE:
- Hook (Post 1): Must stop the scroll. Bold claim, surprising stat, or provocative question. 1–3 lines max.
- 5–10 body posts: Each delivers ONE clear idea. Connected but standalone.
- Final post: CTA or key takeaway that ties the thread together.

RULES PER POST:
- Be concise: 1–3 lines per post (max 280 characters for Twitter, ~500 for LinkedIn).
- One idea per post — no multi-point posts.
- Use line breaks for readability, not walls of text.
- Vary format: mix statements, questions, data points, and micro-stories.
- Each post should make sense if read alone, but gain power in sequence.
- Use transitional hooks between posts (numbering, "Here's why:", "But here's the thing:").

TONE:
- Punchy, engaging, conversational.
- No long paragraphs. No academic language.
- Write like you're speaking to a smart colleague, not presenting at a conference.`,
    validation_overrides: {
      min_posts: 5,
      max_posts: 12,
      max_words_per_post: 80,
    },
  };
}
