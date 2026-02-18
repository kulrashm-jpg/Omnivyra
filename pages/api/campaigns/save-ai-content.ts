import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, aiContent, timestamp, provider } = req.body;

    if (!campaignId || !aiContent) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const threadId = `save_${campaignId}_${Date.now()}`;
    const messagesPayload = [
      {
        role: 'assistant',
        content: aiContent,
        timestamp: timestamp || new Date().toISOString(),
        provider: provider || 'unknown'
      }
    ];

    // Save AI content to database (ai_threads.id is required; thread_type/status from migration)
    const insertPayload: Record<string, unknown> = {
      id: threadId,
      campaign_id: campaignId,
      messages: messagesPayload,
      thread_type: 'content_planning',
      status: 'saved_for_planning',
      created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('ai_threads')
      .insert(insertPayload as any)
      .select();

    if (error) {
      console.error('Error saving AI content:', error);
      return res.status(500).json({
        error: 'Failed to save AI content',
        message: error.message,
        details: error.details,
      });
    }

    // Also save to content_plans table for easy access (platform required by base schema)
    const { error: contentError } = await supabase
      .from('content_plans')
      .insert({
        campaign_id: campaignId,
        platform: 'multi',
        content_type: 'ai_generated_plan',
        description: aiContent,
        status: 'planned',
        ai_generated: true,
        created_at: new Date().toISOString()
      } as Record<string, unknown>);

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
