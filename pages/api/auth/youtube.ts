import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if we're in mock mode (no real client ID)
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    
    if (!clientId || clientId === 'your_google_client_id') {
      // Mock mode - simulate successful OAuth
      const mockAccountData = {
        id: 'youtube-mock',
        platform: 'youtube',
        accountName: 'Your YouTube Channel',
        accountId: 'mock_youtube_id',
        accessToken: 'mock_access_token',
        isActive: true,
        permissions: ['youtube', 'youtube.upload']
      };
      
      // Redirect back with mock success
      return res.redirect(`/creative-scheduler?connected=youtube&account=${encodeURIComponent(mockAccountData.accountName)}&mock=true`);
    }

    // Real YouTube OAuth flow (via Google)
    const state = `youtube_${Date.now()}`;
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/auth/youtube/callback`,
      scope: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state
    });
    
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.redirect(oauthUrl);

  } catch (error: any) {
    console.error('YouTube OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}























