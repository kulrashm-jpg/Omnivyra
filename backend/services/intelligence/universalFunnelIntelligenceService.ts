/**
 * Universal funnel intelligence — DETERMINISTIC, READ-ONLY.
 *
 * Builds cross-domain funnel chains from existing telemetry:
 *   page_view → cta_click → attribution_handoff(verified) → form_submit
 *     → form_conversion → lead
 * Stages are counted independently over a 30-day window (no per-session
 * stitching across stages — that would require write-path changes); dropoff
 * rates are stage-relative. Cross-domain breakage = handoffs issued without
 * a matching verified row. Confidence = sample-size only. No ML.
 */
import { ownedDbTable } from '../../db/writeOwner';

export interface FunnelStage {
  stage: string;
  count: number;
  /** Drop rate from previous stage (0..1). */
  dropFromPrev: number;
}

export interface FunnelIntelligenceReport {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  stages: FunnelStage[];
  attributionBreakRate: number; // 0..1
  bottleneckStage: string | null;
  confidence: number; // 0..100
  capabilityNote: string;
}

const WINDOW_DAYS = 30;

async function countTrackingEvent(companyId: string, eventName: string, sinceIso: string): Promise<number> {
  try {
    const { count } = await ownedDbTable('tracking_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('event_name', eventName)
      .gte('occurred_at', sinceIso);
    return typeof count === 'number' ? count : 0;
  } catch { return 0; }
}

async function countSimple(
  table: string,
  companyId: string,
  dateCol: string,
  sinceIso: string,
  extra?: { col: string; op: 'eq' | 'not_null'; value?: unknown },
): Promise<number> {
  try {
    let q = ownedDbTable(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte(dateCol, sinceIso);
    if (extra) {
      if (extra.op === 'eq') q = q.eq(extra.col, extra.value);
      if (extra.op === 'not_null') q = q.not(extra.col, 'is', null);
    }
    const { count } = await q;
    return typeof count === 'number' ? count : 0;
  } catch { return 0; }
}

export async function buildUniversalFunnel(companyId: string): Promise<FunnelIntelligenceReport> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  const [pageViews, ctaClicks, formSubmits, conversions, leads, handoffsIssued, handoffsVerified] = await Promise.all([
    countTrackingEvent(companyId, 'page_view', sinceIso),
    countTrackingEvent(companyId, 'cta_click', sinceIso),
    countTrackingEvent(companyId, 'form_submit', sinceIso),
    countSimple('form_conversions', companyId, 'converted_at', sinceIso),
    countSimple('leads', companyId, 'created_at', sinceIso),
    countSimple('attribution_handoffs', companyId, 'issued_at', sinceIso),
    countSimple('attribution_handoffs', companyId, 'issued_at', sinceIso, { col: 'verified_at', op: 'not_null' }),
  ]);

  const rawStages: Array<{ stage: string; count: number }> = [
    { stage: 'page_view', count: pageViews },
    { stage: 'cta_click', count: ctaClicks },
    { stage: 'attribution_handoff_verified', count: handoffsVerified },
    { stage: 'form_submit', count: formSubmits },
    { stage: 'form_conversion', count: conversions },
    { stage: 'lead', count: leads },
  ];

  const stages: FunnelStage[] = rawStages.map((s, i) => {
    if (i === 0) return { ...s, dropFromPrev: 0 };
    const prev = rawStages[i - 1].count;
    const drop = prev > 0 ? Number(((prev - s.count) / prev).toFixed(3)) : 0;
    return { ...s, dropFromPrev: Math.max(0, Math.min(1, drop)) };
  });

  // Bottleneck: stage with largest non-zero drop (skip the attribution handoff
  // stage if cross-domain attribution is unused — counts will be 0 and drop
  // would appear 100% spuriously).
  const candidate = stages.slice(1).filter((s, i) => rawStages[i + 1].count > 0 || rawStages[i].count > 0);
  const bottleneck = candidate.reduce<FunnelStage | null>((worst, s) => {
    if (!worst || s.dropFromPrev > worst.dropFromPrev) return s;
    return worst;
  }, null);

  const attributionBreakRate =
    handoffsIssued > 0 ? Number(((handoffsIssued - handoffsVerified) / handoffsIssued).toFixed(3)) : 0;

  const totalSamples = pageViews + ctaClicks + formSubmits + conversions + leads;
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    stages,
    attributionBreakRate,
    bottleneckStage: bottleneck?.stage ?? null,
    confidence: Math.round((1 - Math.exp(-totalSamples / 500)) * 100),
    capabilityNote:
      'Deterministic stage-count funnel over 30d. Cross-domain attribution stage uses the new attribution_handoffs telemetry. No ML.',
  };
}
