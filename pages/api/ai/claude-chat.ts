import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { message, context, stream = true } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'Anthropic API key is required' });
  }

  try {
    // Create context-aware prompt
    const systemPrompt = getSystemPrompt(context);
    
    // Set up streaming response
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx
    }
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        stream: stream,
        messages: [
          {
            role: 'user',
            content: message
          }
        ]
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Anthropic API error';
      try {
        const errorData = await response.json();
        console.error('Anthropic API Error:', errorData);
        
        if (errorData.error?.message) {
          errorMessage = errorData.error.message.replace(/[^\x00-\x7F]/g, '');
        } else if (errorData.error) {
          errorMessage = JSON.stringify(errorData.error).replace(/[^\x00-\x7F]/g, '');
        } else if (typeof errorData === 'string') {
          errorMessage = errorData.replace(/[^\x00-\x7F]/g, '');
        }
      } catch (parseError) {
        console.error('Error parsing API response:', parseError);
        errorMessage = `API Error: ${response.status} ${response.statusText}`;
      }
      
      if (stream) {
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.end();
      } else {
        throw new Error(errorMessage);
      }
      return;
    }

    if (stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]' || data.trim() === '') {
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  res.write(`data: ${JSON.stringify({ content: parsed.delta.text })}\n\n`);
                } else if (parsed.type === 'message_stop') {
                  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
                  res.end();
                  return;
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }

        // Send final message
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } catch (streamError) {
        console.error('Streaming error:', streamError);
        res.write(`data: ${JSON.stringify({ error: 'Streaming error occurred' })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming fallback
      const data = await response.json();
      const aiResponse = data.content[0]?.text || 'Sorry, I could not generate a response.';

      res.status(200).json({ 
        response: aiResponse,
        usage: data.usage,
        model: data.model
      });
    }

  } catch (error: any) {
    console.error('Claude API Error:', error);
    if (stream) {
      res.write(`data: ${JSON.stringify({ error: error.message || 'Failed to get response from Claude' })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ 
        error: error.message || 'Failed to get response from Claude',
        details: error.message
      });
    }
  }
}

function getSystemPrompt(context: string): string {
  const prompts = {
    'campaign-planning': `You are an expert content marketing strategist helping with campaign planning. 
    Focus on:
    - Creating strategic content calendars
    - Defining campaign objectives and KPIs
    - Suggesting content types and formats
    - Platform-specific strategies
    - Timeline and resource planning
    
    Provide actionable, specific advice for content campaigns.`,
    
    'market-analysis': `You are a market research analyst specializing in content marketing trends.
    Focus on:
    - Analyzing market trends and opportunities
    - Competitor analysis and benchmarking
    - Audience insights and segmentation
    - Content performance metrics
    - Industry best practices
    
    Provide data-driven insights and strategic recommendations.`,
    
    'content-creation': `You are a creative content writer and strategist.
    Focus on:
    - Writing engaging posts, articles, and captions
    - Adapting content for different platforms
    - Maintaining brand voice and tone
    - Creating compelling headlines and CTAs
    - Content optimization for engagement
    
    Write high-quality, platform-optimized content.`,
    
    'schedule-review': `You are a social media scheduling and optimization expert.
    Focus on:
    - Optimal posting times and frequency
    - Platform-specific scheduling strategies
    - Content distribution optimization
    - Engagement maximization
    - Campaign performance analysis
    
    Provide specific scheduling recommendations and optimizations.`,
    
    'general': `You are an AI assistant for a content management platform.
    Help users with:
    - Content strategy and planning
    - Social media management
    - Campaign optimization
    - Platform-specific guidance
    - Marketing best practices
    
    Be helpful, professional, and provide actionable advice.`
  };

  return prompts[context as keyof typeof prompts] || prompts.general;
}
