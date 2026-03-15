/**
 * Planner Command Extractor
 * Uses LLM to extract structured planner commands from natural language.
 * Returns { planner_commands: PlannerCommand[] } for applyPlannerCommands.
 */

import { runCompletionWithOperation } from './aiGateway';
import type { PlannerCommand, PlannerCommandResponse } from '../types/plannerCommands';
import type { PlannerCalendarPlan } from './plannerCommandInterpreter';

function summarizePlanForPrompt(plan: PlannerCalendarPlan): string {
  const activities = plan.activities ?? [];
  if (activities.length === 0) return 'No activities yet.';
  const byPlatform = new Map<string, Map<string, number>>();
  for (const a of activities) {
    const p = (a.platform ?? 'unknown').toLowerCase();
    const ct = (a.content_type ?? 'post').toLowerCase();
    if (!byPlatform.has(p)) byPlatform.set(p, new Map());
    const ctMap = byPlatform.get(p)!;
    ctMap.set(ct, (ctMap.get(ct) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const [platform, ctMap] of byPlatform) {
    const parts = Array.from(ctMap.entries()).map(([ct, n]) => `${ct}:${n}`);
    lines.push(`- ${platform}: ${parts.join(', ')}`);
  }
  const days = new Set(activities.map((a) => a.day ?? 'unknown').filter(Boolean));
  return `Current plan:\n${lines.join('\n')}\nDays used: ${Array.from(days).sort().join(', ')}`;
}

const SYSTEM_PROMPT = `You extract structured planner commands from user messages about a campaign calendar.

Output ONLY valid JSON in this exact format:
{ "planner_commands": [ ... ] }

Allowed command actions:
1. add_activity: { "action": "add_activity", "platform": "linkedin", "content_type": "carousel", "day": "friday", "frequency": 1 }
2. remove_platform: { "action": "remove_platform", "platform": "twitter" }
3. change_frequency: { "action": "change_frequency", "platform": "linkedin", "content_type": "post", "frequency": 4 }
4. move_activity: { "action": "move_activity", "platform": "youtube", "content_type": "video", "day": "thursday" }
5. delete_activity: { "action": "delete_activity", "execution_id": "wk1-linkedin-post-1" } (only when user explicitly targets a specific activity)

Platforms: linkedin, youtube, twitter (or x), instagram, facebook, tiktok, blog, reddit.
Content types: post, video, carousel, story, reel, thread, article, short.
Days: monday, tuesday, wednesday, thursday, friday, saturday, sunday.

If the user's message cannot be interpreted as planner commands, return { "planner_commands": [] }.
Extract only what the user explicitly asked for. One command per distinct change.`;

/**
 * Extract planner commands from user message using LLM.
 */
export async function extractPlannerCommands(
  message: string,
  calendar_plan: PlannerCalendarPlan,
  companyId?: string | null
): Promise<PlannerCommand[]> {
  const summary = summarizePlanForPrompt(calendar_plan);
  const userContent = `User message: "${message}"\n\n${summary}`;

  const result = await runCompletionWithOperation({
    companyId: companyId ?? null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    operation: 'extractPlannerCommands',
  });

  let parsed: PlannerCommandResponse;
  try {
    const raw = (result.output ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    parsed = JSON.parse(raw || '{}') as PlannerCommandResponse;
  } catch {
    return [];
  }

  const commands = Array.isArray(parsed?.planner_commands) ? parsed.planner_commands : [];
  return commands.filter(isValidPlannerCommand);
}

function isValidPlannerCommand(c: unknown): c is PlannerCommand {
  if (!c || typeof c !== 'object') return false;
  const a = (c as { action?: string }).action;
  if (a === 'add_activity') {
    const x = c as { platform?: string; content_type?: string };
    return typeof x.platform === 'string' && typeof x.content_type === 'string';
  }
  if (a === 'remove_platform') {
    return typeof (c as { platform?: string }).platform === 'string';
  }
  if (a === 'change_frequency') {
    const x = c as { platform?: string; content_type?: string; frequency?: number };
    return typeof x.platform === 'string' && typeof x.content_type === 'string' && typeof x.frequency === 'number';
  }
  if (a === 'move_activity') {
    const x = c as { platform?: string; content_type?: string; day?: string };
    return typeof x.platform === 'string' && typeof x.content_type === 'string' && typeof x.day === 'string';
  }
  if (a === 'delete_activity') {
    return typeof (c as { execution_id?: string }).execution_id === 'string';
  }
  return false;
}
