import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const platform = 'twitter';
    const state = `twitter_${Date.now()}`;
    
    // Twitter OAuth URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.TWITTER_CLIENT_ID || 'your_twitter_client_id',
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/auth/twitter/callback`,
      state,
      scope: 'tweet.read tweet.write users.read offline.access',
      code_challenge: 'challenge', // PKCE for security
      code_challenge_method: 'plain'
    });
    
    const oauthUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
    
    // Redirect to Twitter OAuth
    res.redirect(oauthUrl);

  } catch (error: any) {
    console.error('Twitter OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}
