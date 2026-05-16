import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { message, context = 'general', stream = true, apiKey: requestApiKey } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const apiKey = typeof requestApiKey === 'string' && requestApiKey.trim()
    ? requestApiKey.trim()
    : process.env.ANTHROPIC_API_KEY;
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
    
    const model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
    const response = await callAnthropicWithRetry({
      apiKey,
      model,
      systemPrompt,
      stream,
      message,
    });

    if (!response.ok) {
      const errorMessage = await extractAnthropicError(response);
      
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

async function callAnthropicWithRetry(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  stream: boolean;
  message: string;
}): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': input.apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 1000,
        system: input.systemPrompt,
        stream: input.stream,
        messages: [
          {
            role: 'user',
            content: input.message,
          },
        ],
      }),
    });

    lastResponse = response;
    if (!TRANSIENT_STATUS_CODES.has(response.status) || attempt === 3) return response;

    // Drain the failed response before retrying so the connection can be reused.
    await response.text().catch(() => '');
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }

  return lastResponse!;
}

async function extractAnthropicError(response: Response): Promise<string> {
  const fallback = TRANSIENT_STATUS_CODES.has(response.status)
    ? 'Claude is temporarily unavailable. Please try again in a moment.'
    : `API Error: ${response.status} ${response.statusText}`;
  try {
    const errorData = await response.json();
    console.error('Anthropic API Error:', {
      status: response.status,
      type: errorData?.error?.type,
      message: errorData?.error?.message,
    });

    if (TRANSIENT_STATUS_CODES.has(response.status)) return fallback;
    if (errorData.error?.message) {
      return errorData.error.message.replace(/[^\x00-\x7F]/g, '');
    }
    if (errorData.error) {
      return JSON.stringify(errorData.error).replace(/[^\x00-\x7F]/g, '');
    }
    if (typeof errorData === 'string') {
      return errorData.replace(/[^\x00-\x7F]/g, '');
    }
  } catch (parseError) {
    console.error('Error parsing API response:', parseError);
  }
  return fallback;
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

    'blog-card-creation': `You are an expert blog content strategist helping users refine and structure blog post ideas.
    You help users:
    - Define the core topic and focus of their blog post
    - Determine the intent (awareness, authority, conversion, or retention)
    - Identify the target audience
    - Select the appropriate tone and writing style
    - Create structured recommendations for high-quality blog content
    
    Ask clarifying questions to understand their blog vision deeply. Help them think through:
    - What specific problem they're solving
    - Who needs this information most
    - What outcome they want (educate, establish expertise, drive action, or deepen engagement)
    - The key insights or angles that make this unique
    
    Be conversational, insightful, and help them create compelling blog topics.`,
    
    'general': `You are an AI assistant for a content management platform.
    Help users with:
    - Content strategy and planning
    - Social media management
    - Campaign optimization
    - Platform-specific guidance
    - Marketing best practices
    
    Be helpful, professional, and provide actionable advice.`
  };

  // Check if context starts with a key in prompts
  for (const key of Object.keys(prompts)) {
    if (context.startsWith(key)) {
      return prompts[key as keyof typeof prompts];
    }
  }

  return prompts.general;
}
