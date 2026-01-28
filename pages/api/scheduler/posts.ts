import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Mock data for now - replace with actual Supabase when configured
    const mockPosts = [
      {
        id: '1',
        content: 'Excited to share our latest innovation in AI technology! 🚀',
        platform: 'linkedin',
        scheduled_for: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: 'scheduled',
        account_name: 'John Doe',
        error_message: null,
        platform_post_id: null,
      },
      {
        id: '2',
        content: 'Just launched our new product! Check it out 👀 #innovation #tech',
        platform: 'twitter',
        scheduled_for: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'scheduled',
        account_name: '@johndoe',
        error_message: null,
        platform_post_id: null,
      },
    ];

    res.status(200).json(mockPosts);

  } catch (error: any) {
    console.error('Error fetching scheduled posts:', error);
    res.status(500).json({ error: error.message });
  }
}