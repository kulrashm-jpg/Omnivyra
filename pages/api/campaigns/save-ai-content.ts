import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, aiContent, timestamp, provider } = req.body;

    if (!campaignId || !aiContent) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Save AI content to database
    const { data, error } = await supabase
      .from('ai_threads')
      .insert({
        campaign_id: campaignId,
        thread_type: 'content_planning',
        messages: [
          {
            role: 'assistant',
            content: aiContent,
            timestamp: timestamp || new Date().toISOString(),
            provider: provider || 'unknown'
          }
        ],
        status: 'saved_for_planning',
        created_at: new Date().toISOString()
      })
      .select();

    if (error) {
      console.error('Error saving AI content:', error);
      return res.status(500).json({ error: 'Failed to save AI content' });
    }

    // Also save to content_plans table for easy access
    const { error: contentError } = await supabase
      .from('content_plans')
      .insert({
        campaign_id: campaignId,
        content_type: 'ai_generated_plan',
        title: 'AI Generated Content Plan',
        description: aiContent,
        status: 'draft',
        ai_generated: true,
        ai_provider: provider || 'unknown',
        created_at: new Date().toISOString()
      });

    if (contentError) {
      console.error('Error saving to content_plans:', contentError);
      // Don't fail the request, just log the error
    }

    res.status(200).json({ 
      success: true, 
      message: 'AI content saved successfully',
      data: data?.[0]
    });

  } catch (error) {
    console.error('Error in save-ai-content API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
