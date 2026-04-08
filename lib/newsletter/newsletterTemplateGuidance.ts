import type { TemplateDepthGuidance } from '../blog/blogTemplateGuidance';

export function getNewsletterTemplateDepthGuidance(
  templateName: string | undefined,
  formatType: string | undefined,
  targetWords: number,
): TemplateDepthGuidance | null {
  const normalized = typeof templateName === 'string' ? templateName.trim().toLowerCase() : '';
  if (!normalized && !formatType) return null;

  const isMinimalThesis = normalized === 'minimal thesis';
  const isSplitScreenInsight = normalized === 'split-screen insight';
  const isInsightLetter = isMinimalThesis || isSplitScreenInsight || formatType === 'insight-letter';
  const isWeeklyBrief = formatType === 'weekly-brief' || normalized === 'signal radar' || normalized === 'analyst board';
  const isStrategicLetter = formatType === 'strategic-letter' || normalized === 'strategy memo' || normalized === 'market map';
  const isActionLetter = formatType === 'action-letter' || normalized === 'operator playbook' || normalized === 'sprint sheet';

  if (isInsightLetter) {
    return {
      uniquenessRule: isSplitScreenInsight
        ? targetWords >= 1600
          ? 'Use the Split-Screen Insight template as a high-signal thinking letter: the contrast between the surface story and the deeper reality must feel genuinely clarifying, reusable, and worth citing.'
          : 'Use the Split-Screen Insight template as a sharp contrast-driven letter: the surface view and deeper reality should sharpen each other, not read like two thin observations.'
        : targetWords >= 1600
        ? 'Use the Insight Letter as a genuine thinking piece: lead with a sharp thesis, build the argument through first-principles reasoning, and make the reader leave with a changed lens rather than a generic takeaway.'
        : 'Use the Insight Letter as a sharp, idea-led letter: concise is fine, but every section must still contain original thinking, clear stakes, and a memorable perspective shift.',
      mustIncludePoints: isSplitScreenInsight
        ? targetWords >= 1600
          ? [
              'Make the surface story feel plausible and widely believed before revealing why it is incomplete',
              'Make the deeper reality section explicit, concrete, and reusable as a lens the reader can apply elsewhere',
              'Include one sharp quote or callout line that captures the hidden mechanism in a highly extractable way',
              'Use the summary to restate the deeper reality and the practical shift it creates for the reader',
            ]
          : [
              'Create a crisp contrast between what most people notice and what strong readers should notice instead',
              'Include one memorable line or quote that captures the deeper reality cleanly',
              'Use the summary to make the insight easy to forward, cite, and remember',
            ]
        : targetWords >= 1600
        ? [
            'Give the hook real tension and specificity instead of a vague smart-sounding opener',
            'Use at least one analogy, mental model, or named lens to make the insight reusable',
            'Explain the second-order implication or hidden mechanism that makes the idea non-obvious',
            'Use a concrete example, observed pattern, or real scenario to keep the reasoning grounded',
            'Make both callouts and the quote genuinely extractable so they can stand alone in forwarding, previews, and AI answers',
            'Make the closing synthesis feel quotable and standalone, not like a summary of headings',
          ]
        : [
            'Make the thesis specific enough to feel defensible, not just provocative',
            'Include one reusable mental model or analogy in the body',
            'Ground the idea in one concrete example, scenario, or pattern the reader can recognize',
            'Make the quote, thesis callout, and summary strong enough to stand alone outside the main body',
            'End with a clear perspective shift or practical implication for the reader',
          ],
      retryFocus: isSplitScreenInsight
        ? [
            'Sharpen the contrast between the surface story and the deeper reality so the structure feels intentional and complete',
            'Add one stronger extractable line, quote, or synthesis that can stand alone in AI answers and forwarding surfaces',
            'Make the insight and summary more reusable, concrete, and citation-friendly',
          ]
        : [
            'Deepen the reasoning chain inside the insight and implication sections',
            'Replace abstract claims with one concrete example or recognizable real-world pattern',
            'Make the synthesis, quote, and both callouts strong enough to stand alone in AI extraction and forwarding surfaces',
          ],
    };
  }

  if (isWeeklyBrief) {
    return {
      uniquenessRule: targetWords >= 1600
        ? 'Use the Weekly Brief as a high-signal editorial briefing: each signal should include both the factual update and a clear interpretation that helps readers notice the bigger pattern.'
        : 'Use the Weekly Brief as a sharp signal digest: concise is fine, but each signal still needs interpretation, context, and a clear reason it matters.',
      mustIncludePoints: targetWords >= 1600
        ? [
            'For every major signal, explain both what happened and why smart readers should care',
            'Make the pattern section connect the signals into one coherent narrative rather than a recap',
            'Ensure the quick takes feel analytical and original, not generic bullet filler',
            'Anchor the brief with relevant references or source material where appropriate',
          ]
        : [
            'Each signal should include interpretation, not just description',
            'Use the closing and summary to sharpen what the week means, not to restate the headlines',
            'Keep at least a few cited references so the brief feels grounded and authority-building',
          ],
      retryFocus: [
        'Make each signal more analytical and useful, not just descriptive',
        'Strengthen the summary, references, and pattern section so the brief is more extractable and authoritative',
      ],
    };
  }

  if (isStrategicLetter) {
    return {
      uniquenessRule: targetWords >= 1600
        ? 'Use the Strategic Letter as a decision-grade strategy memo: every major section should sharpen market understanding, positioning logic, and concrete next moves.'
        : 'Use the Strategic Letter as a sharp strategic note: concise is fine, but the reader should still leave with a stronger frame, clearer leverage points, and a real decision lens.',
      mustIncludePoints: targetWords >= 1600
        ? [
            'Make the shift section genuinely non-obvious and tie it to specific market or competitive evidence',
            'Use the analysis section to explain forces, incentives, risks, and leverage instead of offering generic commentary',
            'Ensure the strategic moves are concrete, differentiated, and clearly tied back to the thesis',
            'Support the argument with references, signals, or examples that build authority',
          ]
        : [
            'Explain why the shift matters strategically, not just descriptively',
            'Give the reader a clear positioning implication and one or two concrete moves to consider',
            'Use the summary and references to make the letter more extractable and credible',
          ],
      retryFocus: [
        'Deepen the strategic logic, leverage points, and positioning implications',
        'Strengthen the summary and references so the letter feels more authoritative and decision-useful',
      ],
    };
  }

  if (isActionLetter) {
    return {
      uniquenessRule: targetWords >= 1600
        ? 'Use the Action Letter as a true execution playbook: every step should be practical, detailed, and clear enough that the reader could act immediately without guessing.'
        : 'Use the Action Letter as a practical operator note: concise is fine, but the framework and breakdown must still be concrete, specific, and execution-ready.',
      mustIncludePoints: targetWords >= 1600
        ? [
            'Make each step explain what to do, why it matters, and how to know the step was done well',
            'Use the mistakes section to surface realistic failure modes, not obvious filler',
            'Ensure the summary reinforces the workflow and the CTA points to the best immediate next action',
            'Include references, tools, or supporting examples when they materially help execution',
          ]
        : [
            'Keep the framework simple, but make each step specific enough to execute without ambiguity',
            'Use the mistakes section to call out the failure patterns most likely to derail the reader',
            'Use the summary to reinforce the workflow and the first move to take next',
          ],
      retryFocus: [
        'Deepen the framework and breakdown so the letter feels more executable',
        'Strengthen the summary, action clarity, and supporting references where useful',
      ],
    };
  }

  return null;
}
