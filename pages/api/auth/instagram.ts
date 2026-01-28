import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if we're in mock mode (no real client ID)
    const clientId = process.env.INSTAGRAM_CLIENT_ID;
    
    if (!clientId || clientId === 'your_facebook_app_id') {
      // Mock mode - simulate successful OAuth
      const mockAccountData = {
        id: 'instagram-mock',
        platform: 'instagram',
        accountName: 'Your Instagram Account',
        accountId: 'mock_instagram_id',
        accessToken: 'mock_access_token',
        isActive: true,
        permissions: ['instagram_basic', 'instagram_content_publish']
      };
      
      // Redirect back with mock success
      return res.redirect(`/creative-scheduler?connected=instagram&account=${encodeURIComponent(mockAccountData.accountName)}&mock=true`);
    }

    // Real Instagram OAuth flow (via Facebook)
    const state = `instagram_${Date.now()}`;
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/auth/instagram/callback`,
      scope: 'instagram_basic instagram_content_publish pages_show_list',
      response_type: 'code',
      state
    });
    
    const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
    res.redirect(oauthUrl);

  } catch (error: any) {
    console.error('Instagram OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}























