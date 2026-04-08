export interface TemplateDepthGuidance {
  uniquenessRule: string;
  mustIncludePoints: string[];
  retryFocus: string[];
}

export function getBlogTemplateDepthGuidance(
  templateName: string | undefined,
  formatType: string | undefined,
  targetWords: number,
): TemplateDepthGuidance | null {
  const normalized = typeof templateName === 'string' ? templateName.trim().toLowerCase() : '';
  if (!normalized && !formatType) return null;

  const isComparison = normalized === 'comparison' || formatType === 'comparison';
  const isTutorial = normalized === 'tutorial' || formatType === 'tutorial';
  const isVisualFeature = normalized === 'visual feature';
  const isMagazine = normalized === 'magazine';
  const isClassic = normalized === 'classic';

  if (isClassic) {
    return {
      uniquenessRule: targetWords >= 2000
        ? 'Use the Classic template as a true pillar-style deep dive: each main section must feel authoritative, layered, and decision-useful rather than merely complete.'
        : targetWords >= 1600
        ? 'Use the Classic template as a serious deep dive: each main section should develop a full argument with explanation, example, implication, and practical takeaway.'
        : targetWords >= 1200
        ? 'Use the Classic template as a substantial editorial deep dive: avoid surface-level summaries and make each section teach the reader something concrete.'
        : 'Use the Classic template with concise depth: even at 800+ words, each section should contain real explanation and practical value, not placeholder prose.',
      mustIncludePoints: targetWords >= 2000
        ? [
            'For every major section, include at least one concrete example, one clear implication, and one action-oriented takeaway',
            'Build depth through explanation plus comparison plus implementation guidance, not filler',
            'Include tradeoffs, mistakes, or decision criteria where relevant so the article feels expert-level',
            'Make the conclusion synthesize the entire argument instead of simply repeating earlier lines',
          ]
        : targetWords >= 1600
        ? [
            'For every major section, include a concrete example and a clear practical implication',
            'Show what good execution looks like and what weak execution looks like',
            'End sections with a takeaway sentence that helps the reader act on the insight',
          ]
        : targetWords >= 1200
        ? [
            'For every major section, include explanation, one example, and one practical takeaway',
            'Avoid generic statements that are not supported by reasoning or specifics',
          ]
        : [
            'For every major section, include a concrete explanation and a practical takeaway',
            'Keep the writing concise, but never thin or outline-like',
          ],
      retryFocus: [
        'Make each section deeper rather than adding more thin sections',
        'End every major section with a clear takeaway sentence',
      ],
    };
  }

  if (isVisualFeature) {
    return {
      uniquenessRule: targetWords >= 1600
        ? 'Use the Visual Feature template as an image-supported editorial deep dive: visuals should enrich the story, but the written sections must carry full narrative and analytical depth.'
        : 'Use the Visual Feature template with concise editorial depth: visuals can support the article, but every written section must still contain real interpretation and practical value.',
      mustIncludePoints: targetWords >= 1600
        ? [
            'For each major written section, include scene-setting, analysis, and why-it-matters interpretation',
            'Do not let image blocks replace substance; the paragraphs must stand on their own even without the visuals',
            'Use concrete examples, signals, or observed patterns to make the narrative feel grounded',
          ]
        : [
            'Each major section should include interpretation and a practical takeaway, not just description',
            'Keep the visual narrative engaging, but never skeletal',
          ],
      retryFocus: [
        'Deepen the written narrative around each visual moment',
        'Add interpretation and practical meaning, not just descriptive scene-setting',
      ],
    };
  }

  if (isComparison) {
    return {
      uniquenessRule: targetWords >= 1600
        ? 'Use the Comparison template as a decision-grade evaluation: the article should help readers choose confidently by clarifying strengths, tradeoffs, risks, and ideal use cases.'
        : 'Use the Comparison template as a practical decision guide: make the evaluation clear, fair, and genuinely useful.',
      mustIncludePoints: targetWords >= 1600
        ? [
            'For each option, explain strengths, weaknesses, tradeoffs, and the situations where it performs best',
            'Make the head-to-head section compare the options on the criteria that matter most in practice',
            'Ensure the final recommendation clearly explains who should choose what and why',
          ]
        : [
            'Avoid shallow feature listing; every comparison point needs reasoning or consequences',
            'Make the verdict useful for distinct reader scenarios or use cases',
          ],
      retryFocus: [
        'Add stronger decision criteria, tradeoffs, and scenario-based recommendations',
        'Make the verdict more actionable for different reader profiles',
      ],
    };
  }

  if (isTutorial) {
    return {
      uniquenessRule: targetWords >= 1600
        ? 'Use the Tutorial template as a true instructional guide: every step should teach what to do, why it matters, what success looks like, and what can go wrong.'
        : 'Use the Tutorial template as a practical walkthrough: each step must do more than describe the action and should help the reader execute confidently.',
      mustIncludePoints: targetWords >= 1600
        ? [
            'For every step, include clear instructions, supporting rationale, and practical checkpoints',
            'Call out likely mistakes, troubleshooting paths, or verification tips where relevant',
            'Make the tutorial feel teachable and complete, not like a skimpy checklist',
          ]
        : [
            'Each step should explain what to do and why that step matters',
            'Include at least one practical caution, quality check, or troubleshooting note in the body',
          ],
      retryFocus: [
        'Deepen each step with rationale, pitfalls, and validation guidance',
        'Avoid short step text that reads like a checklist or outline',
      ],
    };
  }

  if (isMagazine) {
    return {
      uniquenessRule: targetWords >= 1600
        ? 'Use the Magazine template as a polished editorial feature: the layout should feel rich and varied, but the body still needs a strong argument, narrative momentum, and concrete interpretation.'
        : 'Use the Magazine template with editorial richness: columns, quotes, and visuals should enhance the piece without reducing depth.',
      mustIncludePoints: targetWords >= 1600
        ? [
            'Make every narrative section carry concrete detail, interpretation, and consequence',
            'Ensure columns and pull-quote moments add standalone value instead of acting as filler',
            'Build toward a strong editorial conclusion with a clear point of view',
          ]
        : [
            'Keep the editorial feel, but make every written section substantive',
            'Use the layout variety to enrich the story, not to shorten it',
          ],
      retryFocus: [
        'Strengthen the editorial argument and interpretation inside the body',
        'Ensure columns and quote-adjacent sections add real standalone value',
      ],
    };
  }

  return null;
}
