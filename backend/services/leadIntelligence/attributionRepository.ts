/**
 * Canonical Lead Intelligence Repository — attribution aggregation (E2).
 *
 * The single read path for Attribution Diagnostics. Owns the leads /
 * lead_attributions / visitor_sessions reads (relocated verbatim from
 * attributionDiagnosticsService) and the channel classification. Exposes:
 *   - getAttributionDiagnostics() → the EXACT legacy AttributionDiagnosticsReport
 *     (byte-identical; the consumer delegates here)
 *   - getAttributionAggregation() → additive richer aggregate (channel / source /
 *     medium / campaign / referrer / UTM / totals / timeline) for future consumers;
 *     NOT wired into the diagnostics contract, so behaviour is unchanged.
 *
 * `now` is injectable for deterministic tests; production omits it (Date.now()).
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  classifyReferrer,
  emptyChannelBreakdown,
  type ReferrerClass,
} from '../../../lib/leadIntelligence';

export interface AttributionDiagnosticsReport {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  leads: number;
  leadsWithAttribution: number;
  leadsWithSession: number;
  sessionsStitched: number;
  sessionsTotal: number;
  missingAttribution: number;
  missingUtmButHasReferrer: number;
  /** 0–100 — share of leads with a complete, session-linked attribution. */
  attributionConfidence: number;
  channelBreakdown: Record<ReferrerClass, number>;
  integrityIssues: string[];
  remediation: string[];
}

interface AttributionLead {
  id: string;
  visitor_session_id: string | null;
  created_at: string;
}
interface AttributionRow {
  lead_id: string;
  visitor_session_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
  created_at: string | null;
}

interface AttributionData {
  sinceIso: string;
  leads: AttributionLead[];
  attributions: AttributionRow[];
  sessionsTotal: number;
  sessionsStitched: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Loads the attribution dataset once (fail-open per source, exactly as before). */
async function loadAttributionData(companyId: string, windowDays: number, now: number): Promise<AttributionData> {
  const sinceIso = new Date(now - windowDays * DAY).toISOString();

  let leads: AttributionLead[] = [];
  try {
    const { data } = await ownedDbTable('leads')
      .select('id, visitor_session_id, created_at')
      .eq('company_id', companyId)
      .gte('created_at', sinceIso);
    leads = (data ?? []) as any[];
  } catch {
    leads = [];
  }

  let attributions: AttributionRow[] = [];
  try {
    const { data } = await ownedDbTable('lead_attributions')
      .select('lead_id, visitor_session_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, created_at')
      .eq('company_id', companyId)
      .gte('created_at', sinceIso);
    attributions = (data ?? []) as any[];
  } catch {
    attributions = [];
  }

  let sessionsTotal = 0;
  let sessionsStitched = 0;
  try {
    const { count: total } = await ownedDbTable('visitor_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('started_at', sinceIso);
    sessionsTotal = typeof total === 'number' ? total : 0;
    const { count: stitched } = await ownedDbTable('visitor_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .not('stitched_at', 'is', null)
      .gte('started_at', sinceIso);
    sessionsStitched = typeof stitched === 'number' ? stitched : 0;
  } catch {
    /* counts default to 0 */
  }

  return { sinceIso, leads, attributions, sessionsTotal, sessionsStitched };
}

export async function getAttributionDiagnostics(
  companyId: string,
  windowDays = 30,
  now: number = Date.now(),
): Promise<AttributionDiagnosticsReport> {
  const integrityIssues: string[] = [];
  const remediation: string[] = [];
  const { leads, attributions, sessionsTotal, sessionsStitched } = await loadAttributionData(companyId, windowDays, now);

  const attrByLead = new Map(attributions.map((a) => [a.lead_id, a]));
  const leadsWithAttribution = leads.filter((l) => attrByLead.has(l.id)).length;
  const leadsWithSession = leads.filter((l) => Boolean(l.visitor_session_id)).length;
  const missingAttribution = leads.length - leadsWithAttribution;
  const missingUtmButHasReferrer = attributions.filter((a) => !a.utm_source && Boolean(a.referrer)).length;

  const channelBreakdown = emptyChannelBreakdown();
  for (const a of attributions) {
    const cls = classifyReferrer({ referrer: a.referrer, utmMedium: a.utm_medium, utmSource: a.utm_source });
    channelBreakdown[cls] += 1;
  }

  const attributionConfidence =
    leads.length === 0
      ? 0
      : Math.round(((leadsWithAttribution * 0.6 + leadsWithSession * 0.4) / leads.length) * 100);

  if (leads.length > 0 && missingAttribution > 0) {
    integrityIssues.push(`${missingAttribution}/${leads.length} leads have no attribution snapshot.`);
    remediation.push('Ensure the form/webhook payload forwards utm_* + referrer + landing_page (tracker captures these automatically when installed).');
  }
  if (sessionsTotal > 0 && sessionsStitched === 0 && leads.length > 0) {
    integrityIssues.push('No visitor sessions are stitched to leads — anonymous→lead linkage may be broken.');
    remediation.push('Confirm leads submit the anonymous_id/session_id captured by the tracker.');
  }
  if (missingUtmButHasReferrer > 0) {
    integrityIssues.push(`${missingUtmButHasReferrer} attributions rely on referrer only (no UTM) — channel accuracy reduced.`);
  }

  return {
    companyId,
    generatedAt: new Date(now).toISOString(),
    windowDays,
    leads: leads.length,
    leadsWithAttribution,
    leadsWithSession,
    sessionsStitched,
    sessionsTotal,
    missingAttribution,
    missingUtmButHasReferrer,
    attributionConfidence,
    channelBreakdown,
    integrityIssues,
    remediation,
  };
}

// ─── E2 — additive richer attribution aggregation (not part of the legacy contract) ──

export interface AttributionAggregation {
  companyId: string;
  windowDays: number;
  generatedAt: string;
  totals: {
    leads: number;
    attributions: number;
    leadsWithAttribution: number;
    leadsWithSession: number;
    sessionsTotal: number;
    sessionsStitched: number;
    missingAttribution: number;
    missingUtmButHasReferrer: number;
  };
  channelBreakdown: Record<ReferrerClass, number>;
  sourceBreakdown: Record<string, number>;
  mediumBreakdown: Record<string, number>;
  campaignBreakdown: Record<string, number>;
  referrerBreakdown: Record<string, number>;
  utmAggregation: {
    withUtmSource: number;
    withUtmMedium: number;
    withUtmCampaign: number;
    withUtmContent: number;
    withUtmTerm: number;
  };
  timeline: Array<{ date: string; attributions: number }>;
}

const NONE = '(none)';

/** Count by a key, null/empty → '(none)', sorted by key for deterministic output. */
function tally(rows: AttributionRow[], pick: (r: AttributionRow) => string | null | undefined): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of rows) {
    const raw = pick(r);
    const key = raw && String(raw).trim() ? String(raw) : NONE;
    acc[key] = (acc[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(acc).sort(([a], [b]) => a.localeCompare(b)));
}

export async function getAttributionAggregation(
  companyId: string,
  windowDays = 30,
  now: number = Date.now(),
): Promise<AttributionAggregation> {
  const { leads, attributions, sessionsTotal, sessionsStitched } = await loadAttributionData(companyId, windowDays, now);

  const attrByLead = new Map(attributions.map((a) => [a.lead_id, a]));
  const leadsWithAttribution = leads.filter((l) => attrByLead.has(l.id)).length;
  const leadsWithSession = leads.filter((l) => Boolean(l.visitor_session_id)).length;

  const channelBreakdown = emptyChannelBreakdown();
  for (const a of attributions) {
    channelBreakdown[classifyReferrer({ referrer: a.referrer, utmMedium: a.utm_medium, utmSource: a.utm_source })] += 1;
  }

  const timelineMap: Record<string, number> = {};
  for (const a of attributions) {
    if (!a.created_at) continue;
    const date = a.created_at.slice(0, 10);
    timelineMap[date] = (timelineMap[date] ?? 0) + 1;
  }
  const timeline = Object.entries(timelineMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, attributions: count }));

  return {
    companyId,
    windowDays,
    generatedAt: new Date(now).toISOString(),
    totals: {
      leads: leads.length,
      attributions: attributions.length,
      leadsWithAttribution,
      leadsWithSession,
      sessionsTotal,
      sessionsStitched,
      missingAttribution: leads.length - leadsWithAttribution,
      missingUtmButHasReferrer: attributions.filter((a) => !a.utm_source && Boolean(a.referrer)).length,
    },
    channelBreakdown,
    sourceBreakdown: tally(attributions, (r) => r.utm_source),
    mediumBreakdown: tally(attributions, (r) => r.utm_medium),
    campaignBreakdown: tally(attributions, (r) => r.utm_campaign),
    referrerBreakdown: tally(attributions, (r) => r.referrer),
    utmAggregation: {
      withUtmSource: attributions.filter((a) => Boolean(a.utm_source)).length,
      withUtmMedium: attributions.filter((a) => Boolean(a.utm_medium)).length,
      withUtmCampaign: attributions.filter((a) => Boolean(a.utm_campaign)).length,
      withUtmContent: attributions.filter((a) => Boolean(a.utm_content)).length,
      withUtmTerm: attributions.filter((a) => Boolean(a.utm_term)).length,
    },
    timeline,
  };
}
