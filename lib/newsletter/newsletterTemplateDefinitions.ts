import { newId } from '../content/blockUtils';
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
} from '../content/blockTypes';

export interface NewsletterTemplateDefinition {
  name: string;
  description: string;
  content_type: 'newsletter';
  format_type: 'insight-letter' | 'weekly-brief' | 'strategic-letter' | 'action-letter';
  blocks: (targetWords?: number) => ContentBlock[];
}

function h2(hint: string): HeadingBlock {
  return { id: newId(), type: 'heading', level: 2, text: '', anchor: '', hint };
}

function h3(hint: string): HeadingBlock {
  return { id: newId(), type: 'heading', level: 3, text: '', anchor: '', hint };
}

function fixedH2(text: string, hint: string): HeadingBlock {
  return { id: newId(), type: 'heading', level: 2, text, anchor: '', hint };
}

function fixedH3(text: string, hint: string): HeadingBlock {
  return { id: newId(), type: 'heading', level: 3, text, anchor: '', hint };
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

function buildInsightMinimalTemplate(targetWords = 1200): ContentBlock[] {
  const insightCount = targetWords >= 2000 ? 6 : targetWords >= 1600 ? 5 : targetWords >= 1200 ? 4 : 3;

  if (targetWords >= 1600) {
    return [
      insights('Capture the deepest and most reusable takeaways from this insight letter as standalone, quotable lines. Each item should feel self-contained, citable, and useful outside the main body.', insightCount),
      callout('insight', 'State the sharpest contrarian line or thesis in one sentence so the newsletter opens with conviction. Make it strong enough to stand alone in an inbox preview, quote card, or AI answer.'),
      fixedH2('Hook', 'Hook'),
      para('Write a sharp opening hook with strong voice and tension. Use 2 short paragraphs that immediately challenge a default assumption, introduce a concrete tension, and make the reader lean in.'),
      fixedH2('Context', 'Context'),
      para('Explain why this idea matters now and what has changed in the environment, incentives, or reader behavior. Include concrete stakes, present-day relevance, and one recognizable scenario the reader can picture.'),
      quote('Add a punchy line, analogy, or memorable comparison that sharpens the main idea and can be quoted on its own. The quote should feel insight-dense, not decorative, and it should be strong enough to lift into GEO surfaces directly.'),
      fixedH2('Insight', 'Insight'),
      para('Develop the central idea with layered reasoning, a mental model, and a specific frame the reader can reuse. Use multiple paragraphs with one concrete example or observed pattern, and make the mechanism explicit rather than implied.'),
      para('Ground the thesis with one concrete example, observed market behavior, or realistic scenario that proves why this way of thinking is more useful than the default view. Make the mechanism visible step by step.'),
      fixedH2('Expansion', 'Expansion'),
      para('Add the deeper layer, edge case, or hidden dynamic that makes the insight feel non-obvious and worth sharing. Explain the second-order effect clearly and show what most people still miss.'),
      para('Push the argument one level further by explaining how this hidden dynamic changes judgment, prioritization, or communication in practice. This paragraph should feel like the extra layer that makes the newsletter worth forwarding.'),
      fixedH2('Implication', 'Implication'),
      para('Explain what this changes for the reader in how they think, decide, prioritize, or communicate. Include practical consequences, a clear shift in lens, and one change the reader should make next.'),
      callout('note', 'State the one practical shift, decision lens, or changed assumption the reader should carry forward after this letter.'),
      fixedH2('Closing', 'Closing'),
      para('Close with a memorable line that feels crisp, earned, and worth forwarding. The ending should land the idea, not merely repeat it.'),
      summary('Write a strong 2-3 sentence synthesis that distills the thesis, names the changed mental model explicitly, and makes the practical shift easy to cite, forward, and reuse. The summary should read cleanly as a standalone takeaway.'),
    ];
  }

  return [
    insights('Capture the sharpest takeaways from this insight letter as standalone, quotable lines. Each item should feel clear enough to reuse outside the main body.', insightCount),
    callout('insight', 'State the sharpest contrarian line or thesis in one sentence so the newsletter opens with conviction. Make it strong enough to stand alone.'),
    fixedH2('Hook', 'Hook'),
    para('Write a concise opening hook with a sharp, contrarian observation. Give the reader enough substance to trust the point of view immediately, not just a tease.'),
    fixedH2('Context', 'Context'),
    para('Explain why this idea matters now and what has changed in the environment, incentives, or reader behavior. Include a specific tension, pressure point, or recognizable scenario.'),
    quote('Add a punchy line, analogy, or memorable comparison that sharpens the main idea and is worth saving on its own. It should be useful as a standalone extract.'),
    fixedH2('Insight', 'Insight'),
    para('Develop the central idea with clear reasoning and a reusable mental model. Make the logic explicit enough that the reader can explain it to someone else, and ground it in one concrete pattern or example.'),
    para('Add one concrete scenario, pattern, or behavior that proves the thesis in practice. Show why the default interpretation falls short and why this lens holds up better.'),
    fixedH2('Expansion', 'Expansion'),
    para('Add the deeper layer, edge case, or hidden dynamic that makes the insight feel non-obvious and worth sharing. Show what the first reading of the issue misses.'),
    fixedH2('Implication', 'Implication'),
    para('Explain what this changes for the reader in how they think, decide, prioritize, or communicate. Include a clear practical consequence and one decision shift the reader should make.'),
    callout('note', 'State the single practical shift, changed lens, or operating reminder the reader should keep from this letter.'),
    fixedH2('Closing', 'Closing'),
    para('Close with a memorable line that feels crisp, earned, and worth forwarding.'),
    summary('Write a concise 2-3 sentence synthesis that reinforces the thesis, spells out the perspective shift clearly, and feels easy to extract into inbox previews or AI answers.'),
  ];
}

function buildInsightSplitScreenTemplate(targetWords = 1200): ContentBlock[] {
  return [
    insights('Capture the deepest and most reusable takeaways from this insight letter as sharp, quotable lines.', targetWords >= 1600 ? 5 : 4),
    cols(2, [
      [
        fixedH2('Hook', 'Hook'),
        para('Write a sharp, idea-led opening that frames the thesis in a fast, high-signal way. Use enough detail that the argument feels real, not teaser-like.'),
      ],
      [
        callout('note', 'Add a compact framing note: what assumption this newsletter is challenging, why it matters now, and what the reader should notice differently.'),
      ],
    ]),
    fixedH2('Context', 'Context'),
    para('Give the reader the context they need to understand the timing, tension, or shift behind the idea. Include real stakes and present-day relevance.'),
    cols(2, [
      [
        fixedH3('The Surface Story', 'The surface story'),
        para('Explain what most people think is happening on the surface and why that interpretation feels convincing at first glance. Use enough detail that the reader recognizes the default story immediately.'),
      ],
      [
        fixedH3('The Deeper Reality', 'The deeper reality'),
        para('Reveal the deeper pattern, second-order effect, or hidden mechanism underneath it. Make the hidden dynamic explicit, concrete, and reusable as a better lens.'),
      ],
    ]),
    quote('Add one sharp line that captures the deeper reality in a way that could be quoted, highlighted, or cited on its own.'),
    para(targetWords >= 1600
      ? 'Add one grounded example, observed pattern, or realistic scenario that proves why the deeper reality is more useful than the surface story. Use enough detail that the contrast feels earned.'
      : 'Add one grounded example or recognizable pattern that makes the deeper reality feel concrete and believable.'),
    fixedH2('Insight', 'Insight'),
    para(targetWords >= 1600
      ? 'Unpack the core insight with depth, analogies, and clear logic. Show why it changes how the reader should see the topic, and use one concrete example or observed pattern to ground the reasoning.'
      : 'Unpack the core insight with a clear lens, a strong example, and a useful mental model. Make the mechanism explicit enough to be reused.'),
    fixedH2('Expansion', 'Expansion'),
    para('Push the idea one step further with a more surprising implication, edge case, or second-order effect. Show what becomes true once the reader accepts the deeper reality, and why that matters in practice.'),
    fixedH2('Implication', 'Implication'),
    para('Explain what this means in practical terms for operators, leaders, or the specific audience. Include one concrete shift in judgment, communication, or decision-making, not just a broad takeaway.'),
    fixedH2('Closing', 'Closing'),
    para('End with a short, memorable closing that lands the idea with confidence.'),
    summary('Write a concise synthesis that distills the thesis, the hidden dynamic, and the practical shift the reader should carry forward.'),
  ];
}

function buildWeeklyRadarTemplate(targetWords = 1200): ContentBlock[] {
  const signalCount = targetWords >= 1600 ? 5 : targetWords >= 1200 ? 4 : 3;
  return [
    insights('Capture the strongest weekly signals and the takeaway behind each one as quick, extractable insights.', signalCount),
    callout('note', 'Open with the one-line takeaway from the week: the signal that matters most and why.'),
    fixedH2('Week Summary', 'Week Summary'),
    para('Write a 2-3 line overview of the week, focusing on what deserves attention rather than recapping everything.'),
    fixedH2('Top Signals', 'Top Signals'),
    ...Array.from({ length: signalCount }, (_, index) => ([
      cols(2, [
        [
          fixedH3(`Signal ${index + 1}: What Happened`, `Signal ${index + 1}: What happened`),
          para('Describe the event, move, or data point clearly and concisely.'),
        ],
        [
          fixedH3('Why It Matters', 'Why it matters'),
          para('Interpret the signal and explain why a smart reader should care.'),
        ],
      ]),
    ])).flat(),
    fixedH2('Pattern', 'Pattern'),
    para('Connect the signals into one emerging pattern, trend, or strategic takeaway.'),
    fixedH2('Quick Takes', 'Quick Takes'),
    bulletList('Add short, high-signal takes that are easy to scan and still have a point of view.', targetWords >= 1600 ? 6 : 4),
    fixedH2('Closing', 'Closing'),
    para('End with the next thing to watch, the unresolved question, or the signal likely to matter next week.'),
    summary('Write a short synthesis that explains the defining pattern from the week and the implication readers should keep in mind.'),
    refs(targetWords >= 1600 ? 3 : 2),
  ];
}

function buildWeeklyBoardTemplate(targetWords = 1200): ContentBlock[] {
  const signalCount = targetWords >= 1600 ? 5 : targetWords >= 1200 ? 4 : 3;
  return [
    insights('Capture the strongest signals, interpretations, and watchlist takeaways from this week as analyst-ready bullet points.', signalCount),
    fixedH2('Week Summary', 'Week Summary'),
    para('Write a concise summary that tells the reader what this week really meant, not just what happened.'),
    cols(2, [
      [
        callout('insight', 'Highlight the most important market or category signal from the week in one sentence.'),
      ],
      [
        callout('note', 'Add a quick note on what strong teams should pay attention to next.'),
      ],
    ]),
    fixedH2('Top Signals', 'Top Signals'),
    ...Array.from({ length: signalCount }, (_, index) => ([
      fixedH3(`Signal ${index + 1}`, `Signal ${index + 1}`),
      para('Summarize the signal and explain why it matters. Keep it crisp, analytical, and useful.'),
    ])).flat(),
    fixedH2('Pattern', 'Pattern'),
    para('Connect the dots and explain the larger pattern or momentum shift these signals reveal.'),
    fixedH2('Quick Takes', 'Quick Takes'),
    numberedList('Add a list of short analyst-style takes, reactions, or observations worth scanning.', targetWords >= 1600 ? 6 : 4),
    fixedH2('Closing', 'Closing'),
    para('Close with the watchlist item, strategic question, or next move the reader should keep in mind.'),
    summary('Write a crisp analyst-style synthesis covering what changed this week, the emerging pattern, and what strong teams should watch next.'),
    refs(targetWords >= 1600 ? 3 : 2),
  ];
}

function buildStrategicMemoTemplate(targetWords = 1600): ContentBlock[] {
  return [
    insights('Capture the most important strategic shifts, opportunity frames, and decision implications from this memo.', targetWords >= 2000 ? 5 : 4),
    callout('insight', 'Lead with the strategic thesis in one sentence: what changed, why it matters, and what strong teams should do.'),
    fixedH2('Situation', 'Situation'),
    para('Set the market context and give the reader a clean read on the current strategic environment.'),
    fixedH2('Shift', 'Shift'),
    para('Identify the non-obvious change that matters more than most people realize and explain why it is easy to miss.'),
    cols(2, [
      [
        fixedH3('Forces at Play', 'Forces at play'),
        para('Break down the incentives, constraints, and drivers shaping the shift.'),
      ],
      [
        fixedH3('Why It Matters Now', 'Why it matters now'),
        para('Explain the urgency, timing, and strategic stakes of this change.'),
      ],
    ]),
    fixedH2('Analysis', 'Analysis'),
    para(targetWords >= 2000
      ? 'Write a detailed strategic analysis with leverage points, risks, positioning logic, and second-order consequences. Use multiple paragraphs.'
      : 'Write a strategic analysis that explains leverage points, risks, and the deeper logic behind the shift.'),
    fixedH2('Positioning', 'Positioning'),
    para('Explain where the opportunity sits and how category leaders should frame or defend their position.'),
    fixedH2('Strategic Moves', 'Strategic Moves'),
    bulletList('List the specific moves, decisions, or bets strong teams should consider next.', targetWords >= 2000 ? 5 : 4),
    fixedH2('Thesis', 'Thesis'),
    para('End with a strong strategic conclusion that sharpens the readerâ€™s decision-making lens.'),
    summary('Write a strategic synthesis that distills the shift, the positioning logic, and the move leaders should take seriously.'),
    refs(targetWords >= 2000 ? 3 : 2),
  ];
}

function buildStrategicMapTemplate(targetWords = 1600): ContentBlock[] {
  return [
    insights('Capture the most important market shifts, strategic implications, and positioning takeaways from this letter.', targetWords >= 2000 ? 5 : 4),
    fixedH2('Situation', 'Situation'),
    para('Frame the market context with clarity: what game is being played, who is under pressure, and what is changing.'),
    cols(2, [
      [
        fixedH3('What Most Teams See', 'What most teams see'),
        para('Describe the obvious interpretation or conventional wisdom in the market.'),
      ],
      [
        fixedH3('What Strong Teams Notice Instead', 'What strong teams notice instead'),
        para('Reveal the deeper shift, more strategic frame, or hidden leverage point.'),
      ],
    ]),
    fixedH2('Shift', 'Shift'),
    para('Explain the non-obvious shift and what makes it strategically important right now.'),
    quote('Add a crisp consultant-style line that captures the most important strategic truth in this newsletter.'),
    fixedH2('Analysis', 'Analysis'),
    para(targetWords >= 2000
      ? 'Analyze the forces, incentives, emerging power shifts, and strategic implications in detail. Use multiple paragraphs.'
      : 'Analyze the forces, incentives, and implications behind the shift with clear strategic logic.'),
    fixedH2('Positioning', 'Positioning'),
    para('Show where the opportunity is moving and how the smartest players should reposition.'),
    fixedH2('Strategic Moves', 'Strategic Moves'),
    numberedList('Lay out the sequence of strategic moves or decisions the reader should consider.', targetWords >= 2000 ? 5 : 4),
    fixedH2('Thesis', 'Thesis'),
    para('Close with a strong thesis that feels decisive, sharp, and useful for leaders.'),
    summary('Write a synthesis that clarifies the real shift, the repositioning implication, and the best next strategic move.'),
    refs(targetWords >= 2000 ? 3 : 2),
  ];
}

function buildActionPlaybookTemplate(targetWords = 1200): ContentBlock[] {
  const stepCount = targetWords >= 1600 ? 5 : targetWords >= 1200 ? 4 : 3;
  return [
    insights('Capture the most important execution lessons, operator standards, and next moves from this playbook as practical takeaways.', Math.max(3, stepCount)),
    callout('insight', 'State who this playbook is for, when to use it, and the operational result it should create when run well.'),
    fixedH2('Problem', 'Problem'),
    para('Define the concrete bottleneck, mistake, or execution gap the reader is dealing with. Make it specific, operational, and easy to recognize in a live workflow.'),
    fixedH2('Outcome', 'Outcome'),
    para('Clarify the target result and what success should look like in practical, observable terms, including what better execution should feel like on the ground.'),
    fixedH2('Framework', 'Framework'),
    para('Introduce the operating logic behind the playbook. Explain why this sequence works and what it prevents when followed in order.'),
    numberedList('Present the high-level framework in a fast, easy-to-scan sequence. Each step should sound like a real operating move, not a label.', stepCount),
    fixedH2('Breakdown', 'Breakdown'),
    ...Array.from({ length: stepCount }, (_, index) => ([
      fixedH3(`Step ${index + 1}`, `Step ${index + 1}`),
      para('Explain exactly what to do, why it matters, what good execution looks like, and what usually goes wrong if this step is skipped or rushed.'),
    ])).flat(),
    fixedH2('Mistakes', 'Mistakes'),
    bulletList('Call out the most common execution mistakes, traps, or failure patterns to avoid. Each one should feel realistic and costly.', targetWords >= 1600 ? 5 : 4),
    fixedH2('CTA', 'CTA'),
    para('Close with the immediate next action the reader should take today, including the first proof point or checkpoint they should look for.'),
    summary('Write a practical synthesis that reinforces the workflow, the execution standard, the most likely failure points, and the first action to take.'),
    refs(targetWords >= 1600 ? 2 : 1),
  ];
}

function buildActionSprintTemplate(targetWords = 1200): ContentBlock[] {
  const stepCount = targetWords >= 1600 ? 5 : targetWords >= 1200 ? 4 : 3;
  return [
    insights('Capture the most useful sprint actions, operator checkpoints, and execution reminders from this letter as short, practical prompts.', Math.max(3, stepCount)),
    callout('note', 'State when to use this sprint, what it is meant to fix fast, and the immediate outcome the reader should aim for.'),
    cols(2, [
      [
        fixedH2('Problem', 'Problem'),
        para('Describe the concrete problem or execution gap in a direct, operator-style way. Make it recognizable in live execution, not abstract.'),
      ],
      [
        fixedH2('Outcome', 'Outcome'),
        para('Define the target outcome, the KPI, or the practical result the reader wants, including what should look different once the sprint works.'),
      ],
    ]),
    fixedH2('Framework', 'Framework'),
    para('Introduce the system or sequence the reader should follow to fix the problem quickly and well. Explain why this sprint order matters.'),
    numberedList('List the sprint steps in a clear order. Each step should sound like a concrete action, not a vague stage name.', stepCount),
    fixedH2('Breakdown', 'Breakdown'),
    cols(2, [
      Array.from({ length: Math.ceil(stepCount / 2) }, (_, index) => ([
        fixedH3(`Step ${index + 1}`, `Step ${index + 1}`),
        para('Explain what to do in this step, what success looks like, and what quick check confirms the step is working.'),
      ])).flat(),
      Array.from({ length: Math.floor(stepCount / 2) }, (_, index) => ([
        fixedH3(`Step ${Math.ceil(stepCount / 2) + index + 1}`, `Step ${Math.ceil(stepCount / 2) + index + 1}`),
        para('Explain what to do in this step, what success looks like, and what quick check confirms the step is working.'),
      ])).flat(),
    ]),
    fixedH2('Mistakes', 'Mistakes'),
    bulletList('List the common traps, shortcuts, or execution mistakes that break the workflow. Make them feel like real operator mistakes.', targetWords >= 1600 ? 5 : 4),
    fixedH2('CTA', 'CTA'),
    para('End with the first action the reader should take right now to start the sprint, including the first checkpoint they should hit.'),
    summary('Write a practical synthesis that reinforces the sequence, the key execution standard, the traps to avoid, and the first step to take immediately.'),
    refs(targetWords >= 1600 ? 2 : 1),
  ];
}

export const NEWSLETTER_DEFAULT_TEMPLATES: NewsletterTemplateDefinition[] = [
  {
    name: 'Minimal Thesis',
    description: 'A sharp, modern insight-letter built for one strong idea, one memorable line, and a clean forwardable flow.',
    content_type: 'newsletter',
    format_type: 'insight-letter',
    blocks: (targetWords) => buildInsightMinimalTemplate(targetWords),
  },
  {
    name: 'Split-Screen Insight',
    description: 'A more visual insight-letter that contrasts surface thinking with deeper reality using notes, quotes, and split sections.',
    content_type: 'newsletter',
    format_type: 'insight-letter',
    blocks: (targetWords) => buildInsightSplitScreenTemplate(targetWords),
  },
  {
    name: 'Signal Radar',
    description: 'A modern weekly brief with signal cards, interpretation, a pattern read, and a strong watch-next close.',
    content_type: 'newsletter',
    format_type: 'weekly-brief',
    blocks: (targetWords) => buildWeeklyRadarTemplate(targetWords),
  },
  {
    name: 'Analyst Board',
    description: 'A compact analyst-style weekly format with signal summaries, short takes, and a cleaner scanning rhythm.',
    content_type: 'newsletter',
    format_type: 'weekly-brief',
    blocks: (targetWords) => buildWeeklyBoardTemplate(targetWords),
  },
  {
    name: 'Strategy Memo',
    description: 'A modern strategy-letter layout with thesis-led framing, market forces, and decisive strategic moves.',
    content_type: 'newsletter',
    format_type: 'strategic-letter',
    blocks: (targetWords) => buildStrategicMemoTemplate(targetWords ?? 1600),
  },
  {
    name: 'Market Map',
    description: 'A more editorial strategy-letter that compares what most teams see versus what strong teams notice early.',
    content_type: 'newsletter',
    format_type: 'strategic-letter',
    blocks: (targetWords) => buildStrategicMapTemplate(targetWords ?? 1600),
  },
  {
    name: 'Operator Playbook',
    description: 'A practical action-letter built around a clear framework, step breakdowns, and action-ready next moves.',
    content_type: 'newsletter',
    format_type: 'action-letter',
    blocks: (targetWords) => buildActionPlaybookTemplate(targetWords),
  },
  {
    name: 'Sprint Sheet',
    description: 'A faster, more operational action-letter with a split layout for steps, outcomes, and common mistakes.',
    content_type: 'newsletter',
    format_type: 'action-letter',
    blocks: (targetWords) => buildActionSprintTemplate(targetWords),
  },
];
