/**
 * Image Search API — thin proxy to the centralized imageService.
 * All provider logic, caching, rate limiting, and quality filtering
 * lives in backend/services/imageService.ts.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { searchImages } from '@/backend/services/imageService';
import { recordImageSearch } from '@/backend/db/imageMetadataStore';

export type { NormalizedImage as ImageResult } from '@/backend/services/imageService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) return res.status(400).json({ error: 'Missing query parameter q' });

  const perPage = Math.min(Number(req.query.per_page ?? 12), 24);

  const hasKey = process.env.UNSPLASH_ACCESS_KEY || process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY;
  if (!hasKey) {
    return res.status(503).json({
      error: 'No image API keys configured. Add UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, or PIXABAY_API_KEY to .env.local',
    });
  }

  const result = await searchImages(query, { perPage });

  // Persist metadata asynchronously — do not await so it doesn't block the response
  if (result.images.length > 0) {
    recordImageSearch(query, result.query, result.images).catch(() => {/* fire-and-forget */});
  }

  if (result.images.length === 0) {
    return res.status(200).json({ results: [] });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({
    results: result.images,
    meta: {
      query: result.query,
      originalQuery: result.originalQuery,
      source: result.source,
      fromCache: result.fromCache,
    },
  });
}
