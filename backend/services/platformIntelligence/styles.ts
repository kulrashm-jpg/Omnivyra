/**
 * Platform Intelligence styling registry (Phase 21B, Phase J).
 *
 * The ONE styling registry for EVERY intelligence domain (website, lead, growth,
 * marketing, analytics, …). Framework-agnostic semantic tokens + their colours, with
 * `badgeStyle()` (React inline style) and `badgeCss()` (HTML CSS) from the same source.
 * Website Intelligence's `presentationStyles` re-exports this (Consumer #1).
 */
export type StyleToken = 'good' | 'warn' | 'bad' | 'neutral' | 'high' | 'strategic';

export const TOKENS: Record<StyleToken, { bg: string; fg: string }> = {
  good: { bg: '#d1fae5', fg: '#047857' },
  warn: { bg: '#fef3c7', fg: '#b45309' },
  bad: { bg: '#fee2e2', fg: '#b91c1c' },
  neutral: { bg: '#f3f4f6', fg: '#6b7280' },
  high: { bg: '#ffedd5', fg: '#c2410c' },
  strategic: { bg: '#e0e7ff', fg: '#4338ca' },
};

export function statusToken(status: string | null | undefined): StyleToken {
  switch (status) {
    case 'healthy': case 'ready': return 'good';
    case 'partial': case 'warning': return 'warn';
    case 'critical': return 'bad';
    default: return 'neutral';
  }
}

export function categoryToken(category: string | null | undefined): StyleToken {
  switch (category) {
    case 'critical': return 'bad';
    case 'high': return 'high';
    case 'quick_win': return 'good';
    case 'strategic': return 'strategic';
    case 'medium': return 'warn';
    default: return 'neutral';
  }
}

export const scoreToken = (score: number | null | undefined): StyleToken =>
  score == null ? 'neutral' : score >= 80 ? 'good' : score >= 55 ? 'warn' : 'bad';

export const confidenceToken = (conf: number | null | undefined): StyleToken =>
  conf == null ? 'neutral' : conf >= 0.6 ? 'good' : conf >= 0.3 ? 'warn' : 'neutral';

export const badgeStyle = (token: StyleToken): { backgroundColor: string; color: string } => ({ backgroundColor: TOKENS[token].bg, color: TOKENS[token].fg });

export const badgeCss = (token: StyleToken): string => `background:${TOKENS[token].bg};color:${TOKENS[token].fg};`;
