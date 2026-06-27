import React from 'react';
import type { TemplateRecommendation } from '../../lib/creator-templates';

/**
 * "Why this template?" panel (CAMPAIGN-005). Read-only display of the canonical
 * deterministic recommendation — score + reasons (and optional per-dimension
 * breakdown) produced by `recommendTemplatesForContext`. Drops into the existing
 * gallery's recommended cards / details drawer; it is NOT a separate selector
 * and generates no explanations of its own.
 */
interface Props {
  recommendation: TemplateRecommendation;
  /** Compact = score badge only (cards); expanded = full reasons panel (drawer). */
  compact?: boolean;
}

export default function TemplateRecommendationPanel({ recommendation, compact }: Props) {
  const pct = Math.round(recommendation.confidence * 100);
  if (compact) {
    return (
      <span style={S.badge} title={`Recommendation score ${pct}%`}>★ Recommended · {pct}%</span>
    );
  }
  const contributing = recommendation.dimensions
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score * b.weight - a.score * a.weight);
  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <span style={S.badge}>★ Recommended</span>
        <span style={S.score}>{pct}% match</span>
      </div>
      <div style={S.title}>Why this template?</div>
      <ul style={S.reasons}>
        {recommendation.reasons.slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}
      </ul>
      {contributing.length > 0 ? (
        <div style={S.dims}>
          {contributing.slice(0, 8).map((d) => (
            <div key={d.dimension} style={S.dimRow}>
              <span style={S.dimName}>{d.dimension}</span>
              <span style={S.bar}><span style={{ ...S.barFill, width: `${Math.round(d.score * 100)}%` }} /></span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const S = {
  wrap: { border: '1px solid #166534', borderRadius: 10, padding: 12, background: '#052e16' } as React.CSSProperties,
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } as React.CSSProperties,
  badge: { fontSize: 11, fontWeight: 800, color: '#052e16', background: '#34d399', borderRadius: 999, padding: '2px 9px' } as React.CSSProperties,
  score: { fontSize: 13, fontWeight: 700, color: '#86efac' } as React.CSSProperties,
  title: { fontSize: 12, fontWeight: 700, color: '#bbf7d0', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 } as React.CSSProperties,
  reasons: { margin: 0, paddingLeft: 18, color: '#d1fae5', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 2 } as React.CSSProperties,
  dims: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 } as React.CSSProperties,
  dimRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 } as React.CSSProperties,
  dimName: { color: '#6ee7b7', width: 130, textTransform: 'capitalize' } as React.CSSProperties,
  bar: { flex: 1, height: 6, background: '#064e3b', borderRadius: 999, overflow: 'hidden' } as React.CSSProperties,
  barFill: { display: 'block', height: '100%', background: '#34d399' } as React.CSSProperties,
};
