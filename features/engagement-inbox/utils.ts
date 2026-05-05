// Pure formatting utilities for the engagement-inbox UI.

export function formatScorePercent(score: number | null | undefined): string {
  return `${(Number(score ?? 0) * 100).toFixed(0)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}
