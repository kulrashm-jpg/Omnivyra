export type PlatformAlgorithmFormattingRule = {
  platform: string;
  guidelines: string[];
  maxSentencesPerParagraph: number;
  preferSentencePerLine: boolean;
  enforceCtaAtEnd: boolean;
};

const DEFAULT_RULE: PlatformAlgorithmFormattingRule = {
  platform: 'default',
  guidelines: [
    'Keep semantic meaning unchanged',
    'Use clean spacing and readable paragraph blocks',
  ],
  maxSentencesPerParagraph: 2,
  preferSentencePerLine: false,
  enforceCtaAtEnd: false,
};

const PLATFORM_RULES: Record<string, PlatformAlgorithmFormattingRule> = {
  linkedin: {
    platform: 'linkedin',
    guidelines: [
      'Strong opening hook line',
      'Max 2 lines before spacing',
      'Short paragraphs',
      'CTA at end',
    ],
    maxSentencesPerParagraph: 2,
    preferSentencePerLine: false,
    enforceCtaAtEnd: true,
  },
  instagram: {
    platform: 'instagram',
    guidelines: [
      'Hook in first 125 chars',
      'Storytelling blocks',
      'CTA near end',
    ],
    maxSentencesPerParagraph: 1,
    preferSentencePerLine: false,
    enforceCtaAtEnd: true,
  },
  x: {
    platform: 'x',
    guidelines: [
      'Short punchy lines',
      'Line breaks every thought',
    ],
    maxSentencesPerParagraph: 1,
    preferSentencePerLine: true,
    enforceCtaAtEnd: false,
  },
  twitter: {
    platform: 'x',
    guidelines: [
      'Short punchy lines',
      'Line breaks every thought',
    ],
    maxSentencesPerParagraph: 1,
    preferSentencePerLine: true,
    enforceCtaAtEnd: false,
  },
  youtube: {
    platform: 'youtube',
    guidelines: [
      'Keyword-loaded first sentence',
      'Structured description blocks',
      'Chapter markers as timestamps',
      'CTA in description',
    ],
    maxSentencesPerParagraph: 2,
    preferSentencePerLine: false,
    enforceCtaAtEnd: false,
  },
  facebook: {
    platform: 'facebook',
    guidelines: [
      'Warm, friendly opening (personal story angle)',
      'Short conversational paragraphs',
      'Engagement question at the very end',
      'Max 1–3 hashtags only',
    ],
    maxSentencesPerParagraph: 3,
    preferSentencePerLine: false,
    enforceCtaAtEnd: true,
  },
  tiktok: {
    platform: 'tiktok',
    guidelines: [
      'First 5 words must create immediate curiosity',
      'Pattern interrupt after hook',
      'Rapid-fire value delivery',
      'Direct low-friction CTA',
      'Trending hashtags (#fyp) plus niche tags',
    ],
    maxSentencesPerParagraph: 2,
    preferSentencePerLine: true,
    enforceCtaAtEnd: true,
  },
  pinterest: {
    platform: 'pinterest',
    guidelines: [
      'Lead with searchable keyword phrase',
      'Describe visual content specifically',
      'State the outcome or benefit clearly',
      'Keyword-based hashtags only',
    ],
    maxSentencesPerParagraph: 2,
    preferSentencePerLine: false,
    enforceCtaAtEnd: false,
  },
  reddit: {
    platform: 'reddit',
    guidelines: [
      'Title is specific and searchable (no clickbait)',
      'Body: context → main point → supporting detail',
      'No corporate tone or self-promotion',
      'Close with genuine community question',
      'No hashtags',
    ],
    maxSentencesPerParagraph: 3,
    preferSentencePerLine: false,
    enforceCtaAtEnd: true,
  },
};

export function getAlgorithmicFormattingRules(platform: string): PlatformAlgorithmFormattingRule {
  const normalized = String(platform || '').trim().toLowerCase();
  return PLATFORM_RULES[normalized] || { ...DEFAULT_RULE, platform: normalized || 'default' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Algorithmic formatting — moved here so the unified content processor can
// import it without creating a circular dependency with contentGenerationPipeline.
// ─────────────────────────────────────────────────────────────────────────────

function splitIntoSentences(text: string): string[] {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+/g)
    .map((part) => String(part || '').trim())
    .filter(Boolean);
}

function isLikelyCtaSentence(sentence: string): boolean {
  const lower = String(sentence || '').toLowerCase();
  if (!lower) return false;
  return (
    lower.includes('learn more') ||
    lower.includes('book') ||
    lower.includes('contact') ||
    lower.includes('start') ||
    lower.includes('join') ||
    lower.includes('subscribe') ||
    lower.includes('follow') ||
    lower.includes('try') ||
    lower.includes('download')
  );
}

export type AlgorithmicFormattingResult = {
  content: string;
  meta: { platform: string; formatting_applied: true };
};

/**
 * Apply platform-specific structural formatting to content.
 * - CTA reordering (LinkedIn, Instagram, Facebook, TikTok, Pinterest, Reddit)
 * - Sentence-per-line splitting (Twitter/X, TikTok)
 * - Paragraph normalisation (all platforms)
 *
 * Called as Stage 3A by unifiedContentProcessor.processContent().
 * Do not call directly from API routes or generation services — use processContent() instead.
 */
export function applyStructuralFormatting(
  adaptedContent: string,
  platform: string
): AlgorithmicFormattingResult {
  const rules = getAlgorithmicFormattingRules(platform);
  const metaBase = { platform: String(platform || '').trim().toLowerCase() || 'unknown', formatting_applied: true as const };

  const hasStructure = adaptedContent.includes('\n');
  if (hasStructure) {
    let structured = adaptedContent
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (rules.preferSentencePerLine) {
      const paragraphs = structured.split(/\n{2,}/);
      const lines: string[] = [];
      for (const para of paragraphs) {
        const paraLines = para.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const line of paraLines) {
          const sents = splitIntoSentences(line);
          lines.push(...sents);
        }
        lines.push('');
      }
      structured = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    if (rules.enforceCtaAtEnd) {
      const paras = structured.split(/\n{2,}/);
      if (paras.length > 1) {
        const ctaIdx = paras.findIndex(isLikelyCtaSentence);
        if (ctaIdx >= 0 && ctaIdx !== paras.length - 1) {
          const [cta] = paras.splice(ctaIdx, 1);
          paras.push(cta);
          structured = paras.join('\n\n');
        }
      }
    }

    return { content: structured, meta: metaBase };
  }

  const sentences = splitIntoSentences(adaptedContent);
  if (sentences.length <= 1) {
    return { content: String(adaptedContent || '').trim(), meta: metaBase };
  }

  let ordered = [...sentences];
  if (rules.enforceCtaAtEnd) {
    const ctaIndex = ordered.findIndex(isLikelyCtaSentence);
    if (ctaIndex >= 0 && ctaIndex !== ordered.length - 1) {
      const [cta] = ordered.splice(ctaIndex, 1);
      ordered.push(cta);
    }
  }

  let formatted = '';
  if (rules.preferSentencePerLine) {
    formatted = ordered.join('\n');
  } else {
    const chunks: string[] = [];
    for (let i = 0; i < ordered.length; i += rules.maxSentencesPerParagraph) {
      const chunk = ordered.slice(i, i + rules.maxSentencesPerParagraph).join(' ');
      chunks.push(chunk);
    }
    formatted = chunks.join('\n\n');
  }

  return { content: formatted.trim(), meta: metaBase };
}

/**
 * @deprecated Use applyStructuralFormatting() or processContent() instead.
 * Kept for backward compatibility during migration. Will be removed in next cleanup pass.
 */
export const applyAlgorithmicFormatting = applyStructuralFormatting;
