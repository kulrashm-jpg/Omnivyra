import { z } from 'zod';
import { runCompletionWithOperation } from './aiGateway';

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

const platformContentItem = z.object({
  type: z.string(),
  count: z.number(),
  topic: z.string().optional(),
  topics: z.array(z.string()).optional(),
  /** Platforms this content appears on. When length > 1, same content is shared across platforms — show under each. */
  platforms: z.array(z.string()).optional(),
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
    topics_to_cover: z.array(z.string()).optional(),
    daily: z.array(dailyPlanSchema).optional(),
    /** Per-platform breakdown: e.g. { "facebook": [{ type: "post", count: 2 }, { type: "story", count: 1 }] } — makes "facebook: 2" explicit as 2 posts, 1 story */
    platform_content_breakdown: z.record(z.string(), z.array(platformContentItem)).optional(),
    /** Per-platform topic overrides for editing: e.g. { "facebook": ["Professional neglecting personal lives"] } */
    platform_topics: z.record(z.string(), z.array(z.string())).optional(),
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

const BLUEPRINT_SCHEMA_DESC = `
{ weeks: Array<{
  week: number,
  phase_label: string,
  primary_objective: string,
  platform_allocation: Record<string, number>,
  content_type_mix: string[],
  platform_content_breakdown?: Record<string, Array<{ type: string, count: number, topics?: string[], platforms?: string[] }>>,
  cta_type: "None" | "Soft CTA" | "Engagement CTA" | "Authority CTA" | "Direct Conversion CTA",
  total_weekly_content_count: number,
  weekly_kpi_focus: "Reach growth" | "Engagement rate" | "Follower growth" | "Leads generated" | "Bookings",
  theme: string,
  topics_to_cover: string[]
}> }

Rules:
- platform_allocation keys: use lowercase (e.g. linkedin, facebook, instagram, youtube, blog).
- platform_allocation values: numeric post/video/article counts per platform.
- platform_content_breakdown: Per platform, list content with topics. Each item: { type, count, topics: ["(1) Topic for piece 1", "(2) Topic for piece 2"], platforms?: ["facebook","linkedin"] }. SHARED CONTENT: When one piece is shared across platforms (e.g. same post on Facebook+LinkedIn), include it in EACH platform's array AND set platforms: ["facebook","linkedin"] so it displays under both. topics: one topic per piece when count>1, e.g. topics: ["(1) Identifying personal challenges", "(2) Second topic"]. type = post, story, reel, video, article, carousel, thread, banner.
- total_weekly_content_count MUST equal the sum of all platform_allocation values.
- Extract phase_label from "Phase Label" (e.g. "Audience Activation", "Conversion Acceleration").
- Extract cta_type exactly as one of the 5 options.
- Extract weekly_kpi_focus exactly as one of the 5 options.
- content_type_mix: array of strings (e.g. ["1 authority post", "1 educational post"]).
- theme: REQUIRED. Concrete weekly theme.
- topics_to_cover: REQUIRED. Array of 2–5 specific topics to cover that week (e.g. ["Mindfulness basics", "Breathing techniques", "Sleep hygiene"]).
`;

export type PlatformContentItem = {
  type: string;
  count: number;
  topic?: string;
  topics?: string[];
  platforms?: string[];
};
export type WeeklyContextCapsule = {
  campaignTheme: string;
  primaryPainPoint: string;
  desiredTransformation: string;
  campaignStage: string;
  psychologicalGoal: string;
  momentum: string;
  audienceProfile: string;
  weeklyIntent: string;
  toneGuidance: string;
  successOutcome: string;
};
export type TopicContext = {
  topicTitle: string;
  topicGoal: string;
  audienceAngle: string;
  painPointFocus: string;
  transformationIntent: string;
  messagingAngle: string;
  expectedOutcome: string;
  recommendedContentTypes: string[];
  platformPriority: string[];
  writingIntent: string;
};
export type TopicContentTypeGuidance = {
  primaryFormat: string;
  maxWordTarget: number;
  platformWithHighestLimit: string;
  adaptationRequired: true;
};
export type WeeklyTopicWritingBrief = {
  topicTitle: string;
  topicContext: TopicContext;
  whoAreWeWritingFor: string;
  whatProblemAreWeAddressing: string;
  whatShouldReaderLearn: string;
  desiredAction: string;
  approximateDepth: string;
  narrativeStyle: string;
  contentTypeGuidance: TopicContentTypeGuidance;
};
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
  topics_to_cover?: string[];
  platform_content_breakdown?: Record<string, PlatformContentItem[]>;
  platform_topics?: Record<string, string[]>;
  weeklyContextCapsule?: WeeklyContextCapsule;
  topics?: WeeklyTopicWritingBrief[];
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
  /** Dynamic extras: summary, objectives, days_to_post, content_brief, etc. */
  week_extras?: Record<string, unknown>;
};

export type ParsedPlan = {
  weeks: WeeklyBlueprintWeek[];
  format: 'blueprint' | 'legacy';
};

function extractWeekNumbersLoose(planText: string): number[] {
  const weekSet = new Set<number>();
  const rx = /(?:^\s*\*{0,2}\s*Week\s*(\d+)\s*\*{0,2}\s*:?\s*$)|(?:^\s*Week\s*(\d+)\s*:)|(?:^\s*\d+\.\s*Week Number:\s*Week\s*(\d+))/gmi;
  let match: RegExpExecArray | null = null;
  while ((match = rx.exec(planText)) !== null) {
    const n = Number(match[1] || match[2] || match[3] || 0);
    if (Number.isFinite(n) && n > 0) weekSet.add(n);
  }
  return Array.from(weekSet).sort((a, b) => a - b);
}

function extractWeekBlocksLoose(planText: string): Array<{ week: number; block: string }> {
  const lines = planText.split(/\r?\n/);
  const starts: Array<{ idx: number; week: number }> = [];
  const headerRx = /^\s*(?:\*{0,2}\s*Week\s*(\d+)\s*\*{0,2}\s*:?|(?:\d+\.\s*)?Week Number:\s*Week\s*(\d+))\s*$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headerRx);
    if (!m) continue;
    const week = Number(m[1] || m[2] || 0);
    if (Number.isFinite(week) && week > 0) starts.push({ idx: i, week });
  }
  const blocks: Array<{ week: number; block: string }> = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].idx;
    const end = i + 1 < starts.length ? starts[i + 1].idx : lines.length;
    blocks.push({ week: starts[i].week, block: lines.slice(start, end).join('\n') });
  }
  return blocks;
}

function buildLooseWeeksFromText(planText: string): WeeklyBlueprintWeek[] {
  const blocks = extractWeekBlocksLoose(planText);
  const weeks: WeeklyBlueprintWeek[] = blocks.map(({ week, block }) => {
    const objective =
      block.match(/(?:Primary Strategic Objective|Primary Objective|Objective)\s*:\s*(.+)/i)?.[1]?.trim() || '';
    const theme =
      block.match(/(?:Weekly Theme|Theme)\s*:\s*(.+)/i)?.[1]?.trim() ||
      block.match(/(?:topics?\s*to\s*cover)\s*:\s*(.+)/i)?.[1]?.trim() ||
      '';
    const allocation: Record<string, number> = {};
    const allocRx = /-\s*(LinkedIn|Facebook|Instagram|YouTube|Blog|X|Twitter|TikTok)\s*:\s*(\d+)/gi;
    let allocMatch: RegExpExecArray | null = null;
    while ((allocMatch = allocRx.exec(block)) !== null) {
      const platform = String(allocMatch[1]).toLowerCase().replace('twitter', 'x');
      const count = Number(allocMatch[2]);
      if (Number.isFinite(count) && count > 0) allocation[platform] = (allocation[platform] ?? 0) + count;
    }
    const total = Object.values(allocation).reduce((a, b) => a + b, 0);
    return {
      week,
      phase_label: 'Audience Activation',
      primary_objective: objective,
      platform_allocation: allocation,
      content_type_mix: [],
      cta_type: 'None',
      total_weekly_content_count: total,
      weekly_kpi_focus: 'Reach growth',
      theme,
      topics_to_cover: theme ? [theme] : [],
    };
  });
  return weeks;
}

export async function parseAiPlanToWeeks(planText: string): Promise<ParsedPlan> {
  const system =
    'You are a campaign plan parser. Convert free-form weekly blueprint plans into structured JSON only. Extract platform allocation numbers and map to lowercase platform keys.';
  const user =
    'Convert the following campaign plan into JSON with this schema:\n' +
    BLUEPRINT_SCHEMA_DESC +
    '\nReturn JSON only. No prose.\n' +
    `Plan Text:\n${planText}`;

  const result = await runCompletionWithOperation({
    companyId: null,
    campaignId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'parsePlanToWeeks',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const raw = result.output?.trim() || '';
  const parsed = JSON.parse(raw);

  const blueprintValidation = blueprintPlanSchema.safeParse(parsed);
  if (blueprintValidation.success) {
    const weeks = blueprintValidation.data.weeks;
    const badWeeks = weeks.filter(
      (w) => Object.values(w.platform_allocation).reduce((a, b) => a + b, 0) !== w.total_weekly_content_count
    );
    if (badWeeks.length > 0) {
      console.warn('[campaign-ai][parse-debug]', {
        rawLength: planText.length,
        parserStage: 'blueprint-sum-mismatch',
        detectedWeeks: weeks.length,
        parseError: `Allocation/total mismatch in ${badWeeks.length} week(s)`,
        missingSections: [],
      });
    }
    // Tolerate numeric mismatch here; deterministic validator decides whether regeneration is required.
    return {
      weeks: weeks as WeeklyBlueprintWeek[],
      format: 'blueprint' as const,
    };
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

  const looseWeeks = buildLooseWeeksFromText(planText);
  if (looseWeeks.length > 0) {
    console.warn('[campaign-ai][parse-debug]', {
      rawLength: planText.length,
      parserStage: 'loose-week-extraction',
      detectedWeeks: looseWeeks.length,
      parseError: 'Structured schema validation failed; using loose extraction fallback.',
      missingSections: [],
    });
    return { weeks: looseWeeks, format: 'legacy' };
  }

  const normalizedWeeks = normalizeLenientWeeks(parsed);
  if (normalizedWeeks.length > 0) {
    console.warn('[campaign-ai][parse-debug]', {
      rawLength: planText.length,
      parserStage: 'lenient-normalization',
      detectedWeeks: normalizedWeeks.length,
      parseError: 'Structured schema validation failed; using lenient normalization fallback.',
      missingSections: [],
    });
    return { weeks: normalizedWeeks, format: 'blueprint' as const };
  }

  const detectedWeekHeaders = extractWeekNumbersLoose(planText).length;

  console.error('Structured plan schema validation failed', {
    blueprintIssues: blueprintValidation.error?.issues,
    legacyIssues: legacyValidation.error?.issues,
  });
  console.warn('[campaign-ai][parse-debug]', {
    rawLength: planText.length,
    parserStage: 'schema-failed-zero-weeks',
    detectedWeeks: detectedWeekHeaders,
    parseError: 'Invalid structured plan schema',
    missingSections: detectedWeekHeaders === 0 ? ['week headers'] : [],
  });
  throw new Error('Invalid structured plan schema');
}

function normalizeLenientWeeks(parsed: unknown): WeeklyBlueprintWeek[] {
  const ctaSet = new Set(CTA_TYPES);
  const kpiSet = new Set(KPI_FOCUS_OPTIONS);
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  const planObj = obj.plan && typeof obj.plan === 'object' && !Array.isArray(obj.plan) ? (obj.plan as Record<string, unknown>) : null;
  const rawWeeks = obj.weeks ?? obj.Weeks ?? planObj?.weeks;
  if (!Array.isArray(rawWeeks) || rawWeeks.length === 0) return [];
  const weeks: WeeklyBlueprintWeek[] = [];
  for (let i = 0; i < rawWeeks.length; i++) {
    const w = rawWeeks[i];
    if (w == null || typeof w !== 'object' || Array.isArray(w)) continue;
    const row = w as Record<string, unknown>;
    const weekNum = typeof row.week === 'number' ? row.week : typeof row.week_number === 'number' ? row.week_number : i + 1;
    const theme =
      String(row.theme ?? row.phase_label ?? row.phaseLabel ?? row.weekly_theme ?? '').trim() ||
      `Week ${weekNum}`;
    const phaseLabel = String(row.phase_label ?? row.phaseLabel ?? theme).trim() || 'Audience Activation';
    const primaryObjective = String(row.primary_objective ?? row.primaryObjective ?? row.objective ?? '').trim();
    let platformAlloc: Record<string, number> = {};
    if (row.platform_allocation != null && typeof row.platform_allocation === 'object' && !Array.isArray(row.platform_allocation)) {
      platformAlloc = Object.fromEntries(
        Object.entries(row.platform_allocation as Record<string, unknown>).filter(
          ([, v]) => typeof v === 'number' && Number.isFinite(v)
        ) as [string, number][]
      );
    }
    const contentMix = Array.isArray(row.content_type_mix)
      ? (row.content_type_mix as unknown[]).map(String).filter(Boolean)
      : Array.isArray(row.contentTypeMix)
        ? (row.contentTypeMix as unknown[]).map(String).filter(Boolean)
        : ['post'];
    const ctaRaw = String(row.cta_type ?? row.ctaType ?? 'None').trim();
    const ctaType = ctaSet.has(ctaRaw as (typeof CTA_TYPES)[number])
      ? (ctaRaw as (typeof CTA_TYPES)[number])
      : 'None';
    const allocSum = Object.values(platformAlloc).reduce((a, b) => a + b, 0);
    const totalCount = typeof row.total_weekly_content_count === 'number'
      ? row.total_weekly_content_count
      : typeof row.totalWeeklyContentCount === 'number'
        ? row.totalWeeklyContentCount
        : allocSum || contentMix.length;
    const kpiRaw = String(row.weekly_kpi_focus ?? row.weeklyKpiFocus ?? 'Reach growth').trim();
    const weeklyKpi = kpiSet.has(kpiRaw as (typeof KPI_FOCUS_OPTIONS)[number])
      ? (kpiRaw as (typeof KPI_FOCUS_OPTIONS)[number])
      : 'Reach growth';
    weeks.push({
      week: weekNum,
      phase_label: phaseLabel,
      primary_objective: primaryObjective,
      platform_allocation: Object.keys(platformAlloc).length > 0 ? platformAlloc : { linkedin: Math.max(1, totalCount) },
      content_type_mix: contentMix.length > 0 ? contentMix : ['post'],
      cta_type: ctaType,
      total_weekly_content_count: totalCount,
      weekly_kpi_focus: weeklyKpi,
      theme,
      topics_to_cover: Array.isArray(row.topics_to_cover)
        ? (row.topics_to_cover as unknown[]).map(String).filter(Boolean)
        : Array.isArray(row.topicsToCover)
          ? (row.topicsToCover as unknown[]).map(String).filter(Boolean)
          : theme ? [theme] : [],
    });
  }
  return weeks;
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
  const system =
    'You are a campaign plan parser. Convert free-form day refinements into structured JSON only.';
  const user =
    'Convert the following day refinement into JSON with this schema:\n' +
    '{ week: number, day: string, objective: string, content: string, platforms: Record<string, string>, hashtags?: string[], seo_keywords?: string[], meta_title?: string, meta_description?: string, hook?: string, cta?: string, best_time?: string, effort_score?: number, success_projection?: number }\n' +
    'Return JSON only. No prose.\n' +
    `Plan Text:\n${planText}`;

  const result = await runCompletionWithOperation({
    companyId: null,
    campaignId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'parseRefinedDay',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const raw = result.output?.trim() || '';
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
  const system =
    'You are a campaign plan parser. Convert platform customizations into structured JSON only.';
  const user =
    'Convert the following platform customization into JSON with this schema:\n' +
    '{ day: string, platforms: Record<string, string> }\n' +
    'Return JSON only. No prose.\n' +
    `Plan Text:\n${planText}`;

  const result = await runCompletionWithOperation({
    companyId: null,
    campaignId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'parsePlatformCustomization',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const raw = result.output?.trim() || '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw new Error('Invalid platform customization schema: AI response was not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object') {
    parsed = {};
  }
  const obj = parsed as Record<string, unknown>;
  // Normalize: AI may return Day/platforms (capitalized) or nested structure
  const day = obj.day ?? obj.Day ?? (typeof obj.dayName === 'string' ? obj.dayName : '');
  const platformsRaw = obj.platforms ?? obj.Platforms ?? obj.platform_content ?? {};
  const platforms: Record<string, string> =
    typeof platformsRaw === 'object' && platformsRaw !== null
      ? Object.fromEntries(
          Object.entries(platformsRaw).filter(
            ([, v]) => v != null && typeof v === 'string'
          ) as [string, string][]
        )
      : {};
  const normalized = { day: String(day || 'Unknown'), platforms };
  const validation = platformCustomizationSchema.safeParse(normalized);
  if (!validation.success) {
    console.error('Platform customization schema validation failed', {
      issues: validation.error.issues,
      parsed,
      normalized,
    });
    throw new Error('Invalid platform customization schema');
  }

  return validation.data as { day: string; platforms: Record<string, string> };
}
