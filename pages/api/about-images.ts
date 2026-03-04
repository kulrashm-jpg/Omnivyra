import type { NextApiRequest, NextApiResponse } from 'next';
import { getAboutImages } from '../../lib/unsplashAboutImages';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { architectural, systems } = await getAboutImages();
    return res.status(200).json({ architectural, systems });
  } catch (e) {
    console.error('about-images', e);
    return res.status(500).json({ architectural: null, systems: null });
  }
}
