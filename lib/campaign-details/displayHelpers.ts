import type { DiagnosticSummary, GateResponse } from './types';

export function getStatusColor(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'in_progress':
      return 'bg-blue-100 text-blue-800';
    case 'planned':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function getStageColor(stage: string) {
  const stageColorMap: Record<string, string> = {
    planning: 'bg-blue-100 text-blue-800',
    week_plan: 'bg-indigo-100 text-indigo-800',
    campaign_week_plan: 'bg-indigo-100 text-indigo-800',
    daily_plan: 'bg-amber-100 text-amber-800',
    charting: 'bg-green-100 text-green-800',
    schedule: 'bg-green-100 text-green-800',
  };
  return stageColorMap[stage] ?? 'bg-gray-100 text-gray-800';
}

export function getStageLabel(stage: string, durationWeeks?: number | null) {
  const { getStageLabelWithDuration } = require('../../backend/types/CampaignStage');
  return getStageLabelWithDuration(stage, durationWeeks);
}

export function getPhaseColor(phase: string) {
  switch (phase) {
    case 'Foundation':
      return 'from-blue-500 to-cyan-600';
    case 'Growth':
      return 'from-green-500 to-emerald-600';
    case 'Consolidation':
      return 'from-purple-500 to-violet-600';
    case 'Sustain':
      return 'from-orange-500 to-red-600';
    default:
      return 'from-gray-500 to-slate-600';
  }
}

export function getActivityColorClasses(contentType?: string) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('video') || type.includes('reel') || type.includes('short')) {
    return {
      card: 'border-red-200 bg-red-50/60',
      badge: 'bg-red-100 text-red-700 border-red-200',
    };
  }
  if (type.includes('image') || type.includes('photo')) {
    return {
      card: 'border-sky-200 bg-sky-50/60',
      badge: 'bg-sky-100 text-sky-700 border-sky-200',
    };
  }
  if (type.includes('carousel')) {
    return {
      card: 'border-fuchsia-200 bg-fuchsia-50/60',
      badge: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
    };
  }
  if (type.includes('blog') || type.includes('article')) {
    return {
      card: 'border-blue-200 bg-blue-50/60',
      badge: 'bg-blue-100 text-blue-700 border-blue-200',
    };
  }
  if (type.includes('story') || type.includes('thread')) {
    return {
      card: 'border-amber-200 bg-amber-50/60',
      badge: 'bg-amber-100 text-amber-700 border-amber-200',
    };
  }
  return {
    card: 'border-emerald-200 bg-emerald-50/60',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  };
}

export function isVisualContentType(contentType?: string) {
  const type = String(contentType || '').toLowerCase();
  return (
    type.includes('video') ||
    type.includes('reel') ||
    type.includes('short') ||
    type.includes('image') ||
    type.includes('photo') ||
    type.includes('carousel')
  );
}

export function getGateBadgeColor(decision?: GateResponse['gate_decision']) {
  switch (decision) {
    case 'pass':
      return 'bg-green-100 text-green-800';
    case 'warn':
      return 'bg-amber-100 text-amber-800';
    case 'block':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function getGateLabel(decision?: GateResponse['gate_decision']) {
  switch (decision) {
    case 'warn':
      return 'Gate: setup needed';
    case 'block':
      return 'Gate: block';
    case 'pass':
      return 'Gate: pass';
    default:
      return `Gate: ${decision || 'unknown'}`;
  }
}

export function getConfidenceBadgeColor(confidence?: DiagnosticSummary['diagnostic_confidence']) {
  switch (confidence) {
    case 'normal':
      return 'bg-green-100 text-green-800';
    case 'low':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}
