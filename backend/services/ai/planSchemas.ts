import { z } from 'zod';
import { DecisionResult } from '../omnivyreClient';

const decisionResultSchema: z.ZodType<DecisionResult> = z.object({
  status: z.enum(['ok', 'error']),
  decision_id: z.string().optional(),
  recommendation: z.string().optional(),
  raw: z.any().optional(),
  error: z
    .object({
      message: z.string(),
      status: z.number().optional(),
    })
    .optional(),
});

const dailyPlanSchema = z.object({
  day: z.string(),
  objective: z.string(),
  content: z.string(),
  platforms: z.record(z.string()),
});

const weeklyPlanSchema = z.object({
  week: z.number(),
  theme: z.string(),
  daily: z.array(dailyPlanSchema),
});

export const campaignPlanResponseSchema = z.object({
  mode: z.enum(['generate_plan', 'refine_day', 'platform_customize']),
  snapshot_hash: z.string(),
  omnivyre_decision: decisionResultSchema,
  plan: z.object({
    weeks: z.array(weeklyPlanSchema),
  }),
});

export type CampaignPlanResponse = z.infer<typeof campaignPlanResponseSchema>;
