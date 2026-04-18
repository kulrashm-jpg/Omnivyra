/**
 * Prompt builders for the Minimal Thesis / Insight Letter format.
 */
import type { NewsletterGenerationRequest } from '../runNewsletterGeneration';
import { buildContextHeader } from '../shared/promptHelpers';

export function buildInsightLetterPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  retryReason?: string,
): string {
  const header = buildContextHeader(input, targetWords, retryReason);
  const deeperTier = targetWords >= 1600;

  return `${header}

YOUR TASK:
Write a high-quality "Minimal Thesis" Insight Letter. Generate a structured JSON object with named fields, not a generic block list.

HARD RULES:
- This must feel like original thinking, not a recap.
- Keep the visible sequence: Hook, Context, Insight, Expansion, Implication, Closing.
- Make structure obvious, depth real, and GEO extraction strong.
- Use HTML strings with <p> tags for all *_html fields.
- Every major section should feel complete on its own.
- Use at least one grounded example, observed pattern, or realistic scenario.
- Fill both callouts, the quote, the key insights, and the summary with distinct extractable value.
- Do not write neat but shallow sections. The body must feel argued, not summarized.
- Do not use markdown fences.

SECTION REQUIREMENTS:
- hook_html: 2 short paragraphs with tension, a challenged assumption, and a reason to keep reading.
- context_html: explain why this matters now with concrete stakes and a recognizable scenario.
- insight_html: explain the real mechanism with a reusable lens or mental model. Use ${deeperTier ? 'at least 2 paragraphs and about 140-220 words' : 'at least 2 paragraphs and about 120-180 words'}.
- evidence_html: give one grounded example, observed pattern, or realistic scenario that proves the thesis. Use ${deeperTier ? 'about 110-180 words' : 'about 90-150 words'}.
- expansion_html: add the deeper layer, second-order effect, or hidden dynamic. Use ${deeperTier ? 'about 120-180 words' : 'about 90-140 words'}.
- implication_html: explain the practical decision shift or operating consequence for the reader. Use ${deeperTier ? 'about 120-180 words' : 'about 90-140 words'} and include a clear operating takeaway.
- closing_html: end with a memorable line worth forwarding.
- thesis_callout: one-sentence high-conviction thesis.
- practical_shift_callout: one-sentence operating change or decision lens.
- quote_text: one sharp quote-worthy line capturing the thesis.
- key_insights: ${deeperTier ? '5-6' : '4-5'} dense standalone takeaways.
- summary_body: 2-3 sentence standalone synthesis suitable for inbox previews and AI answers.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "title": "string",
  "excerpt": "string",
  "seo_meta_title": "string",
  "seo_meta_description": "string",
  "tags": ["string"],
  "thesis_callout": "string",
  "practical_shift_callout": "string",
  "quote_text": "string",
  "quote_author": "string",
  "quote_source": "string",
  "key_insights": ["string"],
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "evidence_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags",
  "summary_body": "string"
}`;
}

export function buildInsightLetterDepthRepairPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  state: {
    thesis_callout: string;
    practical_shift_callout: string;
    quote_text: string;
    key_insights: string[];
    summary_body: string;
  },
  retryReason: string,
): string {
  const deeperTier = targetWords >= 1600;
  return `TOPIC: ${input.topic}

REPAIR GOAL:
The structure and extraction surfaces are acceptable, but the BODY DEPTH is still too weak.
You must deepen the body sections while preserving the thesis, key insights, quote, callouts, and overall sequence.

CURRENT THESIS CALLOUT:
${state.thesis_callout}

CURRENT PRACTICAL-SHIFT CALLOUT:
${state.practical_shift_callout}

CURRENT QUOTE:
${state.quote_text}

CURRENT KEY INSIGHTS:
${state.key_insights.join('\n- ')}

CURRENT SUMMARY:
${state.summary_body}

WHY THE DRAFT WAS REJECTED:
${retryReason}

DEPTH RULES:
- Keep the same visible sequence: Hook, Context, Insight, Expansion, Implication, Closing.
- Do not rewrite the thesis into something different.
- Make the body feel argued, not summarized.
- Add mechanism, example, second-order effect, and practical implication.
- Use HTML strings with <p> tags only.
- Make each section denser and more complete.

SECTION TARGETS:
- hook_html: strengthen tension and sharpen the challenged assumption. About ${deeperTier ? '70-110' : '60-90'} words.
- context_html: explain why this matters now with concrete stakes. About ${deeperTier ? '90-140' : '70-110'} words.
- insight_html: the deepest reasoning section. Use at least 2 paragraphs and about ${deeperTier ? '170-260' : '140-220'} words.
- evidence_html: one grounded example, observed pattern, or realistic scenario. About ${deeperTier ? '130-190' : '100-150'} words.
- expansion_html: deepen the hidden dynamic or second-order effect. About ${deeperTier ? '140-200' : '110-160'} words.
- implication_html: explain the practical decision shift clearly. About ${deeperTier ? '140-200' : '110-160'} words.
- closing_html: end with a memorable line, but keep it earned. About ${deeperTier ? '45-80' : '35-60'} words.

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "evidence_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags"
}`;
}

export function buildInsightLetterExpansionPrompt(
  input: NewsletterGenerationRequest,
  targetWords: number,
  state: {
    thesis_callout: string;
    practical_shift_callout: string;
    quote_text: string;
    key_insights: string[];
    summary_body: string;
  },
  retryReason: string,
): string {
  const deeperTier = targetWords >= 1600;
  return `TOPIC: ${input.topic}

EXPANSION GOAL:
The insight letter is materially below target length. Expand only the long-form body so the draft gets much closer to the target word count while keeping the thesis, extractable callouts, quote, and section sequence intact.

CURRENT THESIS CALLOUT:
${state.thesis_callout}

CURRENT PRACTICAL-SHIFT CALLOUT:
${state.practical_shift_callout}

CURRENT QUOTE:
${state.quote_text}

CURRENT KEY INSIGHTS:
${state.key_insights.join('\n- ')}

CURRENT SUMMARY:
${state.summary_body}

WHY THE DRAFT WAS REJECTED:
${retryReason}

EXPANSION RULES:
- Keep the same visible sequence: Hook, Context, Insight, Expansion, Implication, Closing.
- Do not change the thesis.
- Add real substance, not filler.
- Add mechanism, scenario detail, second-order effects, and a stronger operating implication.
- Use HTML strings with <p> tags only.
- Make every major section feel complete and forwardable.

SECTION TARGETS:
- hook_html: about ${deeperTier ? '95-140' : '80-120'} words
- context_html: about ${deeperTier ? '120-170' : '100-145'} words
- insight_html: at least 2 paragraphs and about ${deeperTier ? '210-320' : '180-260'} words
- evidence_html: one grounded example or realistic scenario, about ${deeperTier ? '160-230' : '130-190'} words
- expansion_html: hidden dynamic or second-order effect, about ${deeperTier ? '170-240' : '140-200'} words
- implication_html: practical decision shift, about ${deeperTier ? '170-240' : '140-200'} words
- closing_html: about ${deeperTier ? '55-90' : '45-75'} words

RETURN JSON WITH EXACTLY THESE FIELDS:
{
  "hook_html": "string with <p> tags",
  "context_html": "string with <p> tags",
  "insight_html": "string with <p> tags",
  "evidence_html": "string with <p> tags",
  "expansion_html": "string with <p> tags",
  "implication_html": "string with <p> tags",
  "closing_html": "string with <p> tags"
}`;
}
