import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';

type AiHistoryEntry = {
  snapshot_hash: string;
  omnivyre_decision: any;
  structured_plan: any;
  scheduled_posts: any[];
  created_at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  try {
    const { data: plans, error: plansError } = await supabase
      .from('twelve_week_plan')
      .select('snapshot_hash, omnivyre_decision, weeks, created_at')
      .eq('campaign_id', id)
      .order('created_at', { ascending: false });

    if (plansError) {
      throw new Error(`Failed to load campaign plans: ${plansError.message}`);
    }

    const { data: scheduledPosts, error: scheduledError } = await supabase
      .from('scheduled_posts')
      .select('id, platform, content, scheduled_for, status, created_at')
      .eq('campaign_id', id)
      .order('created_at', { ascending: false });

    if (scheduledError) {
      throw new Error(`Failed to load scheduled posts: ${scheduledError.message}`);
    }

    const planEntries: AiHistoryEntry[] = (plans || []).map((plan: any, index: number) => {
      const start = plan.created_at ? new Date(plan.created_at).getTime() : 0;
      const end =
        index === 0
          ? Number.POSITIVE_INFINITY
          : plans?.[index - 1]?.created_at
          ? new Date(plans[index - 1].created_at).getTime()
          : Number.POSITIVE_INFINITY;

      const postsForPlan = (scheduledPosts || []).filter((post: any) => {
        if (!post.created_at) return false;
        const createdAt = new Date(post.created_at).getTime();
        return createdAt >= start && createdAt < end;
      });

      return {
        snapshot_hash: plan.snapshot_hash,
        omnivyre_decision: plan.omnivyre_decision,
        structured_plan: { weeks: plan.weeks || [] },
        scheduled_posts: postsForPlan,
        created_at: plan.created_at,
      };
    });

    return res.status(200).json({ history: planEntries });
  } catch (error: any) {
    console.error('Error in AI history API:', error);
    return res.status(500).json({ error: 'Failed to load AI history' });
  }
}
