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

// Agent-B split: block builders + template builders live in ./defaultBlockTemplatesBuilders(+B).
import { DefaultTemplate, buildClassicTemplate, buildComparisonTemplate, buildVisualFeatureTemplate, bulletList, callout, cols, divider, h2, h3, image, insights, numberedList, para, quote, refs, summary } from './defaultBlockTemplatesBuilders';
import { buildMagazineTemplate, buildTutorialTemplate } from './defaultBlockTemplatesBuildersB';
export type { DefaultTemplate } from './defaultBlockTemplatesBuilders';

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
