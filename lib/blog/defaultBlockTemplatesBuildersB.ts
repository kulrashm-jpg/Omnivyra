/** Part of defaultBlockTemplates (Agent-B split — main module keeps the original path). */
/**
 * Default Block Templates
 *
 * System-provided layout templates for each content type.
 * Each template is a ContentBlock[] skeleton with `hint` fields that
 * tell the AI what content to generate for each slot.
 *
 * Hints are ephemeral â€” stripped before saving to the DB but used
 * during template-aware generation.
 */

import { createBlock, newId } from './blockUtils';
import type {
  ContentBlock,
  KeyInsightsBlock,
  HeadingBlock,
  ParagraphBlock,
  CalloutBlock,
  ImageBlock,
  ListBlock,
  SummaryBlock,
  ReferencesBlock,
  ColumnsBlock,
  QuoteBlock,
  DividerBlock,
} from './blockTypes';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { DefaultTemplate, buildClassicTemplate, buildComparisonTemplate, buildVisualFeatureTemplate, bulletList, callout, cols, divider, h2, h3, image, insights, numberedList, para, quote, refs, summary } from './defaultBlockTemplatesBuilders';

export function buildTutorialTemplate(targetWords = 1200): ContentBlock[] {
  if (targetWords >= 2000) {
    return [
      insights('Summarize the 6-8 most important things the reader will learn from this tutorial', 7),
      para('Write a substantial introduction explaining what the reader will build or achieve, why it matters, and what success looks like. Use multiple rich paragraphs.'),
      callout('note', 'Prerequisites: list what the reader needs before starting, including tools, knowledge, setup expectations, and preparation tips.'),
      numberedList('Add a quick-start checklist that previews the major stages of the tutorial before the detailed walkthrough begins.', 5),
      h2('Step 1: Prepare the environment'),
      para('Write a substantial first step with setup guidance, context, and the reasoning behind the initial configuration choices. Use multiple paragraphs.'),
      h2('Step 2: Build the foundation'),
      para('Write a substantial second step with detailed guidance, examples, and the logic behind the core setup. Include what can go wrong. Use multiple paragraphs.'),
      h2('Step 3: Implement the core workflow'),
      para('Write a substantial implementation section with clear instructions, rationale, and quality guidance. Include common pitfalls and practical checks. Use multiple paragraphs.'),
      h2('Step 4: Refine and optimize'),
      para('Write a substantial section on refinement, performance, edge cases, and what strong execution looks like. Use multiple paragraphs.'),
      h2('Step 5: Test and troubleshoot'),
      para('Write a substantial verification section explaining how to validate the result, debug likely issues, and confirm quality. Use multiple paragraphs.'),
      callout('warning', 'Common mistakes to avoid, failure patterns to watch for, and troubleshooting guidance'),
      divider(),
      summary('Summarize what was accomplished, the expected outcome, and the most useful next steps the reader should take after finishing this tutorial.'),
      refs(4),
    ];
  }

  if (targetWords >= 1600) {
    return [
      insights('Summarize the 5-6 most important things the reader will learn from this tutorial', 6),
      para('Write an introduction explaining what the reader will build or achieve, why it matters, and what success looks like. Use multiple rich paragraphs.'),
      callout('note', 'Prerequisites: list what the reader needs before starting (tools, knowledge, accounts)'),
      numberedList('Add a quick walkthrough outline so the reader can see the main stages before diving into the full tutorial.', 5),
      h2('Step 1: Getting started'),
      para('Write a substantial first step with clear instructions, context, and setup guidance. Use multiple paragraphs.'),
      h2('Step 2: Build the core implementation'),
      para('Write a substantial section for the core implementation step with detailed guidance, reasoning, and common pitfalls. Use multiple paragraphs.'),
      h2('Step 3: Refine the workflow'),
      para('Write a substantial section for refinement with quality checks, alternatives, and practical improvement guidance. Use multiple paragraphs.'),
      h2('Step 4: Testing and verification'),
      para('Write a substantial verification section explaining how to test, validate, and troubleshoot the outcome. Use multiple paragraphs.'),
      h2('Step 5: What to do next'),
      para('Write a substantial section explaining how to extend, scale, or adapt the result in real-world use. Use multiple paragraphs.'),
      callout('warning', 'Common mistakes to avoid and troubleshooting tips'),
      divider(),
      summary('Summarize what was accomplished, the expected outcome, and the most useful next steps for the reader.'),
      refs(3),
    ];
  }

  if (targetWords >= 1200) {
    return [
      insights('Summarize the 4-5 most important things the reader will learn from this tutorial', 5),
      para('Write an introduction explaining what the reader will build or achieve, why it matters, and what success looks like. Use one or two rich paragraphs.'),
      callout('note', 'Prerequisites: list what the reader needs before starting (tools, knowledge, accounts)'),
      numberedList('Add a quick outline of the major tutorial stages so the reader can scan the workflow upfront.', 4),
      h2('Step 1: Getting started'),
      para('Write a substantial first step with clear instructions, context, and setup guidance. Aim for roughly 140-180 words and use multiple paragraphs if needed.'),
      h2('Step 2: Core implementation'),
      para('Write a substantial section for the core implementation step with detailed guidance, reasoning, and common pitfalls. Aim for roughly 150-190 words and use multiple paragraphs if needed.'),
      h2('Step 3: Finishing touches'),
      para('Write a substantial section for the finishing step with refinement guidance and quality checks. Aim for roughly 130-170 words and use multiple paragraphs if needed.'),
      h2('Step 4: Testing and verification'),
      para('Write a substantial verification section explaining how to test, validate, and troubleshoot the outcome. Aim for roughly 130-170 words and use multiple paragraphs if needed.'),
      callout('warning', 'Common mistakes to avoid and troubleshooting tips'),
      divider(),
      summary('Summarize what was accomplished, the expected outcome, and the most useful next steps for the reader.'),
      refs(3),
    ];
  }

  return [
    insights('Summarize the 3 strongest things the reader will learn from this tutorial', 3),
    para('Write a concise but meaningful introduction explaining what the reader will achieve, why it matters, and what success looks like. Use one or two short rich paragraphs.'),
    callout('note', 'Prerequisites: list what the reader needs before starting'),
    numberedList('Add a quick mini-roadmap of the 3 main tutorial stages.', 3),
    h2('Step 1: Start here'),
    para('Write a substantial first step with clear instructions, context, and practical setup guidance. Aim for roughly 140-180 words and use multiple paragraphs if needed.'),
    h2('Step 2: Do the core work'),
    para('Write a substantial implementation step with detailed guidance, reasoning, and common pitfalls. Aim for roughly 150-190 words and use multiple paragraphs if needed.'),
    h2('Step 3: Check and refine'),
    para('Write a substantial verification and refinement step explaining how to test the result and fix likely issues. Aim for roughly 140-180 words and use multiple paragraphs if needed.'),
    divider(),
    summary('Write a concise but complete conclusion that explains what was achieved and the strongest next step for the reader.'),
    refs(3),
  ];
}

export function buildMagazineTemplate(targetWords = 1200): ContentBlock[] {
  if (targetWords >= 2000) {
    return [
      image('Full-width hero image representing the article theme'),
      insights('Summarize the 6-8 strongest editorial insights from this feature', 7),
      quote('Add a strong editorial pull quote that captures the mood, tension, or thesis of the feature.'),
      cols(3, [
        [para('Write a substantial editorial angle on the problem statement with clear framing, tension, and context. Use multiple paragraphs.')],
        [para('Write a substantial angle on the opportunity or trend with timely relevance, interpretation, and concrete detail. Use multiple paragraphs.')],
        [para('Write a substantial angle on the stakeholder perspective with consequence, friction, and practical meaning. Use multiple paragraphs.')],
      ]),
      h2('The full story'),
      para('Write a substantial narrative section with rich detail, examples, reporting-style analysis, and layered interpretation. Use multiple paragraphs.'),
      cols(2, [
        [quote('A compelling expert quote that supports the narrative and sharpens the article point of view')],
        [para('Write a substantial analysis section that contextualizes the quote, explains why it matters, and connects it to the broader argument. Use multiple paragraphs.')],
      ]),
      h2('What the signals reveal'),
      para('Write a substantial section on deeper patterns, structural implications, and what sophisticated readers should notice beneath the surface. Use multiple paragraphs.'),
      h2('What this means going forward'),
      para('Write a substantial forward-looking analysis section with consequences, action-ready perspective, and decision-useful guidance. Use multiple paragraphs.'),
      callout('insight', 'The key takeaway in one powerful sentence'),
      divider(),
      summary('Write a complete editorial conclusion that lands the argument, sharpens the perspective, and leaves the reader with a strong next-step takeaway.'),
      refs(4),
    ];
  }

  if (targetWords >= 1600) {
    return [
      image('Full-width hero image representing the article theme'),
      insights('Summarize the 5-6 strongest editorial insights', 6),
      quote('Add a stylish editorial pull quote that sharpens the angle of the feature.'),
      cols(3, [
        [para('Write a meaningful angle on the problem statement with clear editorial framing and context. Use multiple paragraphs.')],
        [para('Write a meaningful angle on the opportunity or trend with timely relevance and interpretation. Use multiple paragraphs.')],
        [para('Write a meaningful angle on the stakeholder perspective with concrete tension or consequence. Use multiple paragraphs.')],
      ]),
      h2('The full story'),
      para('Write a substantial narrative section with rich detail, examples, and analysis. Use multiple paragraphs.'),
      cols(2, [
        [quote('A compelling expert quote that supports the narrative')],
        [para('Write a substantial analysis section that contextualizes the quote and explains why it matters. Use multiple paragraphs.')],
      ]),
      h2('What the deeper pattern means'),
      para('Write a substantial interpretation section with consequences, evidence, and perspective. Use multiple paragraphs.'),
      h2('What this means going forward'),
      para('Write a substantial forward-looking analysis section with implications, consequences, and action-ready perspective. Use multiple paragraphs.'),
      callout('insight', 'The key takeaway in one powerful sentence'),
      divider(),
      summary('Write a complete editorial conclusion that lands the argument and leaves the reader with a strong takeaway.'),
      refs(4),
    ];
  }

  if (targetWords >= 1200) {
    return [
      image('Full-width hero image representing the article theme'),
      insights('Summarize the 4-5 strongest editorial insights', 5),
      quote('Add a short pull quote that gives the feature a more magazine-like rhythm and point of view.'),
      cols(3, [
        [para('Write a meaningful angle on the problem statement with clear editorial framing and context.')],
        [para('Write a meaningful angle on the opportunity or trend with timely relevance and interpretation.')],
        [para('Write a meaningful angle on the stakeholder perspective with concrete tension or consequence.')],
      ]),
      h2('The full story'),
      para('Write a substantial narrative section with rich detail, examples, and analysis. Use multiple paragraphs if needed.'),
      cols(2, [
        [quote('A compelling expert quote that supports the narrative')],
        [para('Write a substantial analysis section that contextualizes the quote and explains why it matters. Use multiple paragraphs if needed.')],
      ]),
      h2('What the deeper pattern means'),
      para('Write a substantial interpretation section that surfaces the deeper pattern, structural implication, or hidden tension inside the story. Use multiple paragraphs if needed.'),
      h2('What this means going forward'),
      para('Write a substantial forward-looking analysis section with implications, consequences, and action-ready perspective. Use multiple paragraphs if needed.'),
      callout('insight', 'The key takeaway in one powerful sentence'),
      divider(),
      summary('Write a complete editorial conclusion that lands the argument and leaves the reader with a strong takeaway.'),
      refs(4),
    ];
  }

  return [
    image('Full-width hero image representing the article theme'),
    insights('Summarize the 3 strongest editorial insights', 3),
    quote('Add a short editorial line that feels like a pull quote or deck-style statement.'),
    cols(3, [
      [para('Write a concise but meaningful editorial angle on the problem statement with clear framing.')],
      [para('Write a concise but meaningful angle on the trend or opportunity with timely relevance.')],
      [para('Write a concise but meaningful stakeholder angle with concrete consequence.')],
    ]),
    h2('The full story'),
    para('Write a substantial narrative section with detail, examples, and analysis. Use multiple paragraphs if needed.'),
    h2('What this means'),
    para('Write a substantial forward-looking interpretation section with implications and practical takeaway. Use multiple paragraphs if needed.'),
    callout('insight', 'The key takeaway in one powerful sentence'),
    divider(),
    summary('Write a concise but complete editorial conclusion that leaves the reader with a strong takeaway.'),
    refs(3),
  ];
}

