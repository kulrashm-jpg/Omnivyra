// Pure utility helpers for Campaign Details — no React state dependencies
import { PLATFORM_LABELS } from '../../lib/shared/platforms';
import { truncateMeaningfulTitle } from '../../lib/ui/truncateMeaningfulTitle';
import type { GateResponse, DiagnosticSummary } from './types';

export function displayWeeklyTitle(value: string | undefined | null, fallback = 'Untitled Topic'): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return truncateMeaningfulTitle(raw);
}

export function buildCampaignDetailsUrl(campaignId: string, companyId: string, focus?: string): string {
  const params = new URLSearchParams();
  if (companyId) params.set('companyId', companyId);
  if (focus) params.set('focus', focus);
  return `/campaign-details/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
}

export function buildCampaignCalendarUrl(campaignId: string, companyId: string, weekNumber?: number, day?: string): string {
  const params = new URLSearchParams();
  if (companyId) params.set('companyId', companyId);
  if (Number.isFinite(weekNumber) && Number(weekNumber) > 0) params.set('week', String(weekNumber));
  if (day) params.set('day', day);
  return `/campaign-calendar/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
}

export function getWeekDatesFromCampaignStart(weekNumber: number, campaignStartDate?: string | null) {
  const startDateRaw = String(campaignStartDate || '').trim();
  const baseDate = startDateRaw ? new Date(startDateRaw) : new Date();
  const safeBase = Number.isFinite(baseDate.getTime()) ? baseDate : new Date();
  const weekStart = new Date(safeBase);
  weekStart.setDate(safeBase.getDate() + (Math.max(1, weekNumber) - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return {
    start: weekStart.toISOString().split('T')[0],
    end: weekEnd.toISOString().split('T')[0],
    startFormatted: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    endFormatted: weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
}

export function formatPlatformLabel(platform: unknown): string {
  const key = String(platform ?? '').trim().toLowerCase();
  if (!key) return '';
  return PLATFORM_LABELS[key as keyof typeof PLATFORM_LABELS] || key.charAt(0).toUpperCase() + key.slice(1);
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-800';
    case 'in_progress': return 'bg-blue-100 text-blue-800';
    case 'planned': return 'bg-yellow-100 text-yellow-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

export function getStageColor(stage: string): string {
  const m: Record<string, string> = {
    planning: 'bg-blue-100 text-blue-800',
    week_plan: 'bg-indigo-100 text-indigo-800',
    campaign_week_plan: 'bg-indigo-100 text-indigo-800',
    daily_plan: 'bg-amber-100 text-amber-800',
    charting: 'bg-green-100 text-green-800',
    schedule: 'bg-green-100 text-green-800',
  };
  return m[stage] ?? 'bg-gray-100 text-gray-800';
}

export function getStageLabel(stage: string, durationWeeks?: number | null): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getStageLabelWithDuration } = require('../../lib/shared/CampaignStage');
  return getStageLabelWithDuration(stage, durationWeeks);
}

export function getPhaseColor(phase: string): string {
  switch (phase) {
    case 'Foundation': return 'from-blue-500 to-cyan-600';
    case 'Growth': return 'from-green-500 to-emerald-600';
    case 'Consolidation': return 'from-purple-500 to-violet-600';
    case 'Sustain': return 'from-orange-500 to-red-600';
    default: return 'from-gray-500 to-slate-600';
  }
}

export function getActivityColorClasses(contentType?: string): { card: string; badge: string } {
  const t = String(contentType || '').toLowerCase();
  if (t.includes('video') || t.includes('reel') || t.includes('short')) {
    return { card: 'border-red-200 bg-red-50/60', badge: 'bg-red-100 text-red-700 border-red-200' };
  }
  if (t.includes('image') || t.includes('photo')) {
    return { card: 'border-sky-200 bg-sky-50/60', badge: 'bg-sky-100 text-sky-700 border-sky-200' };
  }
  if (t.includes('carousel')) {
    return { card: 'border-fuchsia-200 bg-fuchsia-50/60', badge: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' };
  }
  if (t.includes('blog') || t.includes('article')) {
    return { card: 'border-blue-200 bg-blue-50/60', badge: 'bg-blue-100 text-blue-700 border-blue-200' };
  }
  if (t.includes('story') || t.includes('thread')) {
    return { card: 'border-amber-200 bg-amber-50/60', badge: 'bg-amber-100 text-amber-700 border-amber-200' };
  }
  return { card: 'border-emerald-200 bg-emerald-50/60', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
}

export function isVisualContentType(contentType?: string): boolean {
  const t = String(contentType || '').toLowerCase();
  return t.includes('video') || t.includes('reel') || t.includes('short') || t.includes('image') || t.includes('photo');
}

export function getGateBadgeColor(decision?: GateResponse['gate_decision']): string {
  switch (decision) {
    case 'pass': return 'bg-green-100 text-green-800';
    case 'warn': return 'bg-amber-100 text-amber-800';
    case 'block': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

export function getGateLabel(decision?: GateResponse['gate_decision']): string {
  switch (decision) {
    case 'warn': return 'Gate: setup needed';
    case 'block': return 'Gate: block';
    case 'pass': return 'Gate: pass';
    default: return 'Gate: ' + (decision || 'unknown');
  }
}

export function getConfidenceBadgeColor(confidence?: DiagnosticSummary['diagnostic_confidence']): string {
  switch (confidence) {
    case 'normal': return 'bg-green-100 text-green-800';
    case 'low': return 'bg-yellow-100 text-yellow-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}
export default function CampaignDetailsHelpersPage() {
  return null;
}

