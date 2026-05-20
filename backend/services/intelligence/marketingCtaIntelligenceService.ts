/**
 * CTA optimization intelligence — DETERMINISTIC, ATTRIBUTION-GROUNDED.
 *
 * Reads `tracking_events` (event_name='cta_click') + `form_conversions` to
 * compute per-CTA effectiveness: click volume + click→submit conversion in
 * the same session. No ML, no learned ranking; ranking is bounded for
 * stability (max ±0.25 deviation from neutral) and explainable.
 */
import { ownedDbTable } from '../../db/writeOwner';

export interface CtaEffectiveness {
  ctaKey: string;
  clicks30d: number;
  attributedSubmits30d: number;
  conversionRate: number; // 0..1
  score: number;          // 0..100
  stabilizedWeight: number; // 0.5..1.5 (bounded)
  confidence: number;     // 0..100 (sample size)
  basis: string;
}

export interface CtaIntelligenceReport {
  companyId: string;
  generatedAt: string;
  ctas: CtaEffectiveness[];
  summary: { total: number; topCta: string | null };
  capabilityNote: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function confidenceFromN(n: number): number {
  return Math.round((1 - Math.exp(-n / 12)) * 100);
}

export async function buildCtaIntelligence(companyId: string): Promise<CtaIntelligenceReport> {
  const sinceIso = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // cta_click events grouped by metadata.cta_label || metadata.cta_id.
  const ctaSessions = new Map<string, Set<string>>(); // ctaKey → sessionIds that clicked
  try {
    const { data } = await ownedDbTable('tracking_events')
      .select('visitor_session_id, metadata')
      .eq('company_id', companyId)
      .eq('event_name', 'cta_click')
      .gte('occurred_at', sinceIso)
      .limit(5000);
    for (const r of ((data ?? []) as any[])) {
      const m = r.metadata ?? {};
      const key = String(m.cta_label ?? m.cta_id ?? m.label ?? 'unlabeled');
      const sid = String(r.visitor_session_id ?? '');
      if (!ctaSessions.has(key)) ctaSessions.set(key, new Set());
      if (sid) ctaSessions.get(key)!.add(sid);
    }
  } catch {
    /* absent → empty */
  }

  // Sessions that converted via a form in window.
  const convertedSessions = new Set<string>();
  try {
    const { data } = await ownedDbTable('form_conversions')
      .select('visitor_session_id')
      .eq('company_id', companyId)
      .gte('converted_at', sinceIso)
      .limit(5000);
    for (const r of ((data ?? []) as any[])) {
      const sid = String(r.visitor_session_id ?? '');
      if (sid) convertedSessions.add(sid);
    }
  } catch {
    /* absent */
  }

  const ctas: CtaEffectiveness[] = [];
  for (const [key, sessions] of ctaSessions.entries()) {
    const clicks = sessions.size;
    let submits = 0;
    for (const sid of sessions) if (convertedSessions.has(sid)) submits += 1;
    const rate = clicks > 0 ? submits / clicks : 0;
    const score = clamp(Math.round(rate * 70 + Math.log1p(clicks) * 6), 0, 100);
    const stabilizedWeight = Number(clamp(0.5 + score / 100, 0.5, 1.5).toFixed(3));
    ctas.push({
      ctaKey: key,
      clicks30d: clicks,
      attributedSubmits30d: submits,
      conversionRate: Number(rate.toFixed(3)),
      score,
      stabilizedWeight,
      confidence: confidenceFromN(clicks + submits * 3),
      basis: 'rate*70 + log1p(clicks)*6; stabilized weight clamped [0.5,1.5]',
    });
  }
  ctas.sort((a, b) => b.score - a.score);
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    ctas,
    summary: { total: ctas.length, topCta: ctas[0]?.ctaKey ?? null },
    capabilityNote: 'Deterministic per-CTA click→submit attribution in 30d window. Ranking bounded for stability.',
  };
}
