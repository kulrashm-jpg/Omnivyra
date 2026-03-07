/**
 * Content Distribution Intelligence — Phase 5 + 6 (shared lib)
 *
 * Evaluates weekly activity plans and produces distribution insights.
 * Phase 6: suboptimal day, holiday awareness.
 */

import { buildWeeklyActivitiesFromExecutionItems } from './weeklyActivityAdapter';
import type { WeeklyActivity } from './weeklyActivityAdapter';

export interface DistributionInsight {
  type: string;
  severity: 'info' | 'warning';
  message: string;
  recommendation?: string;
}

export interface AnalyzeWeeklyDistributionOptions {
  campaignStartDate?: string | null;
  region?: string | string[];
  weekNumber?: number;
}

type WeekPlan = Record<string, unknown>;

const PLATFORM_FREQUENCY_LIMITS: Record<string, number> = {
  linkedin: 5,
  twitter: 10,
  x: 10,
  default: 15,
};

const CONTENT_TYPE_FREQUENCY_LIMITS: Record<string, number> = {
  blog: 3,
};

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'Twitter',
  x: 'Twitter',
  blog: 'Blog',
};

function normalizePlatform(p: string): string {
  const s = String(p ?? '').trim().toLowerCase();
  return s === 'x' ? 'twitter' : s;
}

function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

function getPlatformBestDays(platform: string): string[] {
  const bestDays: Record<string, string[]> = {
    linkedin: ['Tue', 'Wed', 'Thu'],
    twitter: ['Tue', 'Wed', 'Thu', 'Fri'],
    x: ['Tue', 'Wed', 'Thu', 'Fri'],
    blog: ['Wed', 'Fri'],
    youtube: ['Thu', 'Fri', 'Sat'],
    default: ['Tue', 'Wed', 'Thu'],
  };
  const key = normalizePlatform(platform);
  return bestDays[key] ?? bestDays.default;
}

const DAY_NUM_TO_NAME: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

/**
 * Analyze weekly distribution and return insights.
 * Returns empty array if no issues detected.
 * Phase 6: pass options for holiday and suboptimal-day checks.
 */
export function analyzeWeeklyDistribution(
  weekPlan: WeekPlan | null | undefined,
  options?: AnalyzeWeeklyDistributionOptions
): DistributionInsight[] {
  const activities = buildWeeklyActivitiesFromExecutionItems(weekPlan);
  if (activities.length === 0) return [];

  const insights: DistributionInsight[] = [];

  const byPlatform = new Map<string, number>();
  for (const a of activities) {
    const p = normalizePlatform(a.platform);
    byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1);
  }
  for (const [platform, count] of byPlatform) {
    const limit = PLATFORM_FREQUENCY_LIMITS[platform] ?? PLATFORM_FREQUENCY_LIMITS.default;
    if (count > limit) {
      insights.push({
        type: 'frequency_risk',
        severity: 'warning',
        message: `${getPlatformLabel(platform)} posting frequency is high (${count} posts/week).`,
        recommendation: `Consider reducing ${getPlatformLabel(platform)} posts to ${Math.max(1, limit - 2)}-${limit} per week.`,
      });
    }
  }

  const byContentType = new Map<string, number>();
  for (const a of activities) {
    const ct = a.content_type === 'post' || a.content_type === 'document' ? 'post' : a.content_type;
    byContentType.set(ct, (byContentType.get(ct) ?? 0) + 1);
  }
  const total = activities.length;
  for (const [ct, count] of byContentType) {
    const limit = CONTENT_TYPE_FREQUENCY_LIMITS[ct];
    if (limit != null && count > limit) {
      insights.push({
        type: 'frequency_risk',
        severity: 'warning',
        message: `${ct.charAt(0).toUpperCase() + ct.slice(1)} content frequency is high (${count}/week).`,
        recommendation: `Consider reducing to ${limit} or fewer per week.`,
      });
    }
  }
  const postCount = byContentType.get('post') ?? 0;
  const postPct = total > 0 ? (postCount / total) * 100 : 0;
  if (postPct > 80) {
    insights.push({
      type: 'content_type_imbalance',
      severity: 'warning',
      message: 'Your plan relies heavily on short-form posts.',
      recommendation: 'Consider adding long-form or carousel content.',
    });
  }

  const platformCounts = Array.from(byPlatform.entries())
    .map(([p, c]) => ({ platform: p, count: c }))
    .sort((a, b) => b.count - a.count);
  const topCount = platformCounts[0]?.count ?? 0;
  const topPct = total > 0 ? (topCount / total) * 100 : 0;
  if (topPct > 80 && platformCounts.length > 0) {
    insights.push({
      type: 'platform_concentration',
      severity: 'warning',
      message: 'Your campaign is concentrated on one platform.',
      recommendation: `Consider diversifying beyond ${getPlatformLabel(platformCounts[0]!.platform)}.`,
    });
  }

  if (total > 15) {
    insights.push({
      type: 'publishing_intensity',
      severity: 'warning',
      message: `Total weekly outputs (${total}) may be high.`,
      recommendation: 'Consider reducing to 15 or fewer outputs per week for sustainable execution.',
    });
  }

  const byTopic = new Map<string, WeeklyActivity[]>();
  for (const a of activities) {
    if ((a.repurpose_total ?? 1) > 1) {
      const tc = a.topic_code;
      const arr = byTopic.get(tc) ?? [];
      arr.push(a);
      byTopic.set(tc, arr);
    }
  }
  for (const [, topicActivities] of byTopic) {
    const sorted = [...topicActivities].sort((a, b) => a.scheduled_day - b.scheduled_day);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const curr = sorted[i]!;
      const next = sorted[i + 1]!;
      const gap = next.scheduled_day - curr.scheduled_day;
      if (gap < 2) {
        insights.push({
          type: 'repurpose_cluster',
          severity: 'info',
          message: `Topic ${curr.topic_code} has items on adjacent days (${curr.content_code} and ${next.content_code}).`,
          recommendation: 'Consider spacing repurposed content by at least one day for better audience fatigue management.',
        });
        break;
      }
    }
  }

  const opt = options ?? {};

  const suboptimalByPlatform = new Map<string, { dayName: string; codes: string[] }>();
  for (const a of activities) {
    const best = getPlatformBestDays(a.platform);
    const dayName = DAY_NUM_TO_NAME[a.scheduled_day] ?? '';
    if (dayName && best.length > 0 && !best.includes(dayName)) {
      const key = normalizePlatform(a.platform);
      const existing = suboptimalByPlatform.get(key);
      if (existing) {
        existing.codes.push(a.content_code);
      } else {
        suboptimalByPlatform.set(key, { dayName, codes: [a.content_code] });
      }
    }
  }
  for (const [platform, { dayName, codes }] of suboptimalByPlatform) {
    const label = getPlatformLabel(platform);
    insights.push({
      type: 'suboptimal_day',
      severity: 'info',
      message: `${label} post${codes.length > 1 ? 's' : ''} scheduled on ${dayName}${codes.length > 1 ? ` (${codes.join(', ')})` : ` (${codes[0]})`}.`,
      recommendation: `${label} posts typically perform better on ${getPlatformBestDays(platform).join('-')}.`,
    });
  }

  const regions = Array.isArray(opt.region)
    ? opt.region.map((r) => String(r ?? '').trim().toLowerCase()).filter(Boolean)
    : opt.region
      ? [String(opt.region).trim().toLowerCase()]
      : [];
  const campaignStart = typeof opt.campaignStartDate === 'string' && opt.campaignStartDate.trim()
    ? opt.campaignStartDate.trim().split('T')[0]
    : null;
  const weekNum = Number(opt.weekNumber);
  if (
    regions.length > 0 &&
    campaignStart &&
    Number.isFinite(weekNum) &&
    weekNum >= 1
  ) {
    try {
      const startDate = new Date(campaignStart + 'T12:00:00');
      const dayOffsets = activities.map((a) => ({
        activity: a,
        dayOffset: (weekNum - 1) * 7 + (a.scheduled_day - 1),
      }));
      const holidayByDate = new Map<string, { name: string; codes: string[] }>();
      for (const { activity, dayOffset } of dayOffsets) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + dayOffset);
        const dateStr = d.toISOString().slice(0, 10);
        const holiday = isDateHolidayInRegions(dateStr, regions);
        if (holiday) {
          const existing = holidayByDate.get(dateStr);
          if (existing) {
            existing.codes.push(activity.content_code);
          } else {
            holidayByDate.set(dateStr, { name: holiday.name, codes: [activity.content_code] });
          }
        }
      }
      for (const [, { name, codes }] of holidayByDate) {
        insights.push({
          type: 'holiday',
          severity: 'info',
          message: `Scheduled post${codes.length > 1 ? 's' : ''} (${codes.join(', ')}) ${codes.length > 1 ? 'fall' : 'falls'} on ${name}.`,
          recommendation: 'Consider adjusting messaging or schedule for regional relevance.',
        });
      }
    } catch {
      // ignore date parse errors
    }
  }

  return insights;
}

function isDateHolidayInRegions(
  dateStr: string,
  regions: string[]
): { date: string; name: string } | null {
  const HOLIDAYS: Record<string, Array<{ date: string; name: string }>> = {
    india: [
      { date: '2025-01-26', name: 'Republic Day' },
      { date: '2025-10-24', name: 'Diwali' },
      { date: '2026-01-26', name: 'Republic Day' },
      { date: '2026-11-12', name: 'Diwali' },
    ],
    usa: [
      { date: '2025-07-04', name: 'Independence Day' },
      { date: '2025-12-25', name: 'Christmas' },
      { date: '2026-07-04', name: 'Independence Day' },
      { date: '2026-12-25', name: 'Christmas' },
    ],
    uk: [
      { date: '2025-12-25', name: 'Christmas Day' },
      { date: '2025-12-26', name: 'Boxing Day' },
      { date: '2026-12-25', name: 'Christmas Day' },
    ],
  };
  for (const r of regions) {
    const entries = HOLIDAYS[r] ?? [];
    const match = entries.find((h) => h.date === dateStr);
    if (match) return match;
  }
  return null;
}
