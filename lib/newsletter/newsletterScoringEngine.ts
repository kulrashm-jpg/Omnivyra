import {
  computeContentSearchScores,
  type ContentSearchPost,
  type ContentSearchScores,
} from '../content/searchScoringCore';
import { flattenBlocks } from '../content/blockUtils';
import type { ContentBlock } from '../content/blockTypes';

export type NewsletterPost = ContentSearchPost;
export type NewsletterScores = ContentSearchScores;

export function computeNewsletterScores(post: NewsletterPost): NewsletterScores {
  const base = computeContentSearchScores(post);
  const flat = flattenBlocks((Array.isArray(post.content_blocks) ? post.content_blocks : []) as ContentBlock[]);
  const quoteCount = flat.filter((block) => block.type === 'quote' && String(block.text ?? '').trim().length > 0).length;
  const calloutCount = flat.filter((block) => block.type === 'callout' && String(block.body ?? '').trim().length > 0).length;
  const summaryCount = flat.filter((block) => block.type === 'summary' && String(block.body ?? '').trim().length > 24).length;
  const keyInsightCount = flat.filter((block) => block.type === 'key_insights' && block.items.filter((item) => item.trim()).length >= 3).length;

  const geoBonus =
    (summaryCount > 0 ? 8 : 0) +
    (keyInsightCount > 0 ? 10 : 0) +
    (quoteCount > 0 ? 6 : 0) +
    (calloutCount > 0 ? 4 : 0);
  const seoBonus =
    (summaryCount > 0 ? 3 : 0) +
    (keyInsightCount > 0 ? 2 : 0);

  return {
    ...base,
    seo_score: Math.min(100, base.seo_score + seoBonus),
    geo_score: Math.min(100, base.geo_score + geoBonus),
  };
}
