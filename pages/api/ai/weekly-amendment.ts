import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber, amendmentRequest, campaignData, currentWeekData } = req.body;

    if (!campaignId || !weekNumber || !amendmentRequest) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Prepare context for AI
    const context = {
      campaign: campaignData,
      weekNumber,
      currentWeekData,
      amendmentRequest
    };

    // Call Claude API for amendment
    const response = await fetch('/api/ai/claude-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Please amend Week ${weekNumber} of the campaign based on this request: "${amendmentRequest}". 

Current week data:
- Theme: ${currentWeekData?.theme || 'Not set'}
- Focus Area: ${currentWeekData?.focus_area || 'Not set'}
- AI Suggestions: ${currentWeekData?.ai_suggestions?.join(', ') || 'None'}

Please provide a detailed amendment that includes:
1. Updated theme and focus area
2. Revised AI suggestions
3. Content strategy adjustments
4. Platform recommendations

Format your response as a structured amendment that can be applied to the week.`,
        context: 'weekly-amendment',
        campaignData: campaignData,
        campaignLearnings: []
      })
    });

    if (!response.ok) {
      throw new Error('Failed to get AI amendment');
    }

    const aiResponse = await response.json();
    
    res.status(200).json({
      success: true,
      amendment: aiResponse.response,
      weekNumber,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in weekly amendment API:', error);
    res.status(500).json({ 
      error: 'Failed to process weekly amendment',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






