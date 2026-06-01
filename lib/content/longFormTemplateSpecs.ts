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
      { id: 'hook', label: 'Market Tension', intent: 'Frame the tension and thesis without opening with a question.', section_goal: 'Establish the core tension, thesis, and reader stakes without answering the whole piece.', content_type: 'explanation', depth_requirement: 'Make the opening specific to the topic, audience, and brand context.', wordWeight: 0.12, required: true, outputConstraints: ['120-180 words', 'Use the selected angle hook when provided'] },
      { id: 'body', label: 'Strategic Argument', intent: 'Build a progressive argument with examples, data, implications, and takeaways.', section_goal: 'Develop differentiated H2 sections where each section advances a new part of the argument.', content_type: 'mixed', depth_requirement: 'Include explanation, application, examples, and insights with no thin or repeated sections.', wordWeight: 0.68, required: true, outputConstraints: ['Use 3-7 H2 sections based on word tier', 'No thin sections'] },
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
      { id: 'intro', label: 'Selection Logic', intent: 'Explain why this list matters now.', section_goal: 'Explain the list premise and why these items matter now.', content_type: 'explanation', depth_requirement: 'Set up the selection logic and avoid generic list framing.', wordWeight: 0.12, required: true, outputConstraints: ['No question opener'] },
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
  'story:short_story': {
    contentType: 'story',
    formatType: 'short_story',
    sections: [
      { id: 'moment', label: 'The Moment Everything Shifted', intent: 'Open inside a concrete personal or team experience instead of explaining the topic.', section_goal: 'Put the reader into a real-feeling scene where a person, founder, operator, customer, or team experiences the tension.', content_type: 'scene', depth_requirement: 'Use sensory detail, a specific protagonist or team, a small anecdote, and immediate stakes.', wordWeight: 0.24, required: true, outputConstraints: ['No key-insight list', 'No generic business intro', 'Include a lived-experience detail'] },
      { id: 'friction', label: 'The Friction Underneath', intent: 'Reveal the conflict through anecdote and consequence.', section_goal: 'Show the pressure, mistaken assumption, unresolved decision, or awkward moment behind the scene.', content_type: 'conflict', depth_requirement: 'Build tension through choices, consequences, internal doubt, and a concrete incident.', wordWeight: 0.30, required: true, outputConstraints: ['Story beat, not advice section', 'Include at least one anecdotal detail'] },
      { id: 'turn', label: 'The Turn', intent: 'Deliver the realization or decision through an experience.', section_goal: 'Show what changed, what someone noticed, and why the previous path no longer worked.', content_type: 'turning_point', depth_requirement: 'Make the insight emerge from action, observation, or a remembered line.', wordWeight: 0.28, required: true, outputConstraints: ['No framework heading', 'No executive-summary language', 'Use a memorable moment or line'] },
      { id: 'meaning', label: 'What Stayed With Them', intent: 'Close with reflection and meaning from the experience.', section_goal: 'Leave the reader with the lesson, emotional aftertaste, and practical implication from the protagonist’s experience.', content_type: 'reflection', depth_requirement: 'Resolve the story without becoming a generic summary.', wordWeight: 0.18, required: true, outputConstraints: ['Reflection, not Summary', 'Tie back to the person/team experience'] },
    ],
    outputConstraints: ['Use story beats as H2s', 'No Key Insights block', 'No References block unless real sources are essential'],
  },
  'story:long_story': {
    contentType: 'story',
    formatType: 'long_story',
    sections: [
      { id: 'scene', label: 'The Scene', intent: 'Establish place, people, stakes, and lived texture.', section_goal: 'Open with a vivid situation around a person, founder, operator, customer, or team.', content_type: 'scene', depth_requirement: 'Anchor the story in concrete human detail, anecdote, and observation.', wordWeight: 0.18, required: true, outputConstraints: ['Scene first', 'Include a protagonist or team'] },
      { id: 'pressure', label: 'The Pressure Builds', intent: 'Escalate conflict through incidents.', section_goal: 'Develop complications, competing pressures, and small moments that reveal the stakes.', content_type: 'conflict', depth_requirement: 'Show tension through decisions, consequences, and personal/team reactions.', wordWeight: 0.26, required: true, outputConstraints: ['No abstract explainer', 'Use anecdotal escalation'] },
      { id: 'choice', label: 'The Choice', intent: 'Reveal the decisive experiential moment.', section_goal: 'Show the choice or realization that changes the path.', content_type: 'turning_point', depth_requirement: 'Make the choice feel earned by prior scenes and a remembered detail.', wordWeight: 0.24, required: true, outputConstraints: ['One clear turn', 'Use a memorable line or incident'] },
      { id: 'after', label: 'After the Turn', intent: 'Show what changed after the decision.', section_goal: 'Demonstrate consequences, learning, and changed behavior through visible action.', content_type: 'resolution', depth_requirement: 'Tie change to observable behavior, not abstract advice.', wordWeight: 0.20, required: true, outputConstraints: ['Show aftermath', 'Keep the protagonist/team visible'] },
      { id: 'reflection', label: 'The Lesson That Remained', intent: 'Close with meaning from the experience.', section_goal: 'Translate the story into a resonant lesson for the reader.', content_type: 'reflection', depth_requirement: 'Keep it reflective and human, not promotional.', wordWeight: 0.12, required: true, outputConstraints: ['No summary list', 'End with emotional or practical resonance'] },
    ],
    outputConstraints: ['Narrative arc only', 'No generic article sections'],
  },
  'story:episodic_story': {
    contentType: 'story',
    formatType: 'episodic_story',
    sections: [
      { id: 'cold_open', label: 'Cold Open', intent: 'Start mid-tension.', section_goal: 'Open with an unresolved moment that makes the reader continue.', content_type: 'scene', depth_requirement: 'Use immediate stakes and a clear unresolved question.', wordWeight: 0.22, required: true, outputConstraints: ['No preamble'] },
      { id: 'backstory', label: 'How They Got There', intent: 'Reveal necessary context.', section_goal: 'Explain just enough backstory to make the tension meaningful.', content_type: 'context', depth_requirement: 'Keep context in narrative motion.', wordWeight: 0.24, required: true, outputConstraints: ['Context through action'] },
      { id: 'complication', label: 'The Complication', intent: 'Make the situation harder.', section_goal: 'Introduce the obstacle or discovery that changes the stakes.', content_type: 'conflict', depth_requirement: 'Escalate without resolving too early.', wordWeight: 0.28, required: true, outputConstraints: ['Escalate tension'] },
      { id: 'cliffhanger', label: 'The Unanswered Question', intent: 'End with a continuation hook.', section_goal: 'Close with a meaningful unresolved question or next episode setup.', content_type: 'cliffhanger', depth_requirement: 'Leave momentum without feeling incomplete.', wordWeight: 0.26, required: true, outputConstraints: ['Clear continuation hook'] },
    ],
    outputConstraints: ['Episode structure', 'End with forward momentum'],
  },
  'article:narrative': {
    contentType: 'article',
    formatType: 'narrative',
    sections: [
      { id: 'lede', label: 'The Editorial Lede', intent: 'Open with a reported observation or tension, not a tutorial setup.', section_goal: 'Frame the article angle, why it matters now, and what question the piece will investigate.', content_type: 'explanation', depth_requirement: 'Use an editorial lede with specificity, context, and stakes; avoid SEO explainer language.', wordWeight: 0.16, required: true, outputConstraints: ['No guide-style intro', 'No generic market preamble'] },
      { id: 'context', label: 'The Context Behind the Shift', intent: 'Explain the forces or behavior changing the topic.', section_goal: 'Show what changed in the market, audience, or operating environment.', content_type: 'insight', depth_requirement: 'Balance observation, evidence, and interpretation without becoming a checklist.', wordWeight: 0.24, required: true, outputConstraints: ['Use concrete context', 'Avoid step-by-step instructions'] },
      { id: 'analysis', label: 'What the Pattern Reveals', intent: 'Develop the article thesis through analysis.', section_goal: 'Interpret the pattern and explain the implications for the reader.', content_type: 'insight', depth_requirement: 'Make a distinct editorial argument with implications and tradeoffs.', wordWeight: 0.30, required: true, outputConstraints: ['Opinionated but balanced', 'No repeated framing'] },
      { id: 'implications', label: 'The Implication for Leaders', intent: 'Translate the article into business meaning.', section_goal: 'Explain what the reader should reconsider, monitor, or decide differently.', content_type: 'application', depth_requirement: 'Tie the article to business implications without turning it into a guide.', wordWeight: 0.20, required: true, outputConstraints: ['Business implications', 'No generic summary'] },
      { id: 'close', label: 'Closing Perspective', intent: 'Close with an implication-led synthesis.', section_goal: 'Leave the reader with a clear editorial takeaway and next question.', content_type: 'summary', depth_requirement: 'Synthesize the article angle without restating section headings.', wordWeight: 0.10, required: true, outputConstraints: ['Implication-led close'] },
      references,
    ],
    outputConstraints: ['Use article headings and an editorial lede', 'Do not use guide, blog, or newsletter scaffolding'],
  },
  'article:investigative': {
    contentType: 'article',
    formatType: 'investigative',
    sections: [
      { id: 'question', label: 'The Question Worth Investigating', intent: 'Define the central question and stakes.', section_goal: 'Name the question, why it is unresolved, and who is affected.', content_type: 'explanation', depth_requirement: 'Use precise framing and evidence-aware caution.', wordWeight: 0.14, required: true, outputConstraints: ['State the investigation question'] },
      { id: 'evidence', label: 'What the Evidence Suggests', intent: 'Gather the available signals.', section_goal: 'Explain the evidence, examples, or observable signals that support the article.', content_type: 'evidence', depth_requirement: 'Separate observation from inference and avoid invented proof.', wordWeight: 0.30, required: true, outputConstraints: ['No fake citations', 'Signal vs inference'] },
      { id: 'counterpoint', label: 'Where the Easy Explanation Falls Short', intent: 'Pressure-test the obvious explanation.', section_goal: 'Show why a common interpretation is incomplete.', content_type: 'comparison', depth_requirement: 'Include competing viewpoints and tradeoffs.', wordWeight: 0.22, required: true, outputConstraints: ['Balanced counterpoint'] },
      { id: 'finding', label: 'The Deeper Finding', intent: 'Deliver the article-level finding.', section_goal: 'State the more useful conclusion and its implications.', content_type: 'insight', depth_requirement: 'Make the finding specific, defensible, and non-generic.', wordWeight: 0.24, required: true, outputConstraints: ['Specific finding'] },
      { id: 'close', label: 'What to Watch Next', intent: 'Close with forward-looking implications.', section_goal: 'Name the signals readers should monitor next.', content_type: 'summary', depth_requirement: 'Avoid a promotional CTA; end with useful judgment.', wordWeight: 0.10, required: true, outputConstraints: ['Forward-looking close'] },
      references,
    ],
    outputConstraints: ['Investigation structure only', 'Separate evidence, counterpoint, and finding'],
  },
  'article:opinion': {
    contentType: 'article',
    formatType: 'opinion',
    sections: [
      { id: 'claim', label: 'The Claim', intent: 'State a strong editorial claim.', section_goal: 'Open with the point of view and why the old framing is insufficient.', content_type: 'insight', depth_requirement: 'Make the claim specific, defensible, and grounded in audience stakes.', wordWeight: 0.18, required: true, outputConstraints: ['Clear claim', 'No generic opener'] },
      { id: 'why_now', label: 'Why This Matters Now', intent: 'Explain the timing and relevance.', section_goal: 'Connect the claim to current market, operational, or buyer pressure.', content_type: 'explanation', depth_requirement: 'Use concrete pressure rather than broad trend language.', wordWeight: 0.22, required: true, outputConstraints: ['Specific timing'] },
      { id: 'argument', label: 'The Argument', intent: 'Develop the reasoning behind the opinion.', section_goal: 'Build the argument with reasoning, examples, and tradeoffs.', content_type: 'insight', depth_requirement: 'Use distinct premises and avoid repeating the claim.', wordWeight: 0.34, required: true, outputConstraints: ['Distinct premises'] },
      { id: 'objection', label: 'The Objection Leaders Should Take Seriously', intent: 'Handle the strongest counterargument.', section_goal: 'Acknowledge the best objection and explain how to think about it.', content_type: 'comparison', depth_requirement: 'Be fair, specific, and useful.', wordWeight: 0.16, required: true, outputConstraints: ['Strongest counterargument'] },
      { id: 'close', label: 'The Better Bet', intent: 'End with a clear editorial recommendation.', section_goal: 'Translate the opinion into a strategic bet or decision lens.', content_type: 'summary', depth_requirement: 'Close with judgment, not a generic recap.', wordWeight: 0.10, required: true, outputConstraints: ['Judgment-led close'] },
      references,
    ],
    outputConstraints: ['Opinionated article structure', 'Include the strongest counterargument'],
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
  'newsletter:weekly-brief': {
    contentType: 'newsletter',
    formatType: 'weekly-brief',
    sections: [
      { id: 'opening_note', label: 'Opening Note', intent: 'Set the issue theme in an inbox-native voice.', section_goal: 'Explain the signal readers should pay attention to this week.', content_type: 'insight', depth_requirement: 'Keep it concise, opinionated, and forwardable.', wordWeight: 0.16, required: true, outputConstraints: ['Inbox-native', 'No blog intro'] },
      { id: 'signal', label: 'The Signal', intent: 'Name the important market or operating signal.', section_goal: 'Surface the most important change, pattern, or observation.', content_type: 'insight', depth_requirement: 'Make the signal specific and easy to repeat.', wordWeight: 0.24, required: true, outputConstraints: ['Specific signal'] },
      { id: 'why_it_matters', label: 'Why It Matters', intent: 'Translate the signal into reader relevance.', section_goal: 'Explain the business implication for the reader.', content_type: 'application', depth_requirement: 'Connect signal to decision, risk, or opportunity.', wordWeight: 0.26, required: true, outputConstraints: ['Business implication'] },
      { id: 'operator_note', label: 'Operator Note', intent: 'Give one practical observation or action.', section_goal: 'Offer a concise action, check, or caution based on the signal.', content_type: 'application', depth_requirement: 'Keep it practical and specific.', wordWeight: 0.20, required: true, outputConstraints: ['One useful move'] },
      { id: 'watch', label: 'What to Watch', intent: 'Close with a forward-looking watch item.', section_goal: 'Name what readers should monitor next.', content_type: 'summary', depth_requirement: 'End with a useful watch item, not a summary paragraph.', wordWeight: 0.14, required: true, outputConstraints: ['Forward-looking'] },
    ],
    outputConstraints: ['Newsletter issue structure', 'No blog body scaffold', 'Short, scannable sections'],
  },
  'newsletter:insight-letter': {
    contentType: 'newsletter',
    formatType: 'insight-letter',
    sections: [
      { id: 'letter_open', label: 'Letter Open', intent: 'Open like a direct note to the reader.', section_goal: 'Introduce the insight in a warm, concise voice.', content_type: 'insight', depth_requirement: 'Sound like an issue, not an article.', wordWeight: 0.18, required: true, outputConstraints: ['Direct reader voice'] },
      { id: 'observation', label: 'The Observation', intent: 'State the recurring pattern.', section_goal: 'Name the pattern the organization is seeing.', content_type: 'insight', depth_requirement: 'Make the observation concrete and ownable.', wordWeight: 0.24, required: true, outputConstraints: ['Ownable observation'] },
      { id: 'interpretation', label: 'What It Means', intent: 'Interpret the pattern.', section_goal: 'Explain why the pattern matters and what it changes.', content_type: 'explanation', depth_requirement: 'Keep the interpretation sharp and non-generic.', wordWeight: 0.28, required: true, outputConstraints: ['Sharp interpretation'] },
      { id: 'reader_move', label: 'A Useful Move', intent: 'Give the reader one practical move.', section_goal: 'Offer a single action, question, or test.', content_type: 'application', depth_requirement: 'Make it actionable without becoming a full guide.', wordWeight: 0.18, required: true, outputConstraints: ['Single move'] },
      { id: 'signoff', label: 'Signoff', intent: 'Close in newsletter voice.', section_goal: 'End with a concise closing thought or watch item.', content_type: 'summary', depth_requirement: 'Avoid blog summary language.', wordWeight: 0.12, required: true, outputConstraints: ['Newsletter signoff'] },
    ],
    outputConstraints: ['Letter-like issue', 'No H2-led blog body scaffold'],
  },
  'newsletter:digest': {
    contentType: 'newsletter',
    formatType: 'digest',
    sections: [
      { id: 'digest_theme', label: 'This Issue in One Line', intent: 'Frame the digest theme.', section_goal: 'State the theme connecting the selected items.', content_type: 'summary', depth_requirement: 'Make the theme clear and concise.', wordWeight: 0.12, required: true, outputConstraints: ['One-line theme'] },
      { id: 'item_one', label: 'Signal One', intent: 'Present the first digest item.', section_goal: 'Summarize the first signal and why it matters.', content_type: 'insight', depth_requirement: 'Use concise analysis, not link dumping.', wordWeight: 0.24, required: true, outputConstraints: ['Signal plus implication'] },
      { id: 'item_two', label: 'Signal Two', intent: 'Present the second digest item.', section_goal: 'Summarize the second signal and why it matters.', content_type: 'insight', depth_requirement: 'Keep it distinct from the first signal.', wordWeight: 0.24, required: true, outputConstraints: ['Distinct signal'] },
      { id: 'item_three', label: 'Signal Three', intent: 'Present the third digest item.', section_goal: 'Summarize the third signal and why it matters.', content_type: 'insight', depth_requirement: 'Keep the item concise and useful.', wordWeight: 0.24, required: true, outputConstraints: ['Concise item'] },
      { id: 'takeaway', label: 'Reader Takeaway', intent: 'Tie the digest together.', section_goal: 'Explain the one takeaway readers should carry forward.', content_type: 'summary', depth_requirement: 'Synthesize without repeating each item.', wordWeight: 0.16, required: true, outputConstraints: ['Synthesis'] },
    ],
    outputConstraints: ['Digest format', 'Distinct items with implications'],
  },
  'newsletter:curated': {
    contentType: 'newsletter',
    formatType: 'curated',
    sections: [
      { id: 'curator_note', label: 'Curator Note', intent: 'Explain the curation logic.', section_goal: 'State why these items belong together.', content_type: 'insight', depth_requirement: 'Use a human editorial voice.', wordWeight: 0.16, required: true, outputConstraints: ['Editorial curation logic'] },
      { id: 'selection_logic', label: 'Selection Logic', intent: 'Define what made the cut.', section_goal: 'Explain the criteria for inclusion and what readers should notice.', content_type: 'explanation', depth_requirement: 'Avoid generic list framing.', wordWeight: 0.18, required: true, outputConstraints: ['Selection criteria'] },
      { id: 'curated_items', label: 'Curated Signals', intent: 'Present curated items with interpretation.', section_goal: 'Give each selected signal a brief interpretation and reader implication.', content_type: 'insight', depth_requirement: 'Each item must have a different reason for inclusion.', wordWeight: 0.42, required: true, outputConstraints: ['No link dumping'] },
      { id: 'application', label: 'How to Use This', intent: 'Translate curation into action.', section_goal: 'Explain how readers can use the curated signals.', content_type: 'application', depth_requirement: 'Keep advice specific and brief.', wordWeight: 0.14, required: true, outputConstraints: ['Practical use'] },
      { id: 'close', label: 'Closing Note', intent: 'Close like a newsletter.', section_goal: 'End with a concise editorial note.', content_type: 'summary', depth_requirement: 'No generic blog summary.', wordWeight: 0.10, required: true, outputConstraints: ['Newsletter close'] },
    ],
    outputConstraints: ['Curated newsletter structure', 'Every item needs interpretation'],
  },
  'newsletter:editorial': {
    contentType: 'newsletter',
    formatType: 'editorial',
    sections: [
      { id: 'editor_note', label: 'Editor Note', intent: 'Open with the editorial position.', section_goal: 'State the issue-level opinion and why it matters.', content_type: 'insight', depth_requirement: 'Use newsletter voice with clear POV.', wordWeight: 0.18, required: true, outputConstraints: ['Clear POV'] },
      { id: 'argument', label: 'The Argument', intent: 'Develop the editorial logic.', section_goal: 'Explain the reasoning behind the position.', content_type: 'insight', depth_requirement: 'Make the argument concise and distinct from an article.', wordWeight: 0.30, required: true, outputConstraints: ['Concise argument'] },
      { id: 'reader_implication', label: 'What It Means for You', intent: 'Make the implication personal to the reader.', section_goal: 'Translate the editorial view into reader relevance.', content_type: 'application', depth_requirement: 'Use business implication, not generic advice.', wordWeight: 0.24, required: true, outputConstraints: ['Reader relevance'] },
      { id: 'watch', label: 'What I Would Watch', intent: 'Close with a watch item.', section_goal: 'Name the signal or decision worth watching next.', content_type: 'summary', depth_requirement: 'End with a watchable signal.', wordWeight: 0.16, required: true, outputConstraints: ['Watch item'] },
      { id: 'signoff', label: 'Until Next Time', intent: 'Finish with a short signoff.', section_goal: 'Close the newsletter issue naturally.', content_type: 'summary', depth_requirement: 'Keep it short.', wordWeight: 0.12, required: true, outputConstraints: ['Short signoff'] },
    ],
    outputConstraints: ['Newsletter editorial, not blog article'],
  },
  'guide:comprehensive': {
    contentType: 'guide',
    formatType: 'comprehensive',
    sections: [
      { id: 'starting_point', label: 'Before You Start', intent: 'Define prerequisites, scope, and decision context.', section_goal: 'Help the reader understand what must be true before applying the guide.', content_type: 'explanation', depth_requirement: 'Name inputs, constraints, owners, and assumptions.', wordWeight: 0.14, required: true, outputConstraints: ['Prerequisites and scope'] },
      { id: 'framework', label: 'The Working Framework', intent: 'Introduce the guide model.', section_goal: 'Give a usable model that structures the rest of the guide.', content_type: 'framework', depth_requirement: 'Define the model, components, and sequence.', wordWeight: 0.22, required: true, outputConstraints: ['Usable model'] },
      { id: 'implementation', label: 'How to Apply It', intent: 'Teach the implementation path.', section_goal: 'Show the sequence of actions, decisions, and checks.', content_type: 'application', depth_requirement: 'Include actions, examples, success signals, and failure modes.', wordWeight: 0.34, required: true, outputConstraints: ['Sequential application'] },
      { id: 'examples', label: 'Examples and Decision Checks', intent: 'Make the guide concrete.', section_goal: 'Show realistic examples and checks that help the reader self-assess.', content_type: 'example', depth_requirement: 'Use examples that demonstrate judgment, not filler.', wordWeight: 0.18, required: true, outputConstraints: ['Examples plus checks'] },
      { id: 'next_steps', label: 'Next Steps', intent: 'Close with the action path.', section_goal: 'Give a practical action path after the guide.', content_type: 'summary', depth_requirement: 'Tell the reader what to do next without repeating the guide.', wordWeight: 0.12, required: true, outputConstraints: ['Action path'] },
      references,
    ],
    outputConstraints: ['Guide structure', 'Instructional and sequential', 'No opinion article headings'],
  },
  'guide:quickstart': {
    contentType: 'guide',
    formatType: 'quickstart',
    sections: [
      { id: 'setup', label: 'Set Up the Starting Point', intent: 'Get the reader ready quickly.', section_goal: 'Define what the reader needs before starting.', content_type: 'explanation', depth_requirement: 'Keep setup concise and concrete.', wordWeight: 0.16, required: true, outputConstraints: ['Concise setup'] },
      { id: 'step_one', label: 'Step 1: Clarify the Decision', intent: 'Begin the sequence with decision clarity.', section_goal: 'Show the first action and why it matters.', content_type: 'application', depth_requirement: 'Include action, reason, and success signal.', wordWeight: 0.22, required: true, outputConstraints: ['Action, reason, signal'] },
      { id: 'step_two', label: 'Step 2: Build the Minimum Working System', intent: 'Move from decision to working process.', section_goal: 'Show the minimum practical implementation.', content_type: 'application', depth_requirement: 'Keep it lean and practical.', wordWeight: 0.28, required: true, outputConstraints: ['Minimum viable process'] },
      { id: 'step_three', label: 'Step 3: Check What Is Working', intent: 'Validate the quickstart.', section_goal: 'Give the checks that confirm progress.', content_type: 'application', depth_requirement: 'Include success signals and warning signs.', wordWeight: 0.20, required: true, outputConstraints: ['Checks and warnings'] },
      { id: 'next', label: 'What to Do Next', intent: 'Close with the next move.', section_goal: 'Explain how to continue after the quickstart.', content_type: 'summary', depth_requirement: 'Avoid broad recap; give next action.', wordWeight: 0.14, required: true, outputConstraints: ['Next action'] },
      references,
    ],
    outputConstraints: ['Quickstart guide', 'Step headings required'],
  },
  'guide:reference': {
    contentType: 'guide',
    formatType: 'reference',
    sections: [
      { id: 'scope', label: 'Scope and Definitions', intent: 'Define what the reference covers.', section_goal: 'Clarify terms, scope, and boundaries.', content_type: 'explanation', depth_requirement: 'Use precise definitions without bloating the guide.', wordWeight: 0.16, required: true, outputConstraints: ['Precise scope'] },
      { id: 'criteria', label: 'Reference Criteria', intent: 'Give evaluation criteria.', section_goal: 'List and explain the criteria readers should use.', content_type: 'framework', depth_requirement: 'Make each criterion distinct and usable.', wordWeight: 0.26, required: true, outputConstraints: ['Usable criteria'] },
      { id: 'patterns', label: 'Common Patterns', intent: 'Document patterns and variants.', section_goal: 'Explain recurring patterns, variations, and when each matters.', content_type: 'comparison', depth_requirement: 'Use structured comparison where helpful.', wordWeight: 0.28, required: true, outputConstraints: ['Patterns and variants'] },
      { id: 'checks', label: 'Checks and Exceptions', intent: 'Help readers apply judgment.', section_goal: 'Name checks, exceptions, and edge cases.', content_type: 'application', depth_requirement: 'Make exceptions practical and decision-oriented.', wordWeight: 0.20, required: true, outputConstraints: ['Checks and exceptions'] },
      { id: 'use', label: 'How to Use This Reference', intent: 'Close with usage guidance.', section_goal: 'Explain how the reader should apply the reference.', content_type: 'summary', depth_requirement: 'Make the close operational.', wordWeight: 0.10, required: true, outputConstraints: ['Usage guidance'] },
      references,
    ],
    outputConstraints: ['Reference guide structure', 'Definitions, criteria, patterns, checks'],
  },
  'whitepaper:research': {
    contentType: 'whitepaper',
    formatType: 'research',
    sections: [
      { id: 'executive_summary', label: 'Executive Summary', intent: 'State the finding, stakes, and recommendation.', section_goal: 'Summarize the whitepaper argument for executive readers.', content_type: 'summary', depth_requirement: 'Be formal, precise, and decision-oriented.', wordWeight: 0.12, required: true, outputConstraints: ['Executive synthesis'] },
      { id: 'methodology', label: 'Methodology and Scope', intent: 'Explain how the analysis is bounded.', section_goal: 'Define scope, assumptions, evidence basis, and limitations.', content_type: 'evidence', depth_requirement: 'Do not invent studies; be transparent about inference.', wordWeight: 0.16, required: true, outputConstraints: ['Scope and limitations'] },
      { id: 'findings', label: 'Key Findings', intent: 'Present the core findings.', section_goal: 'Explain findings with implications and evidence-aware reasoning.', content_type: 'insight', depth_requirement: 'Separate each finding and avoid repeated conclusions.', wordWeight: 0.34, required: true, outputConstraints: ['Distinct findings'] },
      { id: 'framework', label: 'Decision Framework', intent: 'Turn findings into a model.', section_goal: 'Provide a reusable framework leaders can apply.', content_type: 'framework', depth_requirement: 'Define components, use cases, and limits.', wordWeight: 0.24, required: true, outputConstraints: ['Reusable framework'] },
      { id: 'recommendations', label: 'Recommendations', intent: 'Translate findings into actions.', section_goal: 'Give prioritized recommendations and tradeoffs.', content_type: 'application', depth_requirement: 'Make recommendations specific and sequenced.', wordWeight: 0.14, required: true, outputConstraints: ['Prioritized recommendations'] },
      references,
    ],
    outputConstraints: ['Whitepaper structure', 'Methodology required', 'Formal evidence-aware tone'],
  },
  'whitepaper:strategic': {
    contentType: 'whitepaper',
    formatType: 'strategic',
    sections: [
      { id: 'executive_context', label: 'Executive Context', intent: 'Frame the strategic issue.', section_goal: 'Explain the decision context, stakes, and strategic tension.', content_type: 'explanation', depth_requirement: 'Use executive language and avoid blog ledes.', wordWeight: 0.14, required: true, outputConstraints: ['Strategic tension'] },
      { id: 'market_observation', label: 'Market Observation', intent: 'State the market pattern.', section_goal: 'Describe the recurring pattern or pressure behind the issue.', content_type: 'insight', depth_requirement: 'Make the observation specific and defensible.', wordWeight: 0.20, required: true, outputConstraints: ['Defensible observation'] },
      { id: 'strategic_framework', label: 'Strategic Framework', intent: 'Provide a decision model.', section_goal: 'Introduce the strategic model for evaluating the issue.', content_type: 'framework', depth_requirement: 'Define dimensions, tradeoffs, and decision criteria.', wordWeight: 0.28, required: true, outputConstraints: ['Decision criteria'] },
      { id: 'operating_implications', label: 'Operating Implications', intent: 'Connect strategy to execution.', section_goal: 'Explain what the framework changes in operating choices.', content_type: 'application', depth_requirement: 'Tie implications to teams, governance, metrics, and risk.', wordWeight: 0.24, required: true, outputConstraints: ['Operating choices'] },
      { id: 'recommendations', label: 'Strategic Recommendations', intent: 'Close with prioritized choices.', section_goal: 'Give prioritized recommendations and what to avoid.', content_type: 'summary', depth_requirement: 'Make recommendations sequenced and executive-ready.', wordWeight: 0.14, required: true, outputConstraints: ['Sequenced recommendations'] },
      references,
    ],
    outputConstraints: ['Strategic whitepaper', 'No newsletter or blog headings'],
  },
  'whitepaper:technical': {
    contentType: 'whitepaper',
    formatType: 'technical',
    sections: [
      { id: 'technical_context', label: 'Technical Context', intent: 'Define the technical problem and constraints.', section_goal: 'Frame the technical issue, constraints, and system boundaries.', content_type: 'explanation', depth_requirement: 'Be precise about assumptions and constraints.', wordWeight: 0.16, required: true, outputConstraints: ['Constraints and assumptions'] },
      { id: 'architecture', label: 'Reference Architecture', intent: 'Describe the proposed architecture or model.', section_goal: 'Show the technical structure and why it is appropriate.', content_type: 'framework', depth_requirement: 'Explain components, interfaces, and tradeoffs.', wordWeight: 0.30, required: true, outputConstraints: ['Components and tradeoffs'] },
      { id: 'implementation', label: 'Implementation Considerations', intent: 'Explain practical implementation choices.', section_goal: 'Name implementation requirements, dependencies, and risks.', content_type: 'application', depth_requirement: 'Be concrete without inventing unavailable specifics.', wordWeight: 0.26, required: true, outputConstraints: ['Dependencies and risks'] },
      { id: 'validation', label: 'Validation and Risk Controls', intent: 'Show how to verify the approach.', section_goal: 'Explain validation steps, metrics, and failure controls.', content_type: 'evidence', depth_requirement: 'Include testing, monitoring, and governance considerations.', wordWeight: 0.18, required: true, outputConstraints: ['Validation controls'] },
      { id: 'recommendations', label: 'Technical Recommendations', intent: 'Close with technical decision guidance.', section_goal: 'Prioritize the recommended technical path and caveats.', content_type: 'summary', depth_requirement: 'Make the recommendation specific and caveated.', wordWeight: 0.10, required: true, outputConstraints: ['Caveated recommendation'] },
      references,
    ],
    outputConstraints: ['Technical whitepaper', 'Architecture and validation required'],
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
