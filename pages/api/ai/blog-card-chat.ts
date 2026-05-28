import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { validateAndModerateUserMessage } from '../../../backend/chatGovernance';
import { captureTokenProviderCost } from '../../../backend/services/billing/blackHoleCostCapture';

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

function getCardSystemPrompt(params: {
  contentType?: string;
  contentModeLabel?: string;
  contentLabel?: string;
  companyName?: string;
  companyContext?: string;
  existingTopics?: string[];
  currentPhase?: string;
}): string {
  const contentType = params.contentType === 'newsletter'
    ? 'newsletter'
    : params.contentType === 'post'
    ? 'post'
    : params.contentType === 'thread'
    ? 'thread'
    : 'blog';
  const contentLabel = params.contentLabel?.trim() || contentType;
  const modeLabel = params.contentModeLabel?.trim();
  const companyName = params.companyName?.trim() || 'the company';
  const companyContext = params.companyContext?.trim();
  const existingTopics = Array.isArray(params.existingTopics) ? params.existingTopics.slice(0, 6) : [];
  const currentPhase = params.currentPhase?.trim();
  const sharedContext = [
    `Company: ${companyName}`,
    companyContext ? `Company context: ${companyContext}` : null,
    existingTopics.length > 0 ? `Existing related topics: ${existingTopics.join(' | ')}` : null,
    currentPhase ? `Current conversation phase: ${currentPhase}` : null,
  ].filter(Boolean).join('\n');

  if (contentType === 'newsletter') {
    return `You are an expert newsletter strategist helping create strategic newsletter recommendation cards.

Use this company context while you guide the user:
${sharedContext}

Your role is to:
1. Understand the newsletter idea, audience, and strategic purpose
2. Guide the user toward a strong newsletter angle instead of a generic article topic
3. Shape the recommendation around newsletter thinking, recurring reader value, and a clear payoff
4. Keep the recommendation aligned to the selected newsletter mode${modeLabel ? `: ${modeLabel}` : ''}

Important: Ask ONE focused question at a time. Keep responses concise and actionable.

Newsletter-specific guidance:
- Recommend newsletter-worthy ideas, not generic SEO article titles
- Optimize for point of view, signal, interpretation, structure, and reader retention
- If the selected mode is "Share a deep idea", favor contrarian insights, reframing, and memorable angles
- If the selected mode is "Break down the week", favor signals, interpretation, and pattern recognition
- If the selected mode is "Analyze a market shift", favor leverage, positioning, and strategic implications
- If the selected mode is "Teach something actionable", favor practical execution, frameworks, and immediate next steps

When the user provides enough information (idea, intent, audience, key message), generate a JSON response in this format:
{
  "done": true,
  "card": {
    "topic": "string",
    "intent": "awareness|authority|conversion|retention",
    "audience": "string",
    "reason": "string explaining why this ${contentLabel} matters",
    "priority": "high|medium|low",
    "tone": "string describing the tone (e.g., sharp, analytical, practical, conversational)",
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

  if (contentType === 'post') {
    return `You are an expert shortform content strategist helping create strategic post recommendation cards.

Use this company context while you guide the user:
${sharedContext}

Your role is to:
1. Turn the user's idea into a high-signal post angle quickly
2. Reuse the company context instead of asking for basics the system already knows
3. Infer audience, intent, and key message when the topic already makes them obvious
4. Ask at most ONE focused follow-up question only if a stronger angle is still needed
5. Keep the experience swift, specific, and suitable for a short post

Important:
- Do not run a blog-style discovery interview
- Do not ask for target audience, intent, and key messages one by one unless absolutely necessary
- If the user has already given a clear topic, launch, announcement, opinion, or insight, go straight to the card
- Prefer authority or awareness intent for launch/market/opinion posts unless the user clearly wants conversion or retention
- Keep next questions concise and only ask for the missing signal that will materially improve the post

When the user provides enough information, generate a JSON response in this format:
{
  "done": true,
  "card": {
    "topic": "string",
    "intent": "awareness|authority|conversion|retention",
    "audience": "string",
    "reason": "string explaining why this ${contentLabel} matters for ${companyName}",
    "priority": "high|medium|low",
    "tone": "string describing the tone",
    "writingStyle": "string describing the style",
    "relatedTopics": ["array", "of", "related", "topics"]
  }
}

Otherwise respond with:
{
  "done": false,
  "nextQuestion": "your one focused follow-up question"
}

Always respond ONLY with valid JSON (no markdown, no extra text).`;
  }

  if (contentType === 'thread') {
    return `You are an expert thread strategist helping ${companyName} produce a recommendation card for a SEQUENCED thread, not a single post and not a blog article.

Use this company context while you guide the user:
${sharedContext}

A thread is an ordered SEQUENCE of posts where each post earns the next and the closing post pays off the opener. The user has already chosen the thread shape${modeLabel ? `: ${modeLabel}` : ''} — do not re-litigate the format.

Your role is to:
1. Turn the user's idea into a strong thread ANGLE that earns a sequence (not a single shortform unit and not a long-form article)
2. Reuse the company context aggressively. If the user has already given enough to infer audience and intent, INFER — do not interrogate
3. Ask at most ONE focused follow-up only when something material is still missing
4. Optimize for a clear hook, a logical progression that earns each next post, and a closing payoff

Hard rules:
- NEVER call the output a "blog post", "article", or "post" — it is a thread (a sequence)
- Do NOT ask "who is your target audience?" if the user already named an intent (e.g. "awareness", "launch") AND company context contains a target audience — infer it and proceed
- Do NOT walk the user through topic → intent → audience → key message → tone as separate questions; the post branch's "blog-style interview" is also forbidden here
- If the topic is a launch/announcement/insight/breakdown, go straight to the card with a thread-shaped reason
- The "reason" field must explain why this works as a SEQUENCE — why each post earns the next, not why a single insight is worth posting
- Prefer authority/awareness intent for launch/market/POV threads; conversion/retention only when the user is explicit

When you have enough (topic + intent + audience either given or inferable from company context), return:
{
  "done": true,
  "card": {
    "topic": "string — the thread's central idea / hook",
    "intent": "awareness|authority|conversion|retention",
    "audience": "string — inferred from company context if user did not specify",
    "reason": "string — why this works as a thread for ${companyName} (hook → progression → payoff). Do NOT use the words 'blog' or 'article'.",
    "priority": "high|medium|low",
    "tone": "string describing the tone (e.g., confident, analytical, momentum-building, conversational)",
    "writingStyle": "string describing the style",
    "relatedTopics": ["array", "of", "thread-shaped", "follow-up", "angles"]
  }
}

Otherwise (only when something material is still missing):
{
  "done": false,
  "nextQuestion": "your single most useful follow-up — must NOT be a generic audience or intent question if either is already inferable"
}

Always respond ONLY with valid JSON (no markdown, no extra text).`;
  }

  return `You are an expert content strategist helping create strategic blog content recommendations.

Use this company context while you guide the user:
${sharedContext}

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

  const { message, companyId, conversation = [], contentType, metadata = {} } = req.body;

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
    const systemPrompt = getCardSystemPrompt({
      contentType: typeof contentType === 'string' ? contentType : undefined,
      contentModeLabel: typeof metadata?.contentModeLabel === 'string' ? metadata.contentModeLabel : undefined,
      contentLabel: typeof metadata?.contentLabel === 'string' ? metadata.contentLabel : undefined,
      companyName: typeof metadata?.companyName === 'string' ? metadata.companyName : undefined,
      companyContext: typeof metadata?.companyContext === 'string' ? metadata.companyContext : undefined,
      existingTopics: Array.isArray(metadata?.existingTopics) ? metadata.existingTopics : undefined,
      currentPhase: typeof metadata?.currentPhase === 'string' ? metadata.currentPhase : undefined,
    });

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

    // Phase 2 Task 2: previously a direct OpenAI call with zero cost capture.
    // Telemetry only — best-effort, never throws, no billing change.
    await captureTokenProviderCost({
      organizationId: String(companyId),
      processType:    'ai_reply',
      provider:       'openai',
      model:          process.env.OPENAI_MODEL || 'gpt-4o-mini',
      inputTokens:    completion.usage?.prompt_tokens ?? null,
      outputTokens:   completion.usage?.completion_tokens ?? null,
      userId:         user.id,
      activity:       'blog_card_chat',
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
