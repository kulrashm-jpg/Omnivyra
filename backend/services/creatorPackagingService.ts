import { runCompletionWithOperation } from './aiGateway';

export type CreatorPackagingVariant = {
  caption: string;
  hashtags: string[];
  cta?: string;
  meta_description?: string;
  keywords?: string[];
};

export type CreatorPackaging = {
  caption: string;
  hashtags: string[];
  meta_description: string;
  keywords: string[];
  cta: string;
};

function fallbackTags(topic: string, platforms: string[]): string[] {
  const base = topic
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((word) => word.length > 2)
    .slice(0, 5)
    .map((word) => `#${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  const extras = platforms.slice(0, 2).map((platform) => `#${platform.replace(/[^a-z0-9]/gi, '')}`);
  return [...new Set([...base, ...extras])].slice(0, 8);
}

function fallbackCaption(topic: string, objective?: string): string {
  const safeTopic = topic || 'this campaign moment';
  const safeObjective = objective?.trim() ? ` ${objective.trim()}` : '';
  return `A creator-led take on ${safeTopic}.${safeObjective}`.trim();
}

export async function generateCreatorMarketingPackaging(input: {
  topic: string;
  objective?: string;
  summary?: string;
  targetAudience?: string;
  assetType: string;
  campaignContext?: Record<string, unknown>;
  blueprint?: Record<string, unknown>;
}): Promise<CreatorPackaging> {
  const {
    topic,
    objective,
    summary,
    targetAudience,
    assetType,
    campaignContext,
    blueprint,
  } = input;

  const prompt = `You are generating creator packaging for a campaign asset.

Topic: ${topic}
Asset Type: ${assetType}
Objective: ${objective ?? ''}
Summary: ${summary ?? ''}
Target Audience: ${targetAudience ?? ''}
Campaign Context: ${JSON.stringify(campaignContext ?? {})}
Blueprint Summary: ${JSON.stringify(blueprint ?? {})}

Return valid JSON only:
{
  "caption": "primary cross-platform caption",
  "hashtags": ["#tag"],
  "meta_description": "150-160 chars",
  "keywords": ["keyword"],
  "cta": "short CTA"
}

Rules:
- Generate packaging from asset intent and blueprint, not from a long-form article.
- Keep the packaging generic; platform adaptation happens later.
- hashtags should already include #.
- Return JSON only.`;

  try {
    const result = await runCompletionWithOperation({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      operation: 'creator_marketing_packaging',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You create creator campaign packaging. Respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const raw = String(result?.output || '').trim();
    const parsed = JSON.parse(raw) as Record<string, any>;

    return {
      caption: String(parsed.caption || fallbackCaption(topic, objective)),
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : fallbackTags(topic, []),
      meta_description: String(parsed.meta_description || summary || fallbackCaption(topic, objective)),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
      cta: String(parsed.cta || 'Learn more'),
    };
  } catch {
    const hashtags = fallbackTags(topic, []);
    const caption = fallbackCaption(topic, objective);
    return {
      caption,
      hashtags,
      meta_description: summary || caption,
      keywords: topic.split(/\s+/).map((word) => word.trim()).filter(Boolean).slice(0, 6),
      cta: 'Learn more',
    };
  }
}
