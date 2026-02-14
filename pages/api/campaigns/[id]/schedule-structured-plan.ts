import { NextApiRequest, NextApiResponse } from 'next';
import { scheduleStructuredPlan } from '../../../../backend/services/structuredPlanScheduler';
import { assertBlueprintActive } from '../../../../backend/services/campaignBlueprintService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  try {
    await assertBlueprintActive(id);

    const { plan } = req.body || {};
    if (!plan || !Array.isArray(plan.weeks)) {
      return res.status(400).json({ error: 'Structured plan is required' });
    }

    const result = await scheduleStructuredPlan(plan, id);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error scheduling structured plan:', error);
    return res.status(500).json({ error: 'Failed to schedule structured plan' });
  }
}
