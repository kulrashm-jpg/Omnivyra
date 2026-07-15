import { createApiRoute as __createApiRoute } from '../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAboutImages } from '../../lib/unsplashAboutImages';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const images = await getAboutImages();
    return res.status(200).json(images);
  } catch (e) {
    console.error('about-images', e);
    return res.status(500).json({ hero: null, chaos: null, disconnected: null, connected: null, blueprint: null });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/about-images' });
