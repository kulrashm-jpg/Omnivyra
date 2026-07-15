import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { runCompletion } from '../../../backend/services/aiGateway';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { validateAndModerateUserMessage } from '../../../backend/chatGovernance';

type CardContentType =
  | 'blog'
  | 'newsletter'
  | 'post'
  | 'thread'
  | 'story'
  | 'article'
  | 'guide'
  | 'whitepaper'
  | 'case-study';


function normalizeCardContentType(contentType?: string): CardContentType {
  const normalized = String(contentType || '').trim().toLowerCase();
  if (
    normalized === 'newsletter'
    || normalized === 'post'
    || normalized === 'thread'
    || normalized === 'story'
    || normalized === 'article'
    || normalized === 'guide'
    || normalized === 'whitepaper'
    || normalized === 'case-study'
  ) {
    return normalized;
  }
  return 'blog';
}

function hasCompanyAudienceContext(companyContext?: string): boolean {
  const normalized = String(companyContext || '').trim().toLowerCase();
  if (normalized.length < 80) return false;
  return /\b(audience|customer|customers|buyer|buyers|client|clients|market|segment|founder|ceo|cmo|vp|director|team|teams|smb|enterprise|industry|persona|icp)\b/.test(normalized);
}

function isRedundantQuestion(question: string, companyContext?: string): boolean {
  if (!hasCompanyAudienceContext(companyContext)) return false;
  return /\b(target audience|audience for this|who is your audience|who are you targeting|industry professionals|potential customers|investors|market impact|specific aspects|features, benefits|what benefits|which audience|ideal reader|reader persona|customer segment)\b/i.test(question);
}

function getContentTypeName(contentType: CardContentType, contentLabel?: string): string {
  const label = contentLabel?.trim();
  if (label) return label;
  if (contentType === 'case-study') return 'case study';
  return contentType;
}

function getFocusedFallbackQuestion(contentType: CardContentType, contentLabel?: string): string {
  const label = getContentTypeName(contentType, contentLabel);
  switch (contentType) {
    case 'story':
      return 'Which concrete moment should anchor the story: launch day, customer reaction, team decision, or founder realization?';
    case 'newsletter':
      return 'What reader payoff should this newsletter deliver: signal, interpretation, lesson, or action?';
    case 'guide':
      return 'What practical outcome should this guide help the reader complete?';
    case 'whitepaper':
      return 'What executive decision or market argument should this whitepaper make clearer?';
    case 'article':
      return 'What editorial angle should this article take: observation, opinion, analysis, or recommendation?';
    case 'case-study':
      return 'What customer change, proof point, or before-after result should this case study center on?';
    case 'thread':
      return 'What sequence should this thread follow: problem, proof, lesson, or launch narrative?';
    case 'post':
      return 'What single point should this post make for the company audience?';
    case 'blog':
    default:
      return `What angle should this ${label} take for the company audience?`;
  }
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
  const contentType = normalizeCardContentType(params.contentType);
  const contentLabel = params.contentLabel?.trim() || contentType;
  const modeLabel = params.contentModeLabel?.trim();
  const companyName = params.companyName?.trim() || 'the company';
  const companyContext = params.companyContext?.trim();
  const existingTopics = Array.isArray(params.existingTopics) ? params.existingTopics.slice(0, 6) : [];
  const currentPhase = params.currentPhase?.trim();
  const audienceInstruction = hasCompanyAudienceContext(companyContext)
    ? 'Company context already contains audience and market signals. Infer audience, buyer, positioning, and strategic purpose from it. Do not ask the user to repeat those basics.'
    : 'If audience is not inferable from company context, ask only one concise audience question and then proceed.';
  const sharedContext = [
    `Company: ${companyName}`,
    companyContext ? `Company context: ${companyContext}` : null,
    existingTopics.length > 0 ? `Existing related topics: ${existingTopics.join(' | ')}` : null,
    currentPhase ? `Current conversation phase: ${currentPhase}` : null,
    audienceInstruction,
  ].filter(Boolean).join('\n');

  if (contentType === 'newsletter') {
    return `You are an expert newsletter strategist helping create strategic newsletter recommendation cards.

Use this company context while you guide the user:
${sharedContext}

Your role is to:
1. Understand the newsletter idea and strategic purpose
2. Guide the user toward a strong newsletter angle instead of a generic article topic
3. Shape the recommendation around newsletter thinking, recurring reader value, and a clear payoff
4. Use company context as the default source for audience, market, positioning, and point of view
5. Keep the recommendation aligned to the selected newsletter mode${modeLabel ? `: ${modeLabel}` : ''}

Important:
- Ask ONE focused question at a time. Keep responses concise and actionable.
- Do not ask the user to repeat audience, company positioning, buyer, market, or benefits when company context is available.
- If the user gives a clear newsletter idea and company context is available, generate the card instead of continuing discovery.
- If a follow-up is needed, ask only for newsletter-specific payoff, cadence, signal, or reader action.

Newsletter-specific guidance:
- Recommend newsletter-worthy ideas, not generic SEO article titles
- Optimize for point of view, signal, interpretation, structure, and reader retention
- If the selected mode is "Share a deep idea", favor contrarian insights, reframing, and memorable angles
- If the selected mode is "Break down the week", favor signals, interpretation, and pattern recognition
- If the selected mode is "Analyze a market shift", favor leverage, positioning, and strategic implications
- If the selected mode is "Teach something actionable", favor practical execution, frameworks, and immediate next steps

When the user provides enough information (idea plus audience/market inferred from company context), generate a JSON response in this format:
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
  "nextQuestion": "your one focused newsletter-specific follow-up"
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

  if (contentType === 'story') {
    return `You are an expert narrative strategist helping create strategic STORY recommendation cards for ${companyName}.

Use this company context while you guide the user:
${sharedContext}

The user is creating a story, not a blog post. A story card should turn the user's idea into a memorable narrative moment with a person, tension, turn, and lesson.

Your role is to:
1. Use company context as the source of truth for audience, positioning, market, and strategic POV
2. Turn the user's idea into a story angle anchored in a concrete moment
3. Infer audience and intent when the company context makes them clear
4. Ask at most ONE follow-up, and only if the story lacks a usable moment, person, or tension
5. Keep the experience fast; do not run a generic discovery interview

Hard rules:
- Never call the output a "blog post" or ask for "the target audience for this blog post"
- Do not ask for company audience, market, benefits, or positioning when company context is available
- If the user gives a launch, event, decision, customer situation, or transformation, generate the card immediately
- If a follow-up is unavoidable, ask for the missing story anchor only, such as: "Which moment should anchor the story: launch day, customer reaction, team decision, or founder realization?"
- The topic must be short, memorable, and story-like. Avoid prefixes like "Short Story:" and avoid duplicated wording such as "The Moment The Turning Point..."
- The reason must explain why this works as a story for ${companyName}'s audience

When you have enough information, return:
{
  "done": true,
  "card": {
    "topic": "string - short memorable story title or angle",
    "intent": "awareness|authority|conversion|retention",
    "audience": "string - inferred from company context if user did not specify",
    "reason": "string explaining the story moment, tension, turn, and why it matters for ${companyName}",
    "priority": "high|medium|low",
    "tone": "string describing the tone",
    "writingStyle": "string describing the narrative style",
    "relatedTopics": ["array", "of", "related", "story", "angles"]
  }
}

Otherwise return:
{
  "done": false,
  "nextQuestion": "your single story-specific follow-up"
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

  const longFormRole = (() => {
    switch (contentType) {
      case 'article':
        return 'editorial article strategist';
      case 'guide':
        return 'practical guide strategist';
      case 'whitepaper':
        return 'executive whitepaper strategist';
      case 'case-study':
        return 'case study strategist';
      case 'blog':
      default:
        return 'strategic blog content strategist';
    }
  })();

  const contentNoun = getContentTypeName(contentType, contentLabel);
  const typeSpecificGuidance = (() => {
    switch (contentType) {
      case 'article':
        return '- Shape an article-worthy editorial angle with a clear opinion, observation, analysis, or recommendation.';
      case 'guide':
        return '- Shape a guide-worthy practical outcome: what the reader can decide, build, audit, or improve.';
      case 'whitepaper':
        return '- Shape a whitepaper-worthy executive argument with market logic, decision criteria, and proof needs.';
      case 'case-study':
        return '- Shape a case-study-worthy proof narrative around before, intervention, after, and measurable change.';
      case 'blog':
      default:
        return '- Shape a blog-worthy angle with strategic POV, reader value, and a concrete business implication.';
    }
  })();

  return `You are an expert ${longFormRole} helping create strategic ${contentNoun} recommendation cards.

Use this company context while you guide the user:
${sharedContext}

Your role is to:
1. Understand the topic and intent the user wants to explore
2. Use company context as the source of truth for audience, buyer, market, positioning, and strategic POV
3. Guide the user toward a clear, actionable ${contentNoun} recommendation
4. Infer target audience and key messages from company context when available
5. Ensure the content aligns with their overall marketing strategy and the selected writer content type

Important:
- Ask ONE focused question at a time. Keep responses concise and actionable.
- Do not ask the user to repeat target audience, market, or positioning already present in company context.
- Do not use blog wording for non-blog content. The output is a ${contentNoun}.
- If the user gives a clear topic and company context is available, proceed to the card instead of asking generic discovery questions.
- If a follow-up is unavoidable, ask only for the missing creative or editorial angle specific to ${contentNoun}.
${typeSpecificGuidance}

When the user provides enough information (topic plus audience/market inferred from company context), generate a JSON response in this format:
{
  "done": true,
  "card": {
    "topic": "string",
    "intent": "awareness|authority|conversion|retention",
    "audience": "string - inferred from company context if user did not specify",
    "reason": "string explaining why this ${contentNoun} matters for ${companyName}",
    "priority": "high|medium|low",
    "tone": "string describing the tone (e.g., professional, conversational, educational)",
    "writingStyle": "string describing the style",
    "relatedTopics": ["array", "of", "related", "topics"]
  }
}

Otherwise respond with:
{
  "done": false,
  "nextQuestion": "your one focused ${contentNoun}-specific follow-up"
}

Always respond ONLY with valid JSON (no markdown, no extra text).`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      // Include previous conversation turns
      ...(Array.isArray(conversation)
        ? conversation.map((m: unknown) => {
            const turn = typeof m === 'object' && m !== null ? m as Record<string, unknown> : {};
            return {
              role: (turn.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
              content: String(turn.content || turn.message || ''),
            };
          })
        : []),
      // Add the current message
      { role: 'user', content: String(message) },
    ];

    // Routed through the canonical aiGateway — cost accounting, usage
    // enforcement, governor, retry/fallback and telemetry are inherited (the
    // former direct call + separate captureTokenProviderCost are gone).
    const completion = await runCompletion({
      companyId: String(companyId),
      referenceType: 'blog_card_chat',
      operation: 'blogCardChat',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages,
    });

    const raw = (completion.output ?? '').trim() || '{}';

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
      nextQuestion: parsed.nextQuestion && !isRedundantQuestion(
        parsed.nextQuestion,
        typeof metadata?.companyContext === 'string' ? metadata.companyContext : undefined,
      )
        ? parsed.nextQuestion
        : getFocusedFallbackQuestion(
          normalizeCardContentType(typeof contentType === 'string' ? contentType : undefined),
          typeof metadata?.contentLabel === 'string' ? metadata.contentLabel : undefined,
        ),
    });
  } catch (err: unknown) {
    console.error('Blog card chat failed:', err);
    return res.status(500).json({
      error: 'Failed to process blog card chat',
      details: err instanceof Error ? err.message : null,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/ai/blog-card-chat' });
