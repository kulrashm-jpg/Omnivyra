import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber, amendmentRequest, campaignData, dailyPlans } = req.body;

    if (!campaignId || !weekNumber || !amendmentRequest) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Prepare context for AI
    const context = {
      campaign: campaignData,
      weekNumber,
      dailyPlans,
      amendmentRequest
    };

    // Call Claude API for daily amendment
    const response = await fetch('/api/ai/claude-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Please amend the daily plan for Week ${weekNumber} based on this request: "${amendmentRequest}". 

Current daily plans:
${dailyPlans.map((plan: any, index: number) => 
  `${index + 1}. ${plan.day_of_week} - ${plan.platform} ${plan.content_type}: ${plan.title}`
).join('\n')}

Please provide a detailed amendment that includes:
1. Updated daily content schedule
2. Platform adjustments
3. Content type modifications
4. Timing changes
5. Content improvements

Format your response as a structured amendment that can be applied to the daily plans.`,
        context: 'daily-amendment',
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
    console.error('Error in daily amendment API:', error);
    res.status(500).json({ 
      error: 'Failed to process daily amendment',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






