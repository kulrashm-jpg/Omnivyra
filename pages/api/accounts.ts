import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check for mock connections from URL parameters
    const { connected, account, mock } = req.query;
    
    let connectedAccounts = [];
    
    // If we have a mock connection, add it to the list
    if (connected && account && mock) {
      connectedAccounts.push({
        id: `${connected}-mock`,
        platform: connected,
        account_name: account,
        is_active: true,
      });
    }

    res.status(200).json(connectedAccounts);

  } catch (error: any) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: error.message });
  }
}
