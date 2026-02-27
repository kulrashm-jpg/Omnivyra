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
    ],
    maxSentencesPerParagraph: 2,
    preferSentencePerLine: false,
    enforceCtaAtEnd: false,
  },
};

export function getAlgorithmicFormattingRules(platform: string): PlatformAlgorithmFormattingRule {
  const normalized = String(platform || '').trim().toLowerCase();
  return PLATFORM_RULES[normalized] || { ...DEFAULT_RULE, platform: normalized || 'default' };
}

