import type { NextApiRequest, NextApiResponse } from 'next';
import { getAboutImages } from '../../lib/unsplashAboutImages';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
