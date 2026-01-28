// Handle GET requests to /api/campaigns
import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// Use service role key for server-side operations (bypasses RLS)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create Supabase client - will be validated in each handler
let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
} else {
  console.error('Missing Supabase environment variables:', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseKey,
    url: supabaseUrl ? 'set' : 'missing',
    key: supabaseKey ? 'set' : 'missing'
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    // Handle campaign creation
    try {
      // Validate Supabase configuration
      if (!supabase) {
        console.error('Missing Supabase configuration for POST:', {
          hasUrl: !!supabaseUrl,
          hasKey: !!supabaseKey
        });
        return res.status(500).json({ 
          error: 'Server configuration error',
          details: 'Missing Supabase environment variables. Please check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        });
      }

      const campaignData = req.body;
      console.log('Received campaign data:', campaignData);
      
      // Add required user_id field for development and map field names
      const { startDate, endDate, goals, ...campaignDataWithoutCamelCase } = campaignData;
      const campaignDataWithUser = {
        ...campaignDataWithoutCamelCase,
        user_id: '550e8400-e29b-41d4-a716-446655440000', // Default user ID for development
        start_date: startDate, // Map camelCase to snake_case
        end_date: endDate // Map camelCase to snake_case
      };

      console.log('Processed campaign data for database:', campaignDataWithUser);

      // Insert campaign into database
      const { data: campaign, error } = await supabase
        .from('campaigns')
        .insert([campaignDataWithUser])
        .select()
        .single();

      if (error) {
        console.error('Error creating campaign:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        return res.status(500).json({ 
          error: 'Failed to create campaign', 
          details: error.message,
          code: error.code,
          hint: error.hint
        });
      }

      console.log('Campaign created successfully:', campaign.id);
      return res.status(201).json({ 
        success: true,
        campaign,
        message: 'Campaign created successfully'
      });
    } catch (error) {
      console.error('Error in campaign creation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({ 
        error: 'Internal server error',
        details: errorMessage
      });
    }
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, campaignId } = req.query;

    if (type === 'campaign' && campaignId) {
      // Validate Supabase configuration
      if (!supabase) {
        return res.status(500).json({ 
          error: 'Server configuration error',
          details: 'Missing Supabase environment variables.'
        });
      }
      
      // Get specific campaign
      const { data: campaign, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .single();

      if (error) {
        console.log('Campaign not found, returning fallback campaign:', campaignId);
        // Return fallback campaign data instead of 404
        const fallbackCampaign = {
          id: campaignId,
          name: 'Campaign ' + campaignId,
          description: '',
          status: 'planning',
          current_stage: 'planning',
          timeframe: 'quarter',
          start_date: null,
          end_date: null,
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          thread_id: 'thread_' + Date.now(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        return res.status(200).json({ campaign: fallbackCampaign });
      }

      return res.status(200).json({ campaign });
    } else if (type === 'goals' && campaignId) {
      // Validate Supabase configuration
      if (!supabase) {
        return res.status(500).json({ 
          error: 'Server configuration error',
          details: 'Missing Supabase environment variables.'
        });
      }
      
      // Get campaign goals
      const { data: goals, error } = await supabase
        .from('campaign_goals')
        .select('*')
        .eq('campaign_id', campaignId);

      if (error) {
        console.log('Goals not found, returning empty array:', campaignId);
        return res.status(200).json({ goals: [] });
      }

      return res.status(200).json({ goals });
    } else {
      // Validate Supabase configuration
      if (!supabase) {
        console.error('Missing Supabase configuration:', {
          hasUrl: !!supabaseUrl,
          hasKey: !!supabaseKey
        });
        return res.status(500).json({ 
          error: 'Server configuration error',
          details: 'Missing Supabase environment variables. Please check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        });
      }

      // GetAll campaigns for user
      let campaigns, error;
      try {
        const result = await supabase
          .from('campaigns')
          .select('*')
          .order('created_at', { ascending: false });
        campaigns = result.data;
        error = result.error;
      } catch (fetchError) {
        console.error('Supabase query failed with exception:', {
          error: fetchError,
          message: fetchError instanceof Error ? fetchError.message : String(fetchError),
          stack: fetchError instanceof Error ? fetchError.stack : undefined
        });
        return res.status(500).json({ 
          error: 'Failed to fetch campaigns',
          details: fetchError instanceof Error ? fetchError.message : 'Unknown error during database query',
          type: 'query_exception'
        });
      }

      if (error) {
        console.error('Error fetching campaigns:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        return res.status(500).json({ 
          error: 'Failed to fetch campaigns',
          details: error.message,
          code: error.code
        });
      }

      console.log(`API: Found ${campaigns?.length || 0} campaigns:`, campaigns?.map(c => ({ id: c.id, name: c.name, status: c.status })));
      
      return res.status(200).json({ 
        success: true,
        campaigns: campaigns || []
      });
    }
  } catch (error) {
    console.error('Error in campaigns API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: errorStack })
    });
  }
}