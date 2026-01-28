// API Endpoint for Platform Account Management
import { NextApiRequest, NextApiResponse } from 'next';
import { PostingServiceFactory } from '@/lib/services/posting';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { platform } = req.query;

  if (!platform || typeof platform !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Platform is required',
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        // Get account info for platform
        const postingService = PostingServiceFactory.getService(platform);
        
        if (!postingService) {
          return res.status(400).json({
            success: false,
            error: `Platform ${platform} not supported`,
          });
        }

        const accountInfo = await postingService.getAccountInfo();
        
        res.status(200).json({
          success: true,
          data: accountInfo,
        });
        break;

      case 'POST':
        // Connect/authenticate account
        const { code, state } = req.body;
        
        // Mock OAuth flow - in production, implement real OAuth
        console.log(`Connecting ${platform} account with code:`, code);
        
        // Simulate account connection
        const mockAccountInfo = {
          id: `${platform}_account_${Date.now()}`,
          name: `Your ${platform.charAt(0).toUpperCase() + platform.slice(1)} Account`,
          username: `@your-${platform}-username`,
          followers: Math.floor(Math.random() * 10000),
          isActive: true,
          lastPosted: null,
        };
        
        res.status(200).json({
          success: true,
          data: mockAccountInfo,
          message: `${platform.charAt(0).toUpperCase() + platform.slice(1)} account connected successfully`,
        });
        break;

      case 'DELETE':
        // Disconnect account
        console.log(`Disconnecting ${platform} account`);
        
        res.status(200).json({
          success: true,
          message: `${platform.charAt(0).toUpperCase() + platform.slice(1)} account disconnected successfully`,
        });
        break;

      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}























