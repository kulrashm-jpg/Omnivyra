import OpenAI from 'openai';
import { z } from 'zod';
import { CompanyProfile } from './companyProfileService';
import { detectContentOverlap } from './contentOverlapService';

const contentSchema = z.object({
  headline: z.string(),
  caption: z.string(),
  hook: z.string(),
  callToAction: z.string(),
  hashtags: z.array(z.string()),
  script: z.string().optional(),
  blogDraft: z.string().optional(),
  tone: z.string(),
  trendUsed: z.string().optional(),
  reasoning: z.string(),
});

const getOpenAiClient = (): OpenAI => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey });
};

const platformTone = (platform: string): string => {
  const lower = platform.toLowerCase();
  if (lower.includes('linkedin')) return 'professional';
  if (lower.includes('instagram')) return 'emotional';
  if (lower.includes('x') || lower.includes('twitter')) return 'concise';
  if (lower.includes('youtube')) return 'scripted';
  if (lower.includes('blog')) return 'structured';
  if (lower.includes('tiktok')) return 'playful';
  return 'clear';
};

export async function generateContentForDay(input: {
  companyProfile: CompanyProfile;
  campaign: any;
  weekPlan: any;
  dayPlan: any;
  trend?: string | null;
  platform: string;
  campaignMemory?: {
    pastThemes: string[];
    pastTopics: string[];
    pastHooks: string[];
    pastTrendsUsed: string[];
    pastPlatforms: string[];
    pastContentSummaries: string[];
  };
}): Promise<z.infer<typeof contentSchema>> {
  const client = getOpenAiClient();
  const tone = platformTone(input.platform);
  const systemPrompt =
    'You are a content generation engine. Return JSON only. No prose.';
  const userPrompt = `
Generate platform-specific content based on the inputs below.
Rules:
- Respect brand_voice and target_audience.
- Align with content theme and campaign objective.
- Use trend only if relevant.
- Follow platform style.
- Return JSON with fields: headline, caption, hook, callToAction, hashtags, script?, blogDraft?, tone, trendUsed?, reasoning.

Company Profile:
${JSON.stringify(input.companyProfile, null, 2)}

Campaign:
${JSON.stringify(input.campaign, null, 2)}

Week Plan:
${JSON.stringify(input.weekPlan, null, 2)}

Day Plan:
${JSON.stringify(input.dayPlan, null, 2)}

Platform:
${input.platform}

Trend:
${input.trend ?? 'none'}

Platform Style:
${tone}
`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = contentSchema.parse(JSON.parse(raw));
  if (input.campaignMemory) {
    const overlap = await detectContentOverlap({
      companyId: input.companyProfile.company_id,
      newProposedContent: [parsed.headline, parsed.hook, parsed.caption].filter(Boolean) as string[],
      campaignMemory: input.campaignMemory,
    });
    if (overlap.similarityScore > 0.8) {
      console.log('CONTENT OVERLAP DETECTED', overlap);
      return regenerateContent({
        existingContent: parsed,
        instruction: 'Create a fresh angle not used in previous campaigns.',
        platform: input.platform,
      });
    }
  }
  return {
    ...parsed,
    tone: parsed.tone || tone,
  };
}

export async function regenerateContent(input: {
  existingContent: any;
  instruction: string;
  platform: string;
}): Promise<z.infer<typeof contentSchema>> {
  const client = getOpenAiClient();
  const systemPrompt =
    'You are a content regeneration engine. Return JSON only. No prose.';
  const userPrompt = `
Update the content below using the instruction. Return JSON with fields: headline, caption, hook, callToAction, hashtags, script?, blogDraft?, tone, trendUsed?, reasoning.
Instruction:
${input.instruction}

Platform:
${input.platform}

Existing Content:
${JSON.stringify(input.existingContent, null, 2)}
`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = contentSchema.parse(JSON.parse(raw));
  return parsed;
}
