import type { EffortLevel } from './pdfPayloadTypes';

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
