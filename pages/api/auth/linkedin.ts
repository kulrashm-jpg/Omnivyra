import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if we're in mock mode (no real client ID)
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    
    if (!clientId || clientId === 'your_linkedin_client_id') {
      // Mock mode - simulate successful OAuth
      const mockAccountData = {
        id: 'linkedin-mock',
        platform: 'linkedin',
        accountName: 'Your LinkedIn Account',
        accountId: 'mock_linkedin_id',
        accessToken: 'mock_access_token',
        isActive: true,
        permissions: ['r_liteprofile', 'w_member_social']
      };
      
      // Redirect back with mock success
      return res.redirect(`/creative-scheduler?connected=linkedin&account=${encodeURIComponent(mockAccountData.accountName)}&mock=true`);
    }

    // Real OAuth flow
    const platform = 'linkedin';
    const state = `linkedin_${Date.now()}`;
    
    console.log('Initiating LinkedIn OAuth with client ID:', clientId?.substring(0, 8) + '...');
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/auth/linkedin/callback`,
      state,
      scope: 'r_liteprofile r_emailaddress w_member_social'
    });
    
    const oauthUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    console.log('Redirecting to LinkedIn OAuth:', oauthUrl);
    res.redirect(oauthUrl);

  } catch (error: any) {
    console.error('LinkedIn OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}
