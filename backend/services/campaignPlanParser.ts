import OpenAI from 'openai';
import { z } from 'zod';

const dailyPlanSchema = z.object({
  day: z.string(),
  objective: z.string(),
  content: z.string(),
  platforms: z.record(z.string()),
  hashtags: z.array(z.string()).optional(),
  seo_keywords: z.array(z.string()).optional(),
  meta_title: z.string().optional(),
  meta_description: z.string().optional(),
  hook: z.string().optional(),
  cta: z.string().optional(),
  best_time: z.string().optional(),
  effort_score: z.number().optional(),
  success_projection: z.number().optional(),
});

const weeklyPlanSchema = z.object({
  week: z.number(),
  theme: z.string(),
  daily: z.array(dailyPlanSchema),
});

const planSchema = z.object({
  weeks: z.array(weeklyPlanSchema),
});

const refinedDaySchema = z.object({
  week: z.number(),
  day: z.string(),
  objective: z.string(),
  content: z.string(),
  platforms: z.record(z.string()),
  hashtags: z.array(z.string()).optional(),
  seo_keywords: z.array(z.string()).optional(),
  meta_title: z.string().optional(),
  meta_description: z.string().optional(),
  hook: z.string().optional(),
  cta: z.string().optional(),
  best_time: z.string().optional(),
  effort_score: z.number().optional(),
  success_projection: z.number().optional(),
});

const platformCustomizationSchema = z.object({
  day: z.string(),
  platforms: z.record(z.string()),
});

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey });
}

export async function parseAiPlanToWeeks(planText: string): Promise<{
  weeks: Array<{
    week: number;
    theme: string;
    daily: Array<{
      day: string;
      objective: string;
      content: string;
      platforms: Record<string, string>;
      hashtags?: string[];
      seo_keywords?: string[];
      meta_title?: string;
      meta_description?: string;
      hook?: string;
      cta?: string;
      best_time?: string;
      effort_score?: number;
      success_projection?: number;
    }>;
  }>;
}> {
  const client = getOpenAiClient();

  const system =
    'You are a campaign plan parser. Convert free-form campaign plans into structured JSON only.';
  const user =
    'Convert the following campaign plan into JSON with this schema:\n' +
    '{ weeks: Array<{ week: number, theme: string, daily: Array<{ day: string, objective: string, content: string, platforms: Record<string, string>, hashtags?: string[], seo_keywords?: string[], meta_title?: string, meta_description?: string, hook?: string, cta?: string, best_time?: string, effort_score?: number, success_projection?: number }> }> }\n' +
    'Return JSON only. No prose.\n' +
    `Plan Text:\n${planText}`;

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '';
  const parsed = JSON.parse(raw);
  const validation = planSchema.safeParse(parsed);
  if (!validation.success) {
    console.error('Structured plan schema validation failed', {
      issues: validation.error.issues,
    });
    throw new Error('Invalid structured plan schema');
  }

  return validation.data;
}

export async function parseAiRefinedDay(planText: string): Promise<{
  week: number;
  day: string;
  objective: string;
  content: string;
  platforms: Record<string, string>;
  hashtags?: string[];
  seo_keywords?: string[];
  meta_title?: string;
  meta_description?: string;
  hook?: string;
  cta?: string;
  best_time?: string;
  effort_score?: number;
  success_projection?: number;
}> {
  const client = getOpenAiClient();

  const system =
    'You are a campaign plan parser. Convert free-form day refinements into structured JSON only.';
  const user =
    'Convert the following day refinement into JSON with this schema:\n' +
    '{ week: number, day: string, objective: string, content: string, platforms: Record<string, string>, hashtags?: string[], seo_keywords?: string[], meta_title?: string, meta_description?: string, hook?: string, cta?: string, best_time?: string, effort_score?: number, success_projection?: number }\n' +
    'Return JSON only. No prose.\n' +
    `Plan Text:\n${planText}`;

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '';
  const parsed = JSON.parse(raw);
  const validation = refinedDaySchema.safeParse(parsed);
  if (!validation.success) {
    console.error('Refined day schema validation failed', {
      issues: validation.error.issues,
    });
    throw new Error('Invalid refined day schema');
  }

  return validation.data;
}

export async function parseAiPlatformCustomization(planText: string): Promise<{
  day: string;
  platforms: Record<string, string>;
}> {
  const client = getOpenAiClient();

  const system =
    'You are a campaign plan parser. Convert platform customizations into structured JSON only.';
  const user =
    'Convert the following platform customization into JSON with this schema:\n' +
    '{ day: string, platforms: Record<string, string> }\n' +
    'Return JSON only. No prose.\n' +
    `Plan Text:\n${planText}`;

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '';
  const parsed = JSON.parse(raw);
  const validation = platformCustomizationSchema.safeParse(parsed);
  if (!validation.success) {
    console.error('Platform customization schema validation failed', {
      issues: validation.error.issues,
    });
    throw new Error('Invalid platform customization schema');
  }

  return validation.data;
}
