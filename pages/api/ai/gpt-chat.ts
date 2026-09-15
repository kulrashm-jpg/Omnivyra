import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { validateAndModerateUserMessage } from '../../../backend/chatGovernance';
import { bearerAuthorization } from '../../../lib/httpAuthHeaders';
import { guardAiRequest, AiGuardError } from '../../../backend/services/ai/aiRequestGuard';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { resolveTrustedClientIp } from '../../../backend/services/ai/trustedClientIp';

// SEC91-D9: bound the provider call (max_tokens is 1000).
const GPT_CHAT_TIMEOUT_MS = 90_000;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ROUTE-AUTH-001 (STEP 3AH-85): signed-in callers only. The provider call
  // still runs on the caller's own key (BYOK), but the route runs moderation
  // and the AI guard on platform resources and must not be an open relay.
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { message, context, apiKey, stream = true } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // SEC91-D3: BYOK is checked BEFORE any platform-paid work. Moderation below is
  // an LLM call on the PLATFORM key; it used to run first, so a caller with no
  // key of their own could drive platform moderation spend and then get a 400.
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }

  // HARDEN-006: centralized AI protection (validation + rate/burst) before the
  // provider call. SEC91-D1: keyed by the authenticated user (per-user, burst)
  // plus the platform-trusted client IP — never the client-written XFF hop.
  try {
    await guardAiRequest({
      operation: 'chat.gpt',
      provider: 'openai',
      userId: user.id,
      ip: resolveTrustedClientIp(req),
      messages: [{ role: 'user', content: String(message) }],
    });
  } catch (err) {
    if (err instanceof AiGuardError) {
      if (err.retryAfterSecs) res.setHeader('Retry-After', String(err.retryAfterSecs));
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    // SEC91-D1: limiter outages are absorbed inside the guard; an error that
    // escapes it is a defect and must not become unlimited access.
    return res.status(503).json({ error: 'AI request protection unavailable. Please retry.', code: 'AI_GUARD_UNAVAILABLE' });
  }

  const policyResult = await validateAndModerateUserMessage(String(message), {
    chatContext: context ? String(context) : 'general',
  });
  if (!policyResult.allowed) {
    return res.status(400).json({
      error: 'Your message couldn\'t be processed. Please rephrase and try again.',
    });
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
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(GPT_CHAT_TIMEOUT_MS),
      headers: {
        'Authorization': bearerAuthorization(String(apiKey)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 1000,
        temperature: 0.7,
        stream: stream,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      if (stream) {
        res.write(`data: ${JSON.stringify({ error: errorData.error?.message || 'OpenAI API error' })}\n\n`);
        res.end();
      } else {
        throw new Error(errorData.error?.message || 'OpenAI API error');
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
              if (data === '[DONE]') {
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
                res.end();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  res.write(`data: ${JSON.stringify({ content })}\n\n`);
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
      const aiResponse = data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

      res.status(200).json({ 
        response: aiResponse,
        usage: data.usage,
        model: data.model
      });
    }

  } catch (error: any) {
    console.error('GPT API Error:', error);
    if (stream) {
      res.write(`data: ${JSON.stringify({ error: error.message || 'Failed to get response from GPT' })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ 
        error: error.message || 'Failed to get response from GPT',
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/ai/gpt-chat' });
