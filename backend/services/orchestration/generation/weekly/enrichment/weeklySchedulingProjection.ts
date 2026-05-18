/**
 * weeklySchedulingProjection — Phase-2 Step-12.
 *
 * Projection ONLY — does not redesign or invoke the scheduler. Produces
 * scheduling allocation metadata, preferred posting windows, timing
 * guidance, cadence preservation and a scheduling placeholder so the
 * authoritative row carries scheduling parity for downstream allocators.
 */

const PLATFORM_WINDOW: Record<string, { window: string; tz_note: string }> = {
  linkedin:  { window: '08:00-10:00 weekday', tz_note: 'audience-local business hours' },
  instagram: { window: '11:00-13:00 / 19:00-21:00', tz_note: 'lunch + evening' },
  x:         { window: '09:00 / 12:00 / 17:00', tz_note: 'commute + midday' },
  twitter:   { window: '09:00 / 12:00 / 17:00', tz_note: 'commute + midday' },
  facebook:  { window: '13:00-16:00', tz_note: 'afternoon' },
  youtube:   { window: '15:00-18:00 weekend-skew', tz_note: 'after-work / weekend' },
  tiktok:    { window: '18:00-22:00', tz_note: 'evening peak' },
  pinterest: { window: '20:00-23:00', tz_note: 'late evening planning' },
};

export interface SchedulingProjection {
  preferred_window: string;
  timing_guidance: string;
  cadence: { per_week: number };
  scheduling_state: 'projected_unscheduled';
  scheduling_placeholder: boolean;
  scheduling_readiness: 'ready' | 'pending_asset' | 'blocked';
  score: number;
}

export function projectScheduling(
  platform: string,
  cadencePerWeek: number,
  routing: { asset_requirement?: string; execution_type?: string } | null,
): SchedulingProjection {
  const p = String(platform || 'linkedin').toLowerCase();
  const spec = PLATFORM_WINDOW[p] ?? { window: 'audience-active hours', tz_note: 'generic' };
  const needsAsset = routing?.asset_requirement === 'REQUIRED' || routing?.execution_type === 'VIDEO_WORKFLOW';
  const readiness: SchedulingProjection['scheduling_readiness'] = needsAsset ? 'pending_asset' : 'ready';

  let score = 50;
  if (PLATFORM_WINDOW[p]) score += 30;
  if (cadencePerWeek > 0) score += 20;

  return {
    preferred_window: spec.window,
    timing_guidance: `${spec.window} (${spec.tz_note})`,
    cadence: { per_week: cadencePerWeek > 0 ? cadencePerWeek : 1 },
    scheduling_state: 'projected_unscheduled',
    scheduling_placeholder: true,
    scheduling_readiness: readiness,
    score: Math.min(100, score),
  };
}
