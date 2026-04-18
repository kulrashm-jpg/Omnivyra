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

function h2(hint: string): HeadingBlock {
  return { id: newId(), type: 'heading', level: 2, text: '', anchor: '', hint };
}

function h3(hint: string): HeadingBlock {
  return { id: newId(), type: 'heading', level: 3, text: '', anchor: '', hint };
}

function para(hint: string): ParagraphBlock {
  return { id: newId(), type: 'paragraph', html: '', hint };
}

function insights(hint: string, count: number): KeyInsightsBlock {
  return { id: newId(), type: 'key_insights', title: 'Key Insights', items: Array(count).fill(''), hint };
}

function callout(variant: 'insight' | 'note' | 'warning', hint: string): CalloutBlock {
  return { id: newId(), type: 'callout', variant, title: '', body: '', hint };
}

function image(hint: string): ImageBlock {
  return { id: newId(), type: 'image', url: '', alt: '', caption: '', hint };
}

function bulletList(hint: string, count: number): ListBlock {
  return { id: newId(), type: 'list', listType: 'bullet', items: Array.from({ length: count }, () => ({ id: newId(), text: '' })), hint };
}

function numberedList(hint: string, count: number): ListBlock {
  return { id: newId(), type: 'list', listType: 'numbered', items: Array.from({ length: count }, () => ({ id: newId(), text: '' })), hint };
}

function summary(hint: string): SummaryBlock {
  return { id: newId(), type: 'summary', body: '', hint };
}

function refs(count: number): ReferencesBlock {
  return { id: newId(), type: 'references', items: Array.from({ length: count }, () => ({ id: newId(), title: '', url: '' })), hint: `Provide ${count} credible source references` };
}

function divider(): DividerBlock {
  return { id: newId(), type: 'divider', variant: 'section_break' };
}

function quote(hint: string): QuoteBlock {
  return { id: newId(), type: 'quote', text: '', author: '', source: '', hint };
}

function cols(columnCount: 1 | 2 | 3, columns: ContentBlock[][]): ColumnsBlock {
  return {
    id: newId(),
    type: 'columns',
    columnCount,
    columns: columns.map((blocks) => ({ id: newId(), blocks })),
  };
}

// â”€â”€ Blog Templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface DefaultTemplate {
  name: string;
  description: string;
  content_type: string;
  format_type: string | null;
  blocks: (targetWords?: number) => ContentBlock[];
}

function buildClassicTemplate(targetWords = 1200): ContentBlock[] {
  if (targetWords >= 2000) {
    return [
      insights('Summarize the 6-8 most important strategic takeaways from this article', 7),
      para('Write a substantial introduction that frames the stakes, establishes the central argument, and previews the major sections. Use 2-3 rich paragraphs with clear momentum.'),
      callout('insight', 'Capture the sharpest operating insight from this article in one high-conviction line that could work as a featured pullout.'),
      cols(2, [
        [para('Write a concise strategic snapshot covering the pressure, opportunity, or timing factor that makes this topic matter now.')],
        [bulletList('List the 3-4 decision lenses, levers, or criteria readers should keep in mind throughout the article.', 4)],
      ]),
      h2('Why this topic matters now'),
      para('Write a substantial context-setting section explaining the market shift, pressure point, or opportunity behind this topic. Include concrete examples, evidence, and practical relevance. Use multiple paragraphs.'),
      h2('The core problem or opportunity'),
      para('Write a substantial analysis section unpacking the root issue, its causes, and the practical consequences for the reader. Use multiple paragraphs and concrete examples.'),
      h2('The operating framework'),
      para('Write a substantial framework section that breaks the solution into clear components, tradeoffs, and implementation logic. Use multiple paragraphs and specific reasoning.'),
      h2('How leading teams apply it'),
      para('Write a substantial application section with realistic scenarios, execution examples, and patterns practitioners can learn from. Use multiple paragraphs.'),
      h2('Common mistakes and decision traps'),
      para('Write a substantial section showing what goes wrong in practice, why teams mis-execute, and how to avoid predictable mistakes. Use multiple paragraphs.'),
      h2('What to do next'),
      para('Write a substantial forward-looking section with action-ready recommendations, prioritization guidance, and a clear next-step path for the reader. Use multiple paragraphs.'),
      callout('insight', 'Capture the articleâ€™s sharpest strategic insight in one high-conviction statement.'),
      divider(),
      summary('Write a complete conclusion that synthesizes the full argument, reinforces the practical stakes, and leaves the reader with a clear action path or perspective shift.'),
      refs(4),
    ];
  }

  if (targetWords >= 1600) {
    return [
      insights('Summarize the 5-6 most important takeaways from this article', 6),
      para('Write a substantial introduction that hooks the reader, frames the thesis, and explains why this topic matters now. Use 2 rich paragraphs.'),
      callout('insight', 'State the defining thesis or strategic insight in one strong line that can anchor the rest of the piece.'),
      cols(2, [
        [para('Write a short briefing block on the immediate context, urgency, or shift driving the article.')],
        [bulletList('List the 3-4 core lenses or questions that the article will help the reader answer.', 4)],
      ]),
      h2('Why this matters'),
      para('Write a substantial section explaining the core context, problem pressure, or opportunity behind this topic. Include examples and practical relevance. Use multiple paragraphs.'),
      h2('The core challenge'),
      para('Write a substantial body section on the main challenge, including causes, downstream effects, and what makes it hard to solve well. Use multiple paragraphs.'),
      h2('A better framework'),
      para('Write a substantial framework section with clear logic, examples, tradeoffs, and implementation detail. Use multiple paragraphs.'),
      h2('How to apply it in practice'),
      para('Write a substantial application section with realistic examples, operational guidance, and action-ready detail. Use multiple paragraphs.'),
      h2('What smart teams do differently'),
      para('Write a substantial section on differentiators, execution choices, and forward-looking implications. Use multiple paragraphs.'),
      divider(),
      summary('Synthesize the article into a complete conclusion that reinforces the argument, summarizes the practical lesson, and gives the reader a clear next step.'),
      refs(4),
    ];
  }

  if (targetWords >= 1200) {
    return [
      insights('Summarize the 4-5 most important takeaways from this article', 5),
      para('Write a compelling introduction that hooks the reader, previews the thesis, and establishes why this topic matters now. Use 1-2 rich paragraphs.'),
      callout('note', 'Add a quick strategic framing note: what changed, why it matters, and what the reader should pay closest attention to.'),
      h2('The problem or opportunity'),
      para('Write a substantial section on the first major theme. Include explanation, examples, evidence, and practical implications. Use multiple paragraphs if needed.'),
      h2('The framework or solution'),
      para('Write a substantial section on the second major theme with practical guidance, tradeoffs, and implementation detail. Use multiple paragraphs if needed.'),
      h2('How it works in the real world'),
      para('Write a substantial section with examples, operational detail, and realistic application guidance. Use multiple paragraphs if needed.'),
      h2('What happens next'),
      para('Write a substantial section on future impact, decision implications, and actionable next steps. Use multiple paragraphs if needed.'),
      divider(),
      summary('Synthesize the article into a complete conclusion that reinforces the argument and leaves the reader with a clear next step or perspective shift.'),
      refs(3),
    ];
  }

  return [
    insights('Summarize the 3 strongest takeaways from this article', 3),
    para('Write a concise but substantive introduction that hooks the reader, frames the topic, and previews the main point. Use 1-2 short rich paragraphs.'),
    callout('note', 'Add one sharp framing line that tells the reader what this article will help them see or do differently.'),
    h2('The core issue'),
    para('Write a substantial section on the first major theme. Include explanation, examples, and practical implications. Use multiple paragraphs if needed.'),
    h2('The better approach'),
    para('Write a substantial section on the second major theme with clear guidance, tradeoffs, and useful implementation detail. Use multiple paragraphs if needed.'),
    h2('The takeaway'),
    para('Write a substantial closing body section with outcomes, forward-looking interpretation, and practical next steps. Use multiple paragraphs if needed.'),
    divider(),
    summary('Write a concise but complete conclusion that reinforces the main argument and gives the reader a practical takeaway.'),
    refs(3),
  ];
}

function buildVisualFeatureTemplate(targetWords = 1200): ContentBlock[] {
  if (targetWords >= 2000) {
    return [
      insights('Summarize the 6-8 strongest visual and strategic insights from this feature', 7),
      cols(2, [
        [para('Write a substantial scene-setting introduction that frames the visual story, explains why it matters now, and prepares the reader for a deeper editorial journey. Use multiple rich paragraphs.')],
        [image('Featured hero image related to the topic with a caption that reinforces the article angle')],
      ]),
      quote('Add a cinematic or editorial line that captures the visual tension of the story and works as a pull quote.'),
      h2('The visual signal everyone notices first'),
      para('Write a substantial section unpacking the first major visual narrative with descriptive detail, analysis, examples, and practical interpretation. Use multiple paragraphs.'),
      image('Illustrative image supporting the first major narrative'),
      h2('What sits beneath the surface'),
      para('Write a substantial second section connecting the visible trend to deeper drivers, market shifts, or user behavior. Include evidence and nuanced interpretation. Use multiple paragraphs.'),
      image('Illustrative image supporting the deeper analysis'),
      h2('How leading teams respond'),
      para('Write a substantial section showing how strong operators interpret and act on these signals in practice. Include realistic scenarios and decision-useful takeaways. Use multiple paragraphs.'),
      cols(2, [
        [callout('insight', 'Highlight the strongest pattern or visual clue that sophisticated readers notice early.')],
        [bulletList('List the 4 most useful moves, signals, or watchpoints readers should take away from this feature.', 4)],
      ]),
      h2('Where the visual story can mislead'),
      para('Write a substantial section on misconceptions, weak interpretations, or common overreactions. Include tradeoffs and cautionary detail. Use multiple paragraphs.'),
      image('Image or chart idea that would reinforce the tradeoffs or counterpoint'),
      h2('What the reader should do next'),
      para('Write a substantial action-oriented section with prioritization guidance, practical next steps, and a strong forward-looking perspective. Use multiple paragraphs.'),
      divider(),
      summary('Write a complete editorial conclusion that synthesizes the visual story, the deeper interpretation, and the strongest practical takeaway for the reader.'),
      refs(4),
    ];
  }

  if (targetWords >= 1600) {
    return [
      insights('Summarize the 5-6 strongest visual insights from this feature', 6),
      cols(2, [
        [para('Write a substantial introduction that sets the scene, frames the narrative, and explains why the visual signal matters. Use multiple rich paragraphs.')],
        [image('Featured hero image related to the topic')],
      ]),
      quote('Add a short, stylish line that captures the mood or hidden meaning of the visual story.'),
      h2('The defining visual story'),
      para('Write a substantial section exploring the first major theme with vivid description, analysis, and concrete examples. Use multiple paragraphs.'),
      image('Illustrative image supporting the first section'),
      h2('Why it matters beneath the surface'),
      para('Write a substantial section with deeper analysis, evidence, and interpretation. Use multiple paragraphs.'),
      image('Illustrative image supporting the second section'),
      h2('How it plays out in practice'),
      para('Write a substantial section with practical applications, examples, and decision-useful guidance. Use multiple paragraphs.'),
      h2('What smart teams notice early'),
      para('Write a substantial section on implications, patterns, and early signals practitioners should track. Use multiple paragraphs.'),
      divider(),
      summary('Write a complete synthesis of the visual narrative that explains what the reader should take away and how they should think about it going forward.'),
      refs(4),
    ];
  }

  if (targetWords >= 1200) {
    return [
      insights('Summarize the 4-5 strongest visual insights from this feature', 5),
      cols(2, [
        [para('Write a strong introduction that sets the scene, frames the narrative, and prepares the reader for the deeper sections. Use one or two rich paragraphs.')],
        [image('Featured hero image related to the topic')],
      ]),
      callout('insight', 'Add one sharp framing line that tells the reader what they should notice beneath the obvious visual story.'),
      h2('The key visual narrative'),
      para('Write a substantial section exploring the first theme with vivid descriptive language, analysis, and concrete examples. Aim for roughly 140-180 words and use multiple paragraphs if needed.'),
      image('Illustrative image supporting the first section'),
      h2('Deeper interpretation'),
      para('Write a substantial section with deeper analysis, visual references, and practical interpretation. Aim for roughly 140-180 words and use multiple paragraphs if needed.'),
      image('Illustrative image supporting the second section'),
      h2('Practical applications'),
      para('Write a substantial section with real-world applications, examples, and next-step guidance. Aim for roughly 130-170 words and use multiple paragraphs if needed.'),
      h2('What to watch next'),
      para('Write a substantial section on what these signals imply going forward and how readers should respond. Aim for roughly 130-170 words and use multiple paragraphs if needed.'),
      divider(),
      summary('Write a complete synthesis of the visual narrative that explains what the reader should take away and do next.'),
      refs(3),
    ];
  }

  return [
    insights('Summarize the 3 strongest visual insights from this feature', 3),
    cols(2, [
      [para('Write a concise but meaningful introduction that sets the scene, frames the narrative, and explains why the visual story matters. Use one or two short rich paragraphs.')],
      [image('Featured hero image related to the topic')],
    ]),
    callout('note', 'Add one short editorial note that sets up what the reader is about to notice.'),
    h2('The main visual signal'),
    para('Write a substantial section exploring the first theme with descriptive detail, analysis, and practical interpretation. Aim for roughly 140-180 words and use multiple paragraphs if needed.'),
    image('Illustrative image supporting the first section'),
    h2('What it means in practice'),
    para('Write a substantial section with deeper interpretation, examples, and next-step guidance. Aim for roughly 140-180 words and use multiple paragraphs if needed.'),
    h2('The takeaway'),
    para('Write a substantial closing body section with outcomes, forward-looking analysis, and practical action points. Aim for roughly 130-160 words and use multiple paragraphs if needed.'),
    divider(),
    summary('Write a concise but complete conclusion that explains the strongest takeaway from the visual narrative and what the reader should do with it.'),
    refs(3),
  ];
}

function buildComparisonTemplate(targetWords = 1200): ContentBlock[] {
  if (targetWords >= 2000) {
    return [
      insights('Summarize the 6-8 most important comparison findings and verdict criteria', 7),
      para('Write a substantial introduction explaining what is being compared, why the decision matters now, and how the reader should evaluate the options. Use multiple rich paragraphs.'),
      cols(2, [
        [callout('note', 'Add a decision framing note on the buyer or operator context behind this comparison.')],
        [bulletList('List the 4 criteria that will matter most in the head-to-head evaluation.', 4)],
      ]),
      h2('What is actually being decided'),
      para('Provide substantial context for the decision, the reader stakes, and the market reality around both options. Use multiple paragraphs.'),
      cols(2, [
        [
          h3('Option A'),
          para('Write a substantial analysis of Option A covering how it works, where it excels, the tradeoffs, and ideal use cases. Use multiple paragraphs.'),
          bulletList('Key strengths of Option A', 5),
        ],
        [
          h3('Option B'),
          para('Write a substantial analysis of Option B covering how it works, where it excels, the tradeoffs, and ideal use cases. Use multiple paragraphs.'),
          bulletList('Key strengths of Option B', 5),
        ],
      ]),
      h2('Head-to-head on the criteria that matter most'),
      para('Write a substantial comparison of the options on the most important criteria, including reasoning, evidence, and practical consequences. Use multiple paragraphs.'),
      h2('Where each option breaks down'),
      para('Write a substantial section on weaknesses, risks, and failure modes for both options. Include realistic tradeoffs and cautionary detail. Use multiple paragraphs.'),
      callout('insight', 'State the sharpest decision-ready verdict in one confident sentence.'),
      h2('Recommendation by scenario'),
      para('Write a substantial section recommending which option is better for different reader profiles, budgets, maturity levels, or use cases. Use multiple paragraphs.'),
      divider(),
      summary('Summarize the comparison in a complete conclusion that gives the reader a confident recommendation and explains the strongest decision criteria.'),
      refs(4),
    ];
  }

  if (targetWords >= 1600) {
    return [
      insights('Summarize the 5-6 most important comparison findings', 6),
      para('Write a substantial introduction explaining what is being compared, why the comparison matters, and what decision the reader is trying to make. Use multiple rich paragraphs.'),
      cols(2, [
        [callout('note', 'Add a short buyer-context note: who this comparison is for and what the real decision pressure looks like.')],
        [bulletList('List the 4 comparison criteria that will define the verdict.', 4)],
      ]),
      h2('Overview of the two options'),
      para('Provide substantial context for both options with enough detail to frame the comparison clearly and fairly. Use multiple paragraphs.'),
      cols(2, [
        [
          h3('Option A'),
          para('Write a substantial analysis of Option A covering features, strengths, tradeoffs, and best-fit use cases. Use multiple paragraphs.'),
          bulletList('Key advantages of Option A', 4),
        ],
        [
          h3('Option B'),
          para('Write a substantial analysis of Option B covering features, strengths, tradeoffs, and best-fit use cases. Use multiple paragraphs.'),
          bulletList('Key advantages of Option B', 4),
        ],
      ]),
      h2('Critical differentiators'),
      para('Write a substantial comparison of the options on the most important criteria, with clear reasoning and practical implications. Use multiple paragraphs.'),
      h2('Recommendation by use case'),
      para('Write a substantial section explaining when each option is the better choice and for whom. Use multiple paragraphs.'),
      callout('insight', 'One-sentence verdict: which option wins for which use case'),
      divider(),
      summary('Summarize the comparison findings in a complete conclusion that gives the reader a confident next step.'),
      refs(4),
    ];
  }

  if (targetWords >= 1200) {
    return [
      insights('Summarize the 4-5 most important comparison findings', 5),
      para('Write an introduction explaining what is being compared, why the comparison matters, and what decision the reader is trying to make. Use one or two rich paragraphs.'),
      callout('note', 'Add one framing line on the real decision the reader is trying to make before they compare features.'),
      h2('Overview of the two options/approaches'),
      para('Provide context for both options with enough detail to frame the comparison clearly and fairly. Aim for roughly 140-180 words and use multiple paragraphs if needed.'),
      cols(2, [
        [
          h3('Option A'),
          para('Write a substantial analysis of Option A covering features, strengths, tradeoffs, and best-fit use cases. Aim for roughly 120-160 words and use multiple paragraphs if needed.'),
          bulletList('Key advantages of Option A', 4),
        ],
        [
          h3('Option B'),
          para('Write a substantial analysis of Option B covering features, strengths, tradeoffs, and best-fit use cases. Aim for roughly 120-160 words and use multiple paragraphs if needed.'),
          bulletList('Key advantages of Option B', 4),
        ],
      ]),
      h2('Critical differentiators'),
      para('Write a substantial comparison of the options on the most important criteria, with clear reasoning and evidence. Aim for roughly 140-180 words and use multiple paragraphs if needed.'),
      h2('Verdict and recommendation'),
      para('Write a clear verdict and recommendation for different reader profiles, explaining when each option is the better choice. Aim for roughly 130-170 words and use multiple paragraphs if needed.'),
      divider(),
      summary('Summarize the comparison findings in a complete conclusion that gives the reader a confident next step.'),
      refs(4),
    ];
  }

  return [
    insights('Summarize the 3 strongest comparison findings', 3),
    para('Write a concise but meaningful introduction explaining what is being compared, why it matters, and what decision the reader needs to make. Use one or two short rich paragraphs.'),
    callout('note', 'Add one line on the real evaluation lens the reader should use.'),
    h2('What each option offers'),
    para('Provide enough context for both options to frame the comparison clearly and fairly. Aim for roughly 130-170 words and use multiple paragraphs if needed.'),
    cols(2, [
      [
        h3('Option A'),
        para('Write a substantial analysis of Option A covering its strengths, tradeoffs, and best-fit use cases. Aim for roughly 110-150 words and use multiple paragraphs if needed.'),
      ],
      [
        h3('Option B'),
        para('Write a substantial analysis of Option B covering its strengths, tradeoffs, and best-fit use cases. Aim for roughly 110-150 words and use multiple paragraphs if needed.'),
      ],
    ]),
    h2('Where the choice really gets made'),
    para('Write a substantial section comparing the two options on the criteria that most strongly influence the real decision. Include tradeoffs, scenario fit, and practical implications. Aim for roughly 130-170 words and use multiple paragraphs if needed.'),
    h2('The verdict'),
    para('Write a clear recommendation explaining who should choose what and why. Aim for roughly 120-150 words and use multiple paragraphs if needed.'),
    divider(),
    summary('Write a concise but complete conclusion that helps the reader make the right choice with confidence.'),
    refs(3),
  ];
}

function buildTutorialTemplate(targetWords = 1200): ContentBlock[] {
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

function buildMagazineTemplate(targetWords = 1200): ContentBlock[] {
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

export const BLOG_DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    name: 'Classic',
    description: 'Modern editorial deep dive with a strong thesis, strategic framing moments, and a clean reading flow.',
    content_type: 'blog',
    format_type: 'standard',
    blocks: () => [
      insights('Summarize the 4-5 most important takeaways from this article', 5),
      para('Write a compelling introduction that hooks the reader, previews the thesis, and establishes why this topic matters now. Use 1-2 rich paragraphs.'),
      h2('First major section heading â€” the core problem or opportunity'),
      para('Write a substantial body section on the first major theme. Include explanation, examples, evidence, and practical implications. Use multiple paragraphs if needed.'),
      h2('Second major section heading â€” the solution, approach, or framework'),
      para('Write a substantial body section on the second theme with practical guidance, tradeoffs, and implementation detail. Use multiple paragraphs if needed.'),
      h2('Third major section heading â€” results, impact, or future outlook'),
      para('Write a substantial body section on the third theme with outcomes, forward-looking analysis, and actionable takeaways. Use multiple paragraphs if needed.'),
      divider(),
      summary('Synthesize the article into a complete conclusion that reinforces the argument and leaves the reader with a clear next step or perspective shift.'),
      refs(3),
    ],
  },
  {
    name: 'Visual Feature',
    description: 'Modern feature-story layout with hero visuals, pull-quote moments, and image-led narrative rhythm.',
    content_type: 'blog',
    format_type: 'standard',
    blocks: () => [
      insights('5 key visual insights from this feature', 5),
      cols(2, [
        [para('Write a strong introduction that sets the scene, frames the narrative, and prepares the reader for the deeper sections. Use one or two rich paragraphs.')],
        [image('Featured hero image related to the topic')],
      ]),
      h2('First section â€” the key visual narrative'),
      para('Write a substantial section exploring the first theme with vivid descriptive language, analysis, and concrete examples. Use multiple paragraphs if needed.'),
      image('Illustrative image supporting the first section'),
      h2('Second section â€” deeper dive with supporting visuals'),
      para('Write a substantial section with deeper analysis, visual references, and practical interpretation. Use multiple paragraphs if needed.'),
      image('Illustrative image supporting the second section'),
      h2('Third section â€” practical applications'),
      para('Write a substantial section with real-world applications, examples, and next-step guidance. Use multiple paragraphs if needed.'),
      divider(),
      summary('Write a complete synthesis of the visual narrative that explains what the reader should take away and do next.'),
      refs(3),
    ],
  },
  {
    name: 'Comparison',
    description: 'Decision-focused comparison layout with criteria framing, side-by-side evaluation, and a clear verdict.',
    content_type: 'blog',
    format_type: 'comparison',
    blocks: () => [
      insights('5 key comparison findings', 5),
      para('Write an introduction explaining what is being compared, why the comparison matters, and what decision the reader is trying to make. Use one or two rich paragraphs.'),
      h2('Overview of the two options/approaches'),
      para('Provide context for both options with enough detail to frame the comparison clearly and fairly. Use multiple paragraphs if needed.'),
      cols(2, [
        [
          h3('Option A â€” name and description'),
          para('Write a substantial analysis of Option A covering features, strengths, tradeoffs, and best-fit use cases. Use multiple paragraphs if needed.'),
          bulletList('Key advantages of Option A', 4),
        ],
        [
          h3('Option B â€” name and description'),
          para('Write a substantial analysis of Option B covering features, strengths, tradeoffs, and best-fit use cases. Use multiple paragraphs if needed.'),
          bulletList('Key advantages of Option B', 4),
        ],
      ]),
      h2('Head-to-head: Critical differentiators'),
      para('Write a substantial comparison of the options on the most important criteria, with clear reasoning and evidence. Use multiple paragraphs if needed.'),
      callout('insight', 'One-sentence verdict: which option wins for which use case'),
      h2('Verdict and recommendation'),
      para('Write a clear verdict and recommendation for different reader profiles, explaining when each option is the better choice. Use multiple paragraphs if needed.'),
      divider(),
      summary('Summarize the comparison findings in a complete conclusion that gives the reader a confident next step.'),
      refs(4),
    ],
  },
  {
    name: 'Tutorial',
    description: 'Modern how-to layout with a quick roadmap, practical steps, and clearer execution guidance.',
    content_type: 'blog',
    format_type: 'tutorial',
    blocks: () => [
      insights('5 key things you will learn from this tutorial', 5),
      para('Write an introduction explaining what the reader will build or achieve, why it matters, and what success looks like. Use one or two rich paragraphs.'),
      callout('note', 'Prerequisites: list what the reader needs before starting (tools, knowledge, accounts)'),
      h2('Step 1: Getting started'),
      para('Write a substantial first step with clear instructions, context, and setup guidance. Use multiple paragraphs if needed.'),
      h2('Step 2: Core implementation'),
      para('Write a substantial section for the core implementation step with detailed guidance, reasoning, and common pitfalls. Use multiple paragraphs if needed.'),
      h2('Step 3: Adding the finishing touches'),
      para('Write a substantial section for the finishing step with refinement guidance and quality checks. Use multiple paragraphs if needed.'),
      h2('Step 4: Testing and verification'),
      para('Write a substantial verification section explaining how to test, validate, and troubleshoot the outcome. Use multiple paragraphs if needed.'),
      callout('warning', 'Common mistakes to avoid and troubleshooting tips'),
      divider(),
      summary('Summarize what was accomplished, the expected outcome, and the most useful next steps for the reader.'),
      refs(3),
    ],
  },
  {
    name: 'Magazine',
    description: 'Editorial feature layout with hero imagery, pull quotes, multi-column framing, and magazine-style pacing.',
    content_type: 'blog',
    format_type: 'standard',
    blocks: () => [
      image('Full-width hero image representing the article theme'),
      insights('5 editorial insights', 5),
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
      h2('What this means going forward'),
      para('Write a substantial forward-looking analysis section with implications, consequences, and action-ready perspective. Use multiple paragraphs if needed.'),
      callout('insight', 'The key takeaway in one powerful sentence'),
      divider(),
      summary('Write a complete editorial conclusion that lands the argument and leaves the reader with a strong takeaway.'),
      refs(4),
    ],
  },
];

// â”€â”€ Article Templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const ARTICLE_DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    name: 'Narrative Article',
    description: 'Story-driven article with a strong opening, character arc, and resolution.',
    content_type: 'article',
    format_type: 'narrative',
    blocks: () => [
      insights('4 key narrative insights', 4),
      para('Write a 180-word narrative opening that draws the reader into the story'),
      h2('The scene and the challenge'),
      para('Write 250 words setting the scene with vivid detail'),
      h2('The turning point'),
      para('Write 250 words on the key moment or discovery'),
      quote('A quote from a central figure in the story'),
      h2('The outcome and wider implications'),
      para('Write 200 words on results and what they mean for the industry'),
      divider(),
      summary('Write a 150-word narrative conclusion'),
      refs(4),
    ],
  },
  {
    name: 'Investigative Deep Dive',
    description: 'Data-driven investigation with evidence sections and analysis.',
    content_type: 'article',
    format_type: 'investigative',
    blocks: () => [
      insights('5 key investigation findings', 5),
      para('Write a 150-word introduction framing the investigation'),
      h2('Background: What prompted the investigation'),
      para('Write 200 words of context and background'),
      h2('Evidence and findings'),
      para('Write 300 words presenting the core evidence and data'),
      callout('warning', 'Key finding that demands attention'),
      h2('Expert analysis'),
      cols(2, [
        [para('Write 150 words presenting the first expert perspective')],
        [para('Write 150 words presenting an alternative perspective')],
      ]),
      h2('Implications and what comes next'),
      para('Write 200 words on the broader implications'),
      divider(),
      summary('Write a 150-word summary of the investigation findings'),
      refs(5),
    ],
  },
  {
    name: 'Opinion Piece',
    description: 'Persuasive opinion article with a clear thesis and counterargument.',
    content_type: 'article',
    format_type: 'opinion',
    blocks: () => [
      para('Write a bold 150-word opening that states the thesis clearly'),
      h2('The argument'),
      para('Write 250 words building the case with evidence'),
      h2('The counterargument'),
      para('Write 150 words presenting the strongest opposing view fairly'),
      h2('Why the thesis holds'),
      para('Write 200 words rebutting the counterargument'),
      callout('insight', 'The one-sentence version of this argument'),
      divider(),
      summary('Write a 120-word conclusion reinforcing the thesis'),
      refs(3),
    ],
  },
];

// â”€â”€ Registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TEMPLATES_BY_TYPE: Record<string, DefaultTemplate[]> = {
  blog: BLOG_DEFAULT_TEMPLATES,
  article: ARTICLE_DEFAULT_TEMPLATES,
};

export function getDefaultTemplates(contentType: string): DefaultTemplate[] {
  return TEMPLATES_BY_TYPE[contentType] ?? BLOG_DEFAULT_TEMPLATES;
}

export function getDefaultBlogTemplatesRegistry(): DefaultTemplate[] {
  return BLOG_DEFAULT_TEMPLATES;
}

export function instantiateBlogDefaultTemplate(
  template: DefaultTemplate,
  targetWords?: number,
): ContentBlock[] {
  if (template.content_type !== 'blog') {
    return template.blocks(targetWords);
  }

  if (template.name === 'Classic') {
    return buildClassicTemplate(targetWords);
  }
  if (template.name === 'Visual Feature') {
    return buildVisualFeatureTemplate(targetWords);
  }
  if (template.name === 'Comparison') {
    return buildComparisonTemplate(targetWords);
  }
  if (template.name === 'Tutorial') {
    return buildTutorialTemplate(targetWords);
  }
  if (template.name === 'Magazine') {
    return buildMagazineTemplate(targetWords);
  }

  return template.blocks(targetWords);
}

/** Generate fresh ContentBlock[] from a default template (all new IDs). */
export function instantiateTemplate(template: DefaultTemplate, targetWords?: number): ContentBlock[] {
  return instantiateBlogDefaultTemplate(template, targetWords);
}
