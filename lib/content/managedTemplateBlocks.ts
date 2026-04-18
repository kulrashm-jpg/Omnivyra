import { createBlock, newId } from '../blog/blockUtils';
import type {
  CalloutBlock,
  ColumnsBlock,
  ContentBlock,
  ListBlock,
  ReferencesBlock,
} from '../blog/blockTypes';
import type { ManagedContentType } from './contentTemplateRegistry';

function heading(text: string, hint: string, level: 2 | 3 = 2): ContentBlock {
  const block = createBlock('heading');
  if (block.type === 'heading') {
    block.level = level;
    block.text = text;
    block.hint = hint;
  }
  return block;
}

function paragraph(hint: string): ContentBlock {
  const block = createBlock('paragraph');
  if (block.type === 'paragraph') {
    block.hint = hint;
  }
  return block;
}

function keyInsights(title: string, hints: string[]): ContentBlock {
  const block = createBlock('key_insights');
  if (block.type === 'key_insights') {
    block.title = title;
    block.items = hints;
    block.hint = 'Surface the most important takeaways before the body begins.';
  }
  return block;
}

function callout(title: string, hint: string, variant: CalloutBlock['variant'] = 'insight'): ContentBlock {
  const block = createBlock('callout') as CalloutBlock;
  block.title = title;
  block.body = '';
  block.variant = variant;
  block.hint = hint;
  return block;
}

function quote(hint: string): ContentBlock {
  const block = createBlock('quote');
  if (block.type === 'quote') {
    block.hint = hint;
  }
  return block;
}

function list(hint: string, listType: ListBlock['listType'] = 'bullet', items = 3): ContentBlock {
  const block = createBlock('list') as ListBlock;
  block.listType = listType;
  block.hint = hint;
  block.items = Array.from({ length: items }, () => ({ id: newId(), text: '' }));
  return block;
}

function summary(hint: string): ContentBlock {
  const block = createBlock('summary');
  if (block.type === 'summary') {
    block.hint = hint;
  }
  return block;
}

function references(count = 3): ContentBlock {
  const block = createBlock('references') as ReferencesBlock;
  block.hint = 'Add supporting references, research, benchmarks, or primary-source material.';
  block.items = Array.from({ length: count }, () => ({ id: newId(), title: '', url: '' }));
  return block;
}

function divider(): ContentBlock {
  const block = createBlock('divider');
  if (block.type === 'divider') {
    block.variant = 'section_break';
    block.hint = 'Use a deliberate transition between major sections.';
  }
  return block;
}

function columns(columnHints: string[][]): ContentBlock {
  const block = createBlock('columns') as ColumnsBlock;
  block.columnCount = columnHints.length as 1 | 2 | 3;
  block.hint = 'Use a multi-column layout for comparisons, frameworks, or result breakdowns.';
  block.columns = columnHints.map((hints) => ({
    id: newId(),
    blocks: hints.map((hint, idx) => (idx === 0 ? heading('', hint, 3) : paragraph(hint))),
  }));
  return block;
}

function buildArticleNarrative(): ContentBlock[] {
  return [
    keyInsights('Editorial Takeaways', ['', '', '']),
    paragraph('Open with scene-setting context and a strong editorial lead.'),
    heading('The Tension Beneath the Surface', 'Frame the real problem or contradiction the article explores.'),
    paragraph('Develop context with concrete examples, stakeholder dynamics, or timely industry movement.'),
    quote('Add an expert quote, founder perspective, or interview-driven voice to humanize the piece.'),
    heading('What the Evidence Actually Shows', 'Bring in sourced proof, observations, or reported findings.'),
    columns([
      ['Explain the first major signal or data point.'],
      ['Contrast it with the second signal, constraint, or market reaction.'],
    ]),
    heading('Why This Matters Now', 'Translate the findings into implications for the reader.'),
    paragraph('Deliver analysis, interpretation, and a clear point of view instead of surface recap.'),
    summary('Close with a strong synthesis that leaves the reader with a memorable insight or next move.'),
    references(),
  ];
}

function buildArticleInvestigative(): ContentBlock[] {
  return [
    keyInsights('Key Findings', ['', '', '']),
    paragraph('Lead with the central finding and explain why it deserves attention.'),
    heading('What Prompted the Investigation', 'Establish the trigger, anomaly, or recurring issue.'),
    paragraph('Summarize the background, timeline, and key actors involved.'),
    heading('Evidence Trail', 'Lay out the reporting basis, supporting material, and validated signals.'),
    list('Break down the strongest pieces of evidence or sourced observations.', 'numbered', 4),
    callout('What Most People Miss', 'Surface the non-obvious implication or hidden pattern in the evidence.', 'note'),
    heading('Implications and Open Questions', 'Move from findings to impact, risk, and unanswered questions.'),
    summary('End with a sober conclusion that clarifies what is known, what is inferred, and what comes next.'),
    references(4),
  ];
}

function buildArticleOpinion(): ContentBlock[] {
  return [
    keyInsights('Core Thesis', ['', '', '']),
    paragraph('Open with a clear stance and why the prevailing narrative is incomplete or wrong.'),
    heading('The Main Argument', 'State the thesis in decisive terms and define the frame of debate.'),
    paragraph('Back the argument with logic, examples, and a sharp editorial voice.'),
    heading('Where the Counterargument Falls Short', 'Address objections directly instead of dodging them.'),
    callout('Counterpoint', 'Summarize the strongest opposing view and then rebut it with evidence.', 'warning'),
    heading('A Better Way to Think About It', 'Offer a framework, principle, or new lens for the reader.'),
    list('Translate the opinion into practical takeaways or decision criteria.', 'bullet', 4),
    summary('Finish with a memorable closing position and one clear implication for the audience.'),
    references(3),
  ];
}

function buildGuideComprehensive(): ContentBlock[] {
  return [
    keyInsights('Guide Snapshot', ['', '', '']),
    paragraph('Start with who this guide is for, what outcome it creates, and how to use it.'),
    heading('Core Concepts', 'Define the foundational concepts or mental model first.'),
    paragraph('Teach the core logic with clarity before moving into implementation.'),
    heading('Step-by-Step Framework', 'Walk through the full process in sequence.'),
    list('Break the workflow into clear, actionable stages.', 'numbered', 5),
    heading('Examples and Applied Patterns', 'Show how the framework looks in practice.'),
    columns([
      ['Use one column for the pattern, use case, or stage.'],
      ['Use the second column for applied example, pitfall, or implementation note.'],
    ]),
    heading('Common Mistakes and Fixes', 'Address friction points, misconceptions, and recovery moves.'),
    summary('Conclude with a recap, a deployment recommendation, and a strong next action.'),
    references(),
  ];
}

function buildGuideQuickstart(): ContentBlock[] {
  return [
    keyInsights('Quickstart Priorities', ['', '', '']),
    paragraph('Make the promise immediate: what the reader will get done in the shortest path possible.'),
    heading('Before You Start', 'List prerequisites, assumptions, or setup conditions.'),
    list('Keep the setup checklist tight and practical.', 'bullet', 4),
    heading('Fastest Path to First Win', 'Deliver the minimum viable sequence to get results quickly.'),
    list('Lay out the fast-start sequence in order.', 'numbered', 4),
    callout('Shortcut', 'Share one decision rule or shortcut that prevents wasted effort.', 'insight'),
    heading('What to Expand Next', 'Show how to deepen or scale after the first win.'),
    summary('Close with the first milestone, next step, and expected payoff.'),
    references(2),
  ];
}

function buildGuideReference(): ContentBlock[] {
  return [
    keyInsights('Reference Highlights', ['', '', '']),
    paragraph('Explain how this handbook is organized and when readers should return to it.'),
    heading('Key Definitions', 'Establish the core terms and categories first.'),
    columns([
      ['Column one can hold term definitions or category labels.'],
      ['Column two can hold meaning, context, or usage notes.'],
    ]),
    heading('Decision Matrix', 'Organize the main options, tradeoffs, or scenarios.'),
    list('Present lookup-style decision criteria or category comparisons.', 'bullet', 5),
    heading('Applied Patterns', 'Map recurring patterns to real operating situations.'),
    paragraph('Give crisp examples so the guide becomes useful in repeat use, not just first read.'),
    summary('Wrap with the highest-leverage rules of thumb and where this reference is most useful.'),
    references(3),
  ];
}

function buildStoryShort(): ContentBlock[] {
  return [
    keyInsights('Story Beat Map', ['', '', '']),
    paragraph('Hook the reader immediately with a moment, tension point, or vivid contrast.'),
    heading('Setup', 'Establish the protagonist, context, or starting condition.'),
    paragraph('Keep the setup tight and emotionally clear.'),
    heading('Tension', 'Introduce the challenge, conflict, or turning pressure.'),
    callout('Pivot Moment', 'Capture the line, realization, or decision that changes the direction of the story.', 'note'),
    heading('Resolution', 'Deliver the payoff and what changed.'),
    summary('Close with the emotional or practical takeaway the reader should carry forward.'),
  ];
}

function buildStoryLong(): ContentBlock[] {
  return [
    keyInsights('Narrative Pillars', ['', '', '']),
    paragraph('Open with a scene, voice, or moment that invites the reader into a larger journey.'),
    heading('Act I: The World Before', 'Build context, motivation, and the starting stakes.'),
    paragraph('Add scene texture, emotional context, and character perspective.'),
    heading('Act II: Escalation', 'Deepen the tension with failed attempts, new pressure, or a changing environment.'),
    quote('Use a line of dialogue, internal reflection, or external observation to deepen the emotional arc.'),
    heading('Act III: Turn and Aftermath', 'Resolve the central tension and show what changed because of it.'),
    paragraph('Let the consequences land instead of rushing to summary.'),
    summary('Finish with the meaning of the story, not just the final event.'),
  ];
}

function buildStoryEpisodic(): ContentBlock[] {
  return [
    keyInsights('Series Throughline', ['', '', '']),
    paragraph('Reintroduce the series premise and make this episode legible on its own.'),
    heading('Episode Setup', 'Anchor the reader in the current chapter and its immediate stakes.'),
    paragraph('Establish continuity while still moving the plot forward.'),
    heading('Escalation Beat', 'Advance the conflict, reveal, or relationship dynamic for this installment.'),
    heading('Cliffhanger or Reveal', 'End with a strong hook that creates momentum into the next entry.'),
    callout('Recurring Motif', 'Use one repeated image, phrase, or theme to strengthen continuity.', 'insight'),
    summary('Close with a short recap of what changed and what tension remains open.'),
  ];
}

function buildWhitepaperResearch(): ContentBlock[] {
  return [
    keyInsights('Executive Findings', ['', '', '']),
    paragraph('Lead with the central thesis, the audience problem, and why the findings matter now.'),
    heading('Research Context', 'Define the market context, problem statement, and scope of inquiry.'),
    paragraph('Explain the pressure, timing, and relevance behind this whitepaper.'),
    heading('Methodology', 'Document the evidence base, data source logic, or analytical method.'),
    list('Present the methodology or evidence sources in a numbered sequence.', 'numbered', 4),
    heading('Findings', 'Lay out the key findings in a structured way.'),
    columns([
      ['Use this column for finding one and its support.'],
      ['Use this column for finding two or contrasting signal.'],
    ]),
    heading('Implications', 'Translate findings into strategic meaning for the reader.'),
    summary('End with the highest-confidence takeaway and a practical recommendation.'),
    references(4),
  ];
}

function buildWhitepaperStrategic(): ContentBlock[] {
  return [
    keyInsights('Strategic Takeaways', ['', '', '']),
    paragraph('Open with the business context, executive stakes, and the decision this paper supports.'),
    heading('Market Reality', 'Summarize the market forces, constraints, or shifts the reader must account for.'),
    callout('Strategic Tension', 'Name the tension between current behavior and the future state required.', 'warning'),
    heading('Decision Framework', 'Introduce the lens or framework used to evaluate options.'),
    columns([
      ['Option or pathway A with upside and risk.'],
      ['Option or pathway B with upside and risk.'],
      ['Recommended posture and why it wins.'],
    ]),
    heading('Recommended Moves', 'Turn the framework into a prioritized action set.'),
    list('Break recommendations into strategic actions, in priority order.', 'numbered', 4),
    summary('Close with the clearest strategic position and what leadership should do next.'),
    references(3),
  ];
}

function buildWhitepaperTechnical(): ContentBlock[] {
  return [
    keyInsights('Technical Highlights', ['', '', '']),
    paragraph('State the technical problem, environment, and why existing approaches fall short.'),
    heading('System Architecture', 'Describe the architecture, components, and important constraints.'),
    columns([
      ['Component or layer one and its role.'],
      ['Component or layer two and its role.'],
    ]),
    heading('Implementation Approach', 'Walk through the implementation model or delivery sequence.'),
    list('Break the implementation path into technical stages.', 'numbered', 5),
    heading('Risks and Tradeoffs', 'Acknowledge constraints, security, scale, or operational tradeoffs.'),
    callout('Engineering Note', 'Surface one critical implementation caveat or decision dependency.', 'note'),
    summary('End with the recommended technical posture and what an operator should do next.'),
    references(4),
  ];
}

function buildCaseStudyResults(): ContentBlock[] {
  return [
    keyInsights('Results Snapshot', ['', '', '']),
    paragraph('Introduce the customer, context, and measurable outcome at a glance.'),
    heading('Challenge', 'Clarify the original business problem and why it mattered.'),
    paragraph('Describe the stakes, constraints, and consequences of inaction.'),
    heading('Solution', 'Explain the intervention, rollout, and what was materially different.'),
    columns([
      ['What changed operationally or strategically.'],
      ['What enabled the change to stick or scale.'],
    ]),
    heading('Results', 'Present the measurable outcomes and supporting proof.'),
    list('Highlight the most important gains or business results.', 'bullet', 4),
    summary('Close with the broader lesson and the next step for similar buyers.'),
  ];
}

function buildCaseStudyTransformation(): ContentBlock[] {
  return [
    keyInsights('Transformation Highlights', ['', '', '']),
    paragraph('Set up the before-state clearly so the transformation has weight.'),
    heading('Before', 'Describe the previous reality, bottlenecks, and pressure points.'),
    paragraph('Ground the reader in the cost of staying the same.'),
    heading('Intervention', 'Walk through the change process and what shifted first.'),
    quote('Use a customer or operator voice to make the transition feel real.'),
    heading('After', 'Show the post-change state with concrete evidence and narrative payoff.'),
    summary('Finish with what the transformation proves, not just what happened.'),
  ];
}

function buildCaseStudyProofBreakdown(): ContentBlock[] {
  return [
    keyInsights('Proof Themes', ['', '', '']),
    paragraph('Lead with the decision-critical proof and why it should matter to a buyer.'),
    heading('Context', 'Frame the operating context, stakes, and buyer concern.'),
    heading('Mechanism', 'Explain how the intervention created the result, not just that it happened.'),
    columns([
      ['Input, change, or capability introduced.'],
      ['Observed effect, result, or downstream impact.'],
    ]),
    heading('Outcome Evidence', 'Present hard proof, validation points, and result mechanics.'),
    callout('Buyer Relevance', 'Translate proof into a buyer-facing implication or objection answer.', 'insight'),
    summary('End with a concise why-this-matters takeaway for similar prospects.'),
  ];
}

function buildPostTemplate(): ContentBlock[] {
  return [
    keyInsights('Post Structure', ['', '', '']),
    paragraph('Open with a hook that earns attention in the first one or two lines.'),
    callout('Core Insight', 'State the strongest point of view or practical lesson in concise language.', 'insight'),
    list('Break the supporting points into short, scannable ideas.', 'bullet', 3),
    summary('Close with a memorable takeaway and a clear CTA or conversational next step.'),
  ];
}

function buildThreadTemplate(): ContentBlock[] {
  return [
    keyInsights('Thread Arc', ['', '', '']),
    paragraph('Lead with a scroll-stopping opening post that frames the promise of the thread.'),
    heading('Body Sequence', 'Map the thread so each section carries one idea and sets up the next.'),
    list('Outline the post-by-post flow before writing the final sequence.', 'numbered', 5),
    callout('Payoff Post', 'Reserve the final section for the clearest takeaway, recommendation, or CTA.', 'note'),
    summary('Use the ending to resolve the thread and reinforce the central lesson.'),
  ];
}

export function buildManagedTemplateBlocks(
  contentType: ManagedContentType,
  formatType?: string | null,
): ContentBlock[] {
  if (contentType === 'article') {
    if (formatType === 'investigative') return buildArticleInvestigative();
    if (formatType === 'opinion') return buildArticleOpinion();
    return buildArticleNarrative();
  }

  if (contentType === 'guide') {
    if (formatType === 'quickstart') return buildGuideQuickstart();
    if (formatType === 'reference') return buildGuideReference();
    return buildGuideComprehensive();
  }

  if (contentType === 'story') {
    if (formatType === 'long_story') return buildStoryLong();
    if (formatType === 'episodic_story') return buildStoryEpisodic();
    return buildStoryShort();
  }

  if (contentType === 'whitepaper') {
    if (formatType === 'strategic') return buildWhitepaperStrategic();
    if (formatType === 'technical') return buildWhitepaperTechnical();
    return buildWhitepaperResearch();
  }

  if (contentType === 'case-study') {
    if (formatType === 'transformation') return buildCaseStudyTransformation();
    if (formatType === 'proof-breakdown') return buildCaseStudyProofBreakdown();
    return buildCaseStudyResults();
  }

  if (contentType === 'post') {
    return buildPostTemplate();
  }

  if (contentType === 'thread') {
    return buildThreadTemplate();
  }

  return [
    keyInsights('Key Takeaways', ['', '', '']),
    paragraph('Open with context and intent.'),
    heading('Main Section', 'Develop the central argument or lesson.'),
    paragraph('Expand with evidence, explanation, and practical meaning.'),
    summary('Close with the strongest takeaway and next action.'),
  ];
}
