import { REQUIRED_EXECUTION_FIELDS } from '../../backend/constants/campaignPlanningGatherOrder';
import type { QuickPickConfig, StructuredPlan } from './types';

export const GATHER_ORDER_KEYS = new Set<string>([...REQUIRED_EXECUTION_FIELDS, 'capacity_override']);
export const ABSOLUTE_MAX_WEEKS = 12;

export type ProgressiveStyleConfig = {
  primaryOptions: string[];
  secondaryByPrimary: Record<string, string[]>;
  primaryTooltips?: Record<string, string>;
  secondaryTooltips?: Record<string, string>;
};

export const COMMUNICATION_STYLE_PRIMARY = [
  'Simple & easy',
  'Professional & expert',
  'Friendly & conversational',
  'Bold & opinionated',
  'Deep & thoughtful',
] as const;

export const COMMUNICATION_STYLE_SECONDARY_BY_PRIMARY: Record<string, string[]> = {
  'Simple & easy': ['Direct & no-fluff', 'Story-driven', 'Inspiring & motivational'],
  'Professional & expert': ['Data-driven', 'Direct & no-fluff', 'Deep & thoughtful', 'Story-driven'],
  'Friendly & conversational': ['Story-driven', 'Inspiring & motivational', 'Witty & playful'],
  'Bold & opinionated': ['Direct & no-fluff', 'Inspiring & motivational'],
  'Deep & thoughtful': ['Story-driven', 'Data-driven', 'Professional & expert'],
};

export const CTA_INTENT_PRIMARY = [
  'Awareness',
  'Engagement',
  'Community Building',
  'Lead Generation',
  'Conversion / Sales',
] as const;

export const CTA_ACTIONS_BY_INTENT: Record<string, string[]> = {
  Awareness: ['Like / react', 'Share with a friend/team', 'Save for later', 'Just understand the topic better'],
  Engagement: ['Comment with an opinion', 'Share with a friend/team', 'Like / react', 'Connect'],
  'Community Building': ['Follow / subscribe', 'Join newsletter', 'Connect', 'DM us'],
  'Lead Generation': ['Download a resource', 'Visit website', 'Join newsletter', 'DM us'],
  'Conversion / Sales': ['Book a call / demo', 'Visit website', 'DM us', 'Download a resource'],
};

export function isFinalPlanSubmissionMessage(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  if (/(create my plan|i'?m ready|i am ready|generate (my )?plan|ready to generate|build (my )?plan|submit|go ahead|generate it|yes,? generate|generate the plan)/.test(t)) return true;
  if (/^\s*(yes|ok|go)\s*$/i.test(t)) return true;
  if (/(yes,?\s*)?proceed with \d+\s*weeks?/i.test(t)) return true;
  if (/use \d+\s*weeks?\s*(instead)?/i.test(t)) return true;
  if (/^\s*\d{1,2}\s*weeks?\s*$/i.test(t)) return true;
  if (/^\s*sure\s*$/i.test(t)) return true;
  return false;
}

export function getWeeklyPlanTimingByWeeks(weeks: number): { expectedSeconds: number; maxSecondsHint: number } {
  const w = Math.min(12, Math.max(2, Math.floor(weeks)));
  if (w <= 2) return { expectedSeconds: 50, maxSecondsHint: 120 };
  if (w <= 4) return { expectedSeconds: 75, maxSecondsHint: 180 };
  if (w <= 8) return { expectedSeconds: 105, maxSecondsHint: 240 };
  return { expectedSeconds: 135, maxSecondsHint: 300 };
}

export function extractQuestionCandidate(message: string): string {
  if (!message) return '';
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const isNoiseLine = (line: string) => /^\(required missing:/i.test(line);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (isNoiseLine(line)) continue;
    if (line.includes('?')) return line;
    if (line.endsWith('?')) return line;
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isNoiseLine(lines[i])) return lines[i];
  }
  return lines[lines.length - 1] || '';
}

export function allowOnlyGatherConfig(cfg: QuickPickConfig | null): QuickPickConfig | null {
  return cfg && GATHER_ORDER_KEYS.has(cfg.key) ? cfg : null;
}

export function extractTargetDay(text: string): string | undefined {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const lower = text.toLowerCase();
  const match = days.find((day) => lower.includes(day));
  if (!match) return undefined;
  return match.charAt(0).toUpperCase() + match.slice(1);
}

export function extractPlatforms(text: string, platformExtractCandidates: string[]): string[] | undefined {
  const lower = text.toLowerCase();
  const found = platformExtractCandidates.filter((platform) => {
    if (platform === 'x') return /\bx\b/.test(lower);
    return lower.includes(platform);
  });
  if (found.length === 0) return undefined;
  return found.map((platform) => (platform === 'twitter' ? 'x' : platform));
}

export function extractScopeWeeks(message: string, totalWeeks: number): number[] | null {
  const lower = message.toLowerCase().trim();
  if (/all\s*weeks|every\s*week|entire\s*plan|whole\s*plan/i.test(lower)) return null;
  const weeks: number[] = [];
  const singleMatch = lower.match(/\bweek\s+(\d+)\b/gi);
  if (singleMatch) {
    for (const m of singleMatch) {
      const num = parseInt(m.replace(/\D/g, ''), 10);
      if (num >= 1 && num <= totalWeeks && !weeks.includes(num)) weeks.push(num);
    }
  }
  const rangeMatch = lower.match(/\bweeks?\s+(\d+)\s*(?:-|to|and|&)\s*(\d+)\b/i);
  if (rangeMatch) {
    const lo = Math.max(1, parseInt(rangeMatch[1], 10));
    const hi = Math.min(totalWeeks, parseInt(rangeMatch[2], 10));
    for (let i = lo; i <= hi; i++) if (!weeks.includes(i)) weeks.push(i);
  }
  return weeks.length > 0 ? weeks.sort((a, b) => a - b) : null;
}

export function renderPlanSummary(plan: StructuredPlan) {
  const weekCount = plan.weeks.length;
  const dayCount = plan.weeks.reduce((sum, week) => sum + (week.daily?.length ?? 0), 0);
  return `${weekCount} weeks • ${dayCount} days`;
}
