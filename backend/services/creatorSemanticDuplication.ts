import type { SourceTextTransform } from '../../lib/content/writerCreatorAttachmentContracts';

export type SemanticDuplicationResult = {
  ok: boolean;
  maxSimilarity: number;
  duplicatedItems: string[];
  repeatedInsights: string[];
};

function tokenize(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !['the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'your', 'you', 'are'].includes(token));
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const intersection = Array.from(left).filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function hashedEmbedding(value: string, dimensions = 64): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const token of tokenize(value)) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    vector[Math.abs(hash) % dimensions] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => item / magnitude);
}

function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, item, index) => sum + item * (b[index] ?? 0), 0);
}

function splitSource(value: string): string[] {
  return String(value || '')
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter((segment) => segment.length > 12);
}

export function detectSemanticThreadDuplication(input: {
  rawSourceText: string;
  visualItems: string[];
  transform: SourceTextTransform;
  threshold?: number;
}): SemanticDuplicationResult {
  const threshold = input.threshold ?? (input.transform === 'support_visual_only' ? 0.22 : 0.72);
  const sourceSegments = splitSource(input.rawSourceText);
  const duplicatedItems: string[] = [];
  let maxSimilarity = 0;

  for (const item of input.visualItems) {
    const itemTokens = tokenize(item);
    const itemEmbedding = hashedEmbedding(item);
    for (const segment of sourceSegments) {
      const score = Math.max(
        jaccard(itemTokens, tokenize(segment)),
        cosine(itemEmbedding, hashedEmbedding(segment)),
      );
      maxSimilarity = Math.max(maxSimilarity, score);
      if (score >= threshold) {
        duplicatedItems.push(item);
        break;
      }
    }
  }

  const seen = new Map<string, number>();
  const repeatedInsights: string[] = [];
  for (const item of input.visualItems) {
    const signature = tokenize(item).slice(0, 6).sort().join(' ');
    if (!signature) continue;
    const count = (seen.get(signature) ?? 0) + 1;
    seen.set(signature, count);
    if (count > 1) repeatedInsights.push(item);
  }

  return {
    ok: duplicatedItems.length === 0 && repeatedInsights.length === 0,
    maxSimilarity: Number(maxSimilarity.toFixed(3)),
    duplicatedItems,
    repeatedInsights,
  };
}
