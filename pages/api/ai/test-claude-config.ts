import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    res.status(200).json({ 
      hasApiKey: !!apiKey,
      keyLength: apiKey ? apiKey.length : 0,
      keyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'No key',
      message: apiKey ? 'Claude API key is configured' : 'Claude API key is missing'
    });

  } catch (error) {
    console.error('Error checking Claude API key:', error);
    res.status(500).json({ 
      error: 'Failed to check Claude API key',
      hasApiKey: false
    });
  }
}
