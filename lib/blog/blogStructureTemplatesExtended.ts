/** Part 2/2 of blogStructureTemplates.ts — verbatim split (barrel preserved; importers unchanged). */
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

import { type StructureRules } from './blogStructureTemplatesBase';

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
  formatType: NewsletterFormatType | 'curated' | 'editorial' | 'digest',
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false, // Phase 3.4 — advisory only, never forced
          requires_references:   false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false, // Phase 3.4 — advisory only, never forced
          requires_references:   false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false, // Phase 3.4 — advisory only, never forced
          requires_references:   false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false,
          requires_references:   false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false,
          requires_references:   false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false,
          requires_references:   false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false, // Phase 3.4 — advisory only, never forced
          requires_references:   false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false, // Phase 3.4 — advisory only, never forced
          requires_references:   false, // Phase 3.4 — advisory only, never forced
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
          requires_key_insights: false, // Phase 3.4 — advisory only, never forced
          requires_summary:      false,
          requires_references:   false, // Phase 3.4 — advisory only, never forced
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

