import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const configured = !!apiKey && apiKey.length > 0;

    res.status(200).json({ 
      configured,
      provider: 'gpt',
      message: configured ? 'GPT API is configured' : 'GPT API key not found'
    });

  } catch (error) {
    console.error('Error checking GPT config:', error);
    res.status(500).json({ 
      configured: false,
      error: 'Failed to check GPT configuration' 
    });
  }
}
