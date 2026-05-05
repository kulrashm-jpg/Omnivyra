// Pure formatting utilities shared across the intelligence-control sub-components.

export function fmtMinutes(m: number): string {
  if (m < 60)   return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function priorityColor(p: number): string {
  if (p <= 3) return 'text-red-600 bg-red-50 border-red-200';
  if (p <= 5) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-gray-500 bg-gray-50 border-gray-200';
}

export function statusDot(status: string): string {
  if (status === 'completed') return 'bg-emerald-400';
  if (status === 'failed')    return 'bg-red-400';
  if (status === 'running')   return 'bg-blue-400 animate-pulse';
  return 'bg-gray-300';
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
