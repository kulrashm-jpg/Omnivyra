import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { validateAndModerateUserMessage } from '../../../backend/chatGovernance';

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

function getBlogCardSystemPrompt(): string {
  return `You are an expert content strategist helping create strategic blog content recommendations.

Your role is to:
1. Understand the topic and intent the user wants to explore
2. Guide them through refining the topic into a clear, actionable blog recommendation
3. Help them identify the target audience and key messages
4. Ensure the content aligns with their overall marketing strategy

Important: Ask ONE focused question at a time. Keep responses concise and actionable.

When the user provides enough information (topic, intent, audience, key messages), generate a JSON response in this format:
{
  "done": true,
  "card": {
    "topic": "string",
    "intent": "awareness|authority|conversion|retention",
    "audience": "string",
    "reason": "string explaining why this blog post matters",
    "priority": "high|medium|low",
    "tone": "string describing the tone (e.g., professional, conversational, educational)",
    "writingStyle": "string describing the style",
    "relatedTopics": ["array", "of", "related", "topics"]
  }
}

Otherwise respond with:
{
  "done": false,
  "nextQuestion": "your next guiding question"
}

Always respond ONLY with valid JSON (no markdown, no extra text).`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate auth - user must be authenticated
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { message, companyId, conversation = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  // Validate and moderate message
  const policyResult = await validateAndModerateUserMessage(String(message), {
    chatContext: 'blog-card-creation',
  });

  if (!policyResult.allowed) {
    return res.status(400).json({
      error: 'Your message couldn\'t be processed. Please rephrase and try again.',
    });
  }

  try {
    const systemPrompt = getBlogCardSystemPrompt();

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      // Include previous conversation turns
      ...(Array.isArray(conversation)
        ? conversation.map((m: any) => ({
            role: (m.role || 'user') as 'user' | 'assistant',
            content: String(m.content || m.message || ''),
          }))
        : []),
      // Add the current message
      { role: 'user', content: String(message) },
    ];

    const client = getOpenAiClient();
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';

    let parsed: {
      done?: boolean;
      nextQuestion?: string;
      card?: {
        topic: string;
        intent: 'awareness' | 'authority' | 'conversion' | 'retention';
        audience: string;
        reason: string;
        priority: 'high' | 'medium' | 'low';
        tone: string;
        writingStyle: string;
        relatedTopics: string[];
      };
    };

    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse AI response:', raw);
      return res.status(500).json({ error: 'Invalid AI response format' });
    }

    if (parsed.done && parsed.card) {
      return res.status(200).json({
        done: true,
        card: parsed.card,
      });
    }

    return res.status(200).json({
      done: false,
      nextQuestion: parsed.nextQuestion || 'What would you like to write about?',
    });
  } catch (err: any) {
    console.error('Blog card chat failed:', err);
    return res.status(500).json({
      error: 'Failed to process blog card chat',
      details: err?.message || null,
    });
  }
}
