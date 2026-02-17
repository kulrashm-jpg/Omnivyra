import OpenAI from 'openai';
import { z } from 'zod';

const CTA_TYPES = ['None', 'Soft CTA', 'Engagement CTA', 'Authority CTA', 'Direct Conversion CTA'] as const;
const KPI_FOCUS_OPTIONS = ['Reach growth', 'Engagement rate', 'Follower growth', 'Leads generated', 'Bookings'] as const;

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

/** New weekly blueprint schema - allocation-driven, no daily[] required */
const weeklyBlueprintSchemaBase = z
  .object({
    week: z.number(),
    phase_label: z.string(),
    primary_objective: z.string(),
    platform_allocation: z.record(z.string(), z.number()),
    content_type_mix: z.array(z.string()),
    cta_type: z.enum(CTA_TYPES),
    total_weekly_content_count: z.number(),
    weekly_kpi_focus: z.enum(KPI_FOCUS_OPTIONS),
    theme: z.string().optional(),
    daily: z.array(dailyPlanSchema).optional(),
  })
  .strict();

/** Blueprint schema (no refine) — refinement done manually to preserve strict output type */
const blueprintPlanSchema = z
  .object({
    weeks: z.array(weeklyBlueprintSchemaBase),
  })
  .strict();

/** Legacy weekly schema - requires daily[] */
const legacyWeeklyPlanSchema = z.object({
  week: z.number(),
  theme: z.string(),
  daily: z.array(dailyPlanSchema),
});

const legacyPlanSchema = z.object({
  weeks: z.array(legacyWeeklyPlanSchema),
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

const BLUEPRINT_SCHEMA_DESC = `
{ weeks: Array<{
  week: number,
  phase_label: string,
  primary_objective: string,
  platform_allocation: Record<string, number>,
  content_type_mix: string[],
  cta_type: "None" | "Soft CTA" | "Engagement CTA" | "Authority CTA" | "Direct Conversion CTA",
  total_weekly_content_count: number,
  weekly_kpi_focus: "Reach growth" | "Engagement rate" | "Follower growth" | "Leads generated" | "Bookings",
  theme: string
}> }

Rules:
- platform_allocation keys: use lowercase (e.g. linkedin, facebook, instagram, youtube, blog).
- platform_allocation values: numeric post/video/article counts per platform.
- total_weekly_content_count MUST equal the sum of all platform_allocation values.
- Extract phase_label from "Phase Label" (e.g. "Audience Activation", "Conversion Acceleration").
- Extract cta_type exactly as one of the 5 options.
- Extract weekly_kpi_focus exactly as one of the 5 options.
- content_type_mix: array of strings (e.g. ["1 authority post", "1 educational post"]).
- theme: REQUIRED. Concrete weekly theme—what we're doing that week given the topic (e.g. "Introduce the stress-reduction framework", "Share customer success story"). Not the phase label.
`;

export type WeeklyBlueprintWeek = {
  week: number;
  phase_label: string;
  primary_objective: string;
  platform_allocation: Record<string, number>;
  content_type_mix: string[];
  cta_type: (typeof CTA_TYPES)[number];
  total_weekly_content_count: number;
  weekly_kpi_focus: (typeof KPI_FOCUS_OPTIONS)[number];
  theme?: string;
  daily?: Array<{
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
};

export type ParsedPlan = {
  weeks: WeeklyBlueprintWeek[];
  format: 'blueprint' | 'legacy';
};

export async function parseAiPlanToWeeks(planText: string): Promise<ParsedPlan> {
  const client = getOpenAiClient();

  const system =
    'You are a campaign plan parser. Convert free-form weekly blueprint plans into structured JSON only. Extract platform allocation numbers and map to lowercase platform keys.';
  const user =
    'Convert the following campaign plan into JSON with this schema:\n' +
    BLUEPRINT_SCHEMA_DESC +
    '\nReturn JSON only. No prose.\n' +
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

  const blueprintValidation = blueprintPlanSchema.safeParse(parsed);
  if (blueprintValidation.success) {
    const weeks = blueprintValidation.data.weeks;
    const bad = weeks.find(
      (w) =>
        Object.values(w.platform_allocation).reduce((a, b) => a + b, 0) !== w.total_weekly_content_count
    );
    if (!bad) {
      // Schema output matches WeeklyBlueprintWeek at runtime; Zod's inference widens optionality
      return {
        weeks: weeks as WeeklyBlueprintWeek[],
        format: 'blueprint' as const,
      };
    }
    console.error(
      `Week ${bad.week}: platform_allocation sum must equal total_weekly_content_count (${bad.total_weekly_content_count})`
    );
  }

  const legacyValidation = legacyPlanSchema.safeParse(parsed);
  if (legacyValidation.success) {
    const weeks = legacyValidation.data.weeks.map((w) => ({
      week: w.week,
      phase_label: w.theme,
      primary_objective: '',
      platform_allocation: {} as Record<string, number>,
      content_type_mix: [] as string[],
      cta_type: 'None' as const,
      total_weekly_content_count: 0,
      weekly_kpi_focus: 'Reach growth' as const,
      theme: w.theme,
      daily: w.daily,
    }));
    return { weeks: weeks as WeeklyBlueprintWeek[], format: 'legacy' };
  }

  console.error('Structured plan schema validation failed', {
    blueprintIssues: blueprintValidation.error?.issues,
    legacyIssues: legacyValidation.error?.issues,
  });
  throw new Error('Invalid structured plan schema');
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

  return validation.data as {
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
  };
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

  return validation.data as { day: string; platforms: Record<string, string> };
}
