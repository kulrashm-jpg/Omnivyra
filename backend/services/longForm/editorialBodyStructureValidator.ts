export interface EditorialBodyStructureValidationResult {
  score: number;
  passed: boolean;
  h2Count: number;
  paragraphCount: number;
  introWordCount: number;
  introParagraphCount: number;
  keyInsightsBeforeBody: boolean;
  averageWordsPerH2: number;
  h2LedRisk: 'low' | 'medium' | 'high';
  issues: string[];
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(value: string): number {
  return stripHtml(value).split(/\s+/).filter(Boolean).length;
}

function removeKeyInsights(value: string): string {
  return value.replace(/<div[^>]*class=["'][^"']*key-insights[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
}

export function validateEditorialBodyStructure(contentHtml: string): EditorialBodyStructureValidationResult {
  const totalWords = wordCount(contentHtml);
  const allH2Matches = [...contentHtml.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const h2Matches = allH2Matches.filter((match) => {
    const heading = stripHtml(match[1] ?? '').toLowerCase();
    return !/^(summary|conclusion|references|sources|further reading|faq)$/.test(heading);
  });
  const paragraphMatches = [...contentHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const firstH2Index = contentHtml.search(/<h2\b/i);
  const beforeFirstH2 = firstH2Index >= 0 ? contentHtml.slice(0, firstH2Index) : contentHtml;
  const keyInsightsBeforeBody = /<div[^>]*class=["'][^"']*key-insights[^"']*["']/i.test(beforeFirstH2);
  const thesisIntroHtml = removeKeyInsights(beforeFirstH2);
  const introWordCount = wordCount(thesisIntroHtml);
  const introParagraphCount = (thesisIntroHtml.match(/<p\b/gi) ?? []).length;
  const h2Count = h2Matches.length;
  const paragraphCount = paragraphMatches.length;
  const averageWordsPerH2 = h2Count > 0 ? Math.round(totalWords / h2Count) : totalWords;
  const issues: string[] = [];

  if (keyInsightsBeforeBody && introParagraphCount === 0) {
    issues.push('Key Insights are followed directly by H2 sections with no hook/thesis paragraph.');
  }
  if (introWordCount < 90 || introParagraphCount < 2) {
    issues.push('Missing executive thesis before the H2 body.');
  }
  if (h2Count > 0 && averageWordsPerH2 < 230) {
    issues.push('H2 sections are too thin for enterprise-grade editorial depth.');
  }
  if (paragraphCount < Math.max(6, h2Count * 2)) {
    issues.push('Body is structurally heading-led instead of argument-led.');
  }
  if (!/\b(thesis|believes?|observes?|recommends?|tradeoffs?|tension|decisions?|operating model|framework|priorities|resource allocation|governance|execution risk)\b/i.test(stripHtml(thesisIntroHtml))) {
    issues.push('Opening lacks thesis, strategic tension, or executive decision framing.');
  }
  if (h2Count >= 6 && totalWords < 1800) {
    issues.push('Too many H2 sections for the article length.');
  }

  const score = Math.max(0, 100 - (issues.length * 18) - (introWordCount < 60 ? 12 : 0));
  const h2LedRisk = score >= 82 ? 'low' : score >= 65 ? 'medium' : 'high';

  return {
    score,
    passed: score >= 75,
    h2Count,
    paragraphCount,
    introWordCount,
    introParagraphCount,
    keyInsightsBeforeBody,
    averageWordsPerH2,
    h2LedRisk,
    issues,
  };
}
