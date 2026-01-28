import { saveContentSimilarityCheck } from '../db/campaignMemoryStore';

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

const similarityScore = (a: string, b: string): number => {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const overlap = Array.from(aTokens).filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(aTokens.size, bTokens.size);
};

export async function detectContentOverlap(input: {
  companyId: string;
  newProposedContent: string[];
  campaignMemory: {
    pastThemes: string[];
    pastTopics: string[];
    pastHooks: string[];
    pastTrendsUsed: string[];
    pastPlatforms: string[];
    pastContentSummaries: string[];
  };
}): Promise<{
  overlapDetected: boolean;
  overlappingItems: string[];
  similarityScore: number;
  recommendation: string;
}> {
  const memoryItems = [
    ...input.campaignMemory.pastThemes,
    ...input.campaignMemory.pastTopics,
    ...input.campaignMemory.pastHooks,
    ...input.campaignMemory.pastContentSummaries,
  ];

  let maxScore = 0;
  const overlaps: string[] = [];
  input.newProposedContent.forEach((content) => {
    memoryItems.forEach((past) => {
      const score = similarityScore(content, past);
      if (score > 0.6) {
        overlaps.push(past);
      }
      maxScore = Math.max(maxScore, score);
    });
  });

  const result =
    maxScore > 0.8 ? 'blocked' : maxScore > 0.6 ? 'warning' : 'clear';
  await saveContentSimilarityCheck({
    companyId: input.companyId,
    newContent: input.newProposedContent,
    similarityScore: Number(maxScore.toFixed(3)),
    result,
  });

  return {
    overlapDetected: maxScore > 0.6,
    overlappingItems: Array.from(new Set(overlaps)),
    similarityScore: Number(maxScore.toFixed(3)),
    recommendation:
      maxScore > 0.8
        ? 'Duplicate content detected. Create a new angle.'
        : maxScore > 0.6
        ? 'Similar content detected. Consider a fresh angle.'
        : 'Content is sufficiently unique.',
  };
}
