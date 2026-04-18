import type { EffortLevel, PdfTopPriority, ReportType } from './pdfTypes';

export const PAGE = {
  size: 'A4' as const,
  margin: 42,
};

export const COLORS = {
  ink: '#0f172a',
  muted: '#475569',
  faint: '#64748b',
  border: '#dbe4f0',
  panel: '#f8fafc',
  brand: '#1d4ed8',
  brandSoft: '#dbeafe',
  diagnosisBg: '#eff6ff',
  diagnosisBorder: '#93c5fd',
  priorityBg: '#f8fbff',
  actionBg: '#f8fafc',
  insightBg: '#ffffff',
  successBg: '#f0fdf4',
  warningBg: '#fff7ed',
  dangerBg: '#fff1f2',
  high: '#e11d48',
  medium: '#d97706',
  low: '#0f766e',
};

export function safeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + safeNumber(value), 0) / values.length);
}

export function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatPriorityType(value: 'quick_win' | 'high_impact' | 'strategic'): string {
  if (value === 'quick_win') return 'Quick Win';
  if (value === 'high_impact') return 'High Impact';
  return 'Strategic';
}

export function formatReportType(value: ReportType): string {
  return value === 'snapshot'
    ? 'Snapshot Report'
    : value === 'performance'
      ? 'Performance Report'
      : 'Growth Report';
}

export function deriveImpactLabel(priority: PdfTopPriority): string {
  if (priority.impactLabel) return priority.impactLabel;
  const impact = safeNumber(priority.impactScore);
  const confidence = safeNumber(priority.confidenceScore) * 100;
  if (impact >= 80 || confidence >= 80) return 'High impact';
  if (impact >= 55 || confidence >= 60) return 'Medium impact';
  return 'Emerging impact';
}

export function deriveTimeToImpact(priority: PdfTopPriority): string {
  if (priority.timeToImpact) return priority.timeToImpact;
  const effort = priority.effortLevel;
  const confidence = safeNumber(priority.confidenceScore);
  if (effort === 'low' && confidence >= 0.65) return '1-2 weeks';
  if (effort === 'medium' || confidence >= 0.45) return '2-4 weeks';
  return '4-8 weeks';
}

export function effortColor(level: EffortLevel): string {
  if (level === 'low') return COLORS.low;
  if (level === 'high') return COLORS.high;
  return COLORS.medium;
}

export function statusColor(level: 'high' | 'medium' | 'low' | 'critical' | 'moderate'): string {
  if (level === 'high' || level === 'critical') return COLORS.high;
  if (level === 'medium' || level === 'moderate') return COLORS.medium;
  return COLORS.low;
}

export function strengthColor(level: 'strong' | 'inferred' | 'weak' | 'missing' | undefined): string {
  if (level === 'strong') return '#0f766e';
  if (level === 'inferred') return '#b45309';
  if (level === 'weak') return '#be123c';
  return COLORS.faint;
}

export function boxFill(level: 'high' | 'medium' | 'low' | 'critical' | 'moderate'): string {
  if (level === 'high' || level === 'critical') return COLORS.dangerBg;
  if (level === 'medium' || level === 'moderate') return COLORS.warningBg;
  return COLORS.successBg;
}
