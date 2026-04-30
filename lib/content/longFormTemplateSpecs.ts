import type { LongFormContentType } from './longFormContentTypeConfig';

export interface TemplateSectionSpec {
  id: string;
  label: string;
  intent: string;
  section_goal: string;
  content_type: string;
  depth_requirement: string;
  wordWeight: number;
  required: boolean;
  outputConstraints: readonly string[];
}

export interface LongFormTemplateSpec {
  contentType: LongFormContentType;
  formatType: string;
  templateName?: string;
  sections: readonly TemplateSectionSpec[];
  outputConstraints: readonly string[];
}

const keyInsights: TemplateSectionSpec = {
  id: 'key_insights',
  label: 'Key Insights',
  intent: 'Expose the core takeaways as standalone extraction surfaces.',
  section_goal: 'Summarize the original takeaways a reader should remember before entering the body.',
  content_type: 'insight',
  depth_requirement: 'Use concrete, non-overlapping takeaways that can stand alone in snippets.',
  wordWeight: 0.08,
  required: true,
  outputConstraints: ['Use complete, specific sentences', 'Avoid repeating section headings'],
};

const references: TemplateSectionSpec = {
  id: 'references',
  label: 'References',
  intent: 'Anchor the piece in credible source material and support GEO authority.',
  section_goal: 'Support claims with credible source material when real references are available.',
  content_type: 'evidence',
  depth_requirement: 'Use only real sources that match the claim; omit invented placeholder citations.',
  wordWeight: 0.05,
  required: true,
  outputConstraints: ['Use credible titles and URLs', 'Do not invent niche studies or companies'],
};

export const longFormTemplateSpecs: Record<string, LongFormTemplateSpec> = {
  'blog:standard': {
    contentType: 'blog',
    formatType: 'standard',
    sections: [
      keyInsights,
      { id: 'hook', label: 'Hook Intro', intent: 'Frame the tension and thesis without opening with a question.', section_goal: 'Establish the core tension, thesis, and reader stakes without answering the whole piece.', content_type: 'explanation', depth_requirement: 'Make the opening specific to the topic, audience, and brand context.', wordWeight: 0.12, required: true, outputConstraints: ['120-180 words', 'Use the selected angle hook when provided'] },
      { id: 'body', label: 'H2 Body Sections', intent: 'Build a progressive argument with examples, data, implications, and takeaways.', section_goal: 'Develop differentiated H2 sections where each section advances a new part of the argument.', content_type: 'mixed', depth_requirement: 'Include explanation, application, examples, and insights with no thin or repeated sections.', wordWeight: 0.68, required: true, outputConstraints: ['Use 3-7 H2 sections based on word tier', 'No thin sections'] },
      { id: 'summary', label: 'Summary', intent: 'Synthesize the argument and tell the reader what changes next.', section_goal: 'Convert the argument into a clear final takeaway and next decision.', content_type: 'summary', depth_requirement: 'Synthesize rather than repeat prior section headings.', wordWeight: 0.07, required: true, outputConstraints: ['Standalone conclusion', 'Do not repeat headings'] },
      references,
    ],
    outputConstraints: ['Return JSON with title, excerpt, content_html, tags, category, SEO fields, key_insights'],
  },
  'blog:listicle': {
    contentType: 'blog',
    formatType: 'listicle',
    sections: [
      keyInsights,
      { id: 'intro', label: 'Hook Intro', intent: 'Explain why this list matters now.', section_goal: 'Explain the list premise and why these items matter now.', content_type: 'explanation', depth_requirement: 'Set up the selection logic and avoid generic list framing.', wordWeight: 0.12, required: true, outputConstraints: ['No question opener'] },
      { id: 'items', label: 'Numbered Items', intent: 'Each item must carry a distinct actionable insight.', section_goal: 'Give each numbered item a unique job, example, and implication.', content_type: 'application', depth_requirement: 'Every item must add a new point and avoid repeating previous advice.', wordWeight: 0.73, required: true, outputConstraints: ['5-10 numbered H2 items', 'Each item needs example or implication'] },
      { id: 'summary', label: 'Summary', intent: 'Distill the most important items into a decision path.', section_goal: 'Turn the list into a decision path the reader can act on.', content_type: 'summary', depth_requirement: 'Prioritize the most important decision logic rather than restating every item.', wordWeight: 0.10, required: true, outputConstraints: ['100-150 words'] },
      references,
    ],
    outputConstraints: ['Preserve numbered H2 structure'],
  },
  'blog:tutorial': {
    contentType: 'blog',
    formatType: 'tutorial',
    sections: [
      keyInsights,
      { id: 'prerequisites', label: 'Prerequisites', intent: 'Make the starting state explicit before steps begin.', section_goal: 'Define the starting conditions required before execution.', content_type: 'explanation', depth_requirement: 'Name tools, access, knowledge, and assumptions clearly.', wordWeight: 0.10, required: true, outputConstraints: ['Tools, knowledge, access, setup'] },
      { id: 'steps', label: 'Steps', intent: 'Teach action, rationale, success check, and failure mode per step.', section_goal: 'Teach the implementation sequence with rationale and validation checks.', content_type: 'application', depth_requirement: 'Each step needs an action, why it matters, success signal, and failure mode.', wordWeight: 0.68, required: true, outputConstraints: ['Sequential H2 steps', 'Include what success looks like'] },
      { id: 'mistakes', label: 'Common Mistakes', intent: 'Prevent predictable implementation failure.', section_goal: 'Identify failure patterns and show how to avoid or repair them.', content_type: 'insight', depth_requirement: 'Explain the consequence and fix for each mistake.', wordWeight: 0.10, required: true, outputConstraints: ['3-5 mistakes with fixes'] },
      { id: 'summary', label: 'Summary', intent: 'Confirm what was achieved and what to do next.', section_goal: 'Confirm the outcome and next practical move.', content_type: 'summary', depth_requirement: 'Make the close action-oriented and non-repetitive.', wordWeight: 0.07, required: true, outputConstraints: ['Action-oriented'] },
      references,
    ],
    outputConstraints: ['Do not underwrite step explanations'],
  },
  'blog:comparison': {
    contentType: 'blog',
    formatType: 'comparison',
    sections: [
      keyInsights,
      { id: 'overview', label: 'Overview', intent: 'Define the decision context and options.', section_goal: 'Define the decision context, options, and evaluation criteria.', content_type: 'explanation', depth_requirement: 'Make the comparison criteria explicit before judging options.', wordWeight: 0.15, required: true, outputConstraints: ['Name comparison criteria'] },
      { id: 'criteria', label: 'Comparison Criteria', intent: 'Compare options against the same decision criteria.', section_goal: 'Evaluate each option against shared criteria with balanced tradeoffs.', content_type: 'comparison', depth_requirement: 'Use the same criteria for each option and support tradeoffs with examples.', wordWeight: 0.55, required: true, outputConstraints: ['Balanced tradeoffs', 'No unsupported winner'] },
      { id: 'pros_cons', label: 'Pros and Cons', intent: 'Make tradeoffs scannable.', section_goal: 'Make the practical advantages and drawbacks easy to scan.', content_type: 'comparison', depth_requirement: 'Separate options clearly and avoid repeating the criteria section.', wordWeight: 0.12, required: true, outputConstraints: ['Separate options clearly'] },
      { id: 'verdict', label: 'Verdict', intent: 'Give scenario-specific recommendation logic.', section_goal: 'Give a decisive recommendation by scenario.', content_type: 'insight', depth_requirement: 'Explain choose-X-if and choose-Y-if logic with brand-aware judgment.', wordWeight: 0.13, required: true, outputConstraints: ['Choose X if / choose Y if'] },
      references,
    ],
    outputConstraints: ['Keep verdict decisive and evidence-aware'],
  },
  'newsletter:strategy memo': {
    contentType: 'newsletter',
    formatType: 'strategic-letter',
    templateName: 'Strategy Memo',
    sections: [
      { id: 'thesis', label: 'Thesis', intent: 'State the strategic argument in a forwardable way.', section_goal: 'State the memo thesis as a concise, opinionated strategic claim.', content_type: 'insight', depth_requirement: 'Make the POV specific enough to forward without extra context.', wordWeight: 0.12, required: true, outputConstraints: ['Clear POV'] },
      { id: 'context', label: 'Context', intent: 'Explain why the decision matters now.', section_goal: 'Explain the current stakes and why the reader should revisit the decision now.', content_type: 'explanation', depth_requirement: 'Connect market, audience, or operational context to immediate stakes.', wordWeight: 0.22, required: true, outputConstraints: ['Current stakes'] },
      { id: 'analysis', label: 'Analysis', intent: 'Develop the operating logic behind the recommendation.', section_goal: 'Develop the operating logic and tradeoffs behind the recommendation.', content_type: 'framework', depth_requirement: 'Use a clear model, concrete tradeoffs, and non-obvious implications.', wordWeight: 0.46, required: true, outputConstraints: ['Use concrete tradeoffs'] },
      { id: 'implications', label: 'Implications', intent: 'Translate insight into choices for the reader.', section_goal: 'Translate the analysis into practical choices and next steps.', content_type: 'application', depth_requirement: 'Make implications actionable and tied to reader decisions.', wordWeight: 0.15, required: true, outputConstraints: ['Actionable next steps'] },
      references,
    ],
    outputConstraints: ['Keep extraction surfaces strong: key insights, callouts, quotes, summary'],
  },
  'newsletter:operator playbook': {
    contentType: 'newsletter',
    formatType: 'action-letter',
    templateName: 'Operator Playbook',
    sections: [
      { id: 'problem', label: 'Problem Pattern', intent: 'Name the operating problem clearly.', section_goal: 'Name the recurring operating problem and show where it appears in a workflow.', content_type: 'explanation', depth_requirement: 'Use a concrete workflow rather than broad business language.', wordWeight: 0.14, required: true, outputConstraints: ['Use a concrete workflow'] },
      { id: 'framework', label: 'Framework', intent: 'Give a reusable action model.', section_goal: 'Introduce a reusable action model for solving the problem.', content_type: 'framework', depth_requirement: 'Use 3-5 steps or pillars with clear sequence and ownership.', wordWeight: 0.24, required: true, outputConstraints: ['3-5 steps or pillars'] },
      { id: 'execution', label: 'Execution Breakdown', intent: 'Explain how to apply the framework in practice.', section_goal: 'Show how to apply the framework in practice with checks and failure modes.', content_type: 'application', depth_requirement: 'Explain concrete sequence, handoffs, and failure modes.', wordWeight: 0.45, required: true, outputConstraints: ['Concrete sequence', 'Failure modes'] },
      { id: 'cta', label: 'Action Close', intent: 'Leave the reader with one immediate move.', section_goal: 'Close with one immediate action that follows from the playbook.', content_type: 'summary', depth_requirement: 'Keep the action specific, low-friction, and tied to the problem pattern.', wordWeight: 0.12, required: true, outputConstraints: ['Specific and low-friction'] },
      references,
    ],
    outputConstraints: ['Actionable, dense, and non-generic'],
  },
};

export function getTemplateSpecKey(
  contentType: LongFormContentType,
  formatType?: string,
  templateName?: string,
): string {
  const normalizedTemplate = templateName?.trim().toLowerCase();
  if (contentType === 'newsletter' && normalizedTemplate) return `${contentType}:${normalizedTemplate}`;
  return `${contentType}:${(formatType || 'standard').trim().toLowerCase()}`;
}

export function getLongFormTemplateSpec(
  contentType: LongFormContentType,
  formatType?: string,
  templateName?: string,
): LongFormTemplateSpec | null {
  return longFormTemplateSpecs[getTemplateSpecKey(contentType, formatType, templateName)]
    || longFormTemplateSpecs[`${contentType}:${(formatType || '').trim().toLowerCase()}`]
    || null;
}
