/**
 * Attribution integrity diagnostics (READ-ONLY).
 *
 * Reflects the EXISTING attribution write-path (leadAttributionService /
 * attributionResolverService): leads → lead_attributions, visitor_sessions
 * (stitched_at / unified_person_id), campaign_touchpoints. No writes, no
 * re-attribution — observability only.
 *
 * Attribution linkage flow it inspects (unchanged):
 *   tracking_events → visitor_sessions(anonymous_id) → stitchSessionToLead()
 *     → lead_attributions(first_touch/last_touch/utm_*) ← leads
 */
import { ownedDbTable } from '../../db/writeOwner';

export type ReferrerClass =
  | 'direct'
  | 'organic_search'
  | 'paid'
  | 'social'
  | 'email'
  | 'referral'
  | 'internal'
  | 'unknown';

const SEARCH_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'yandex.', 'baidu.', 'ecosia.'];
const SOCIAL_HOSTS = ['facebook.', 'instagram.', 't.co', 'twitter.', 'x.com', 'linkedin.', 'pinterest.', 'reddit.', 'youtube.', 'tiktok.'];

/** Pure, side-effect-free referrer/UTM → channel classifier. */
export function classifyReferrer(input: {
  referrer?: string | null;
  utmMedium?: string | null;
  utmSource?: string | null;
  selfHost?: string | null;
}): ReferrerClass {
  const medium = (input.utmMedium || '').toLowerCase();
  if (medium) {
    if (/cpc|ppc|paid|paidsearch|display|cpm/.test(medium)) return 'paid';
    if (/email|newsletter/.test(medium)) return 'email';
    if (/social|social-paid|paid-social/.test(medium)) return 'social';
    if (/organic/.test(medium)) return 'organic_search';
    if (/referral/.test(medium)) return 'referral';
  }
  const ref = (input.referrer || '').toLowerCase();
  if (!ref) return input.utmSource ? 'referral' : 'direct';
  let host = '';
  try {
    host = new URL(ref.startsWith('http') ? ref : `https://${ref}`).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  if (input.selfHost && host.endsWith(input.selfHost.toLowerCase())) return 'internal';
  if (SEARCH_HOSTS.some((h) => host.includes(h))) return 'organic_search';
  if (SOCIAL_HOSTS.some((h) => host.includes(h))) return 'social';
  return 'referral';
}

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

const DAY = 24 * 60 * 60 * 1000;

export async function buildAttributionDiagnostics(
  companyId: string,
  windowDays = 30,
): Promise<AttributionDiagnosticsReport> {
  const sinceIso = new Date(Date.now() - windowDays * DAY).toISOString();
  const integrityIssues: string[] = [];
  const remediation: string[] = [];

  let leads: Array<{ id: string; visitor_session_id: string | null; created_at: string }> = [];
  try {
    const { data } = await ownedDbTable('leads')
      .select('id, visitor_session_id, created_at')
      .eq('company_id', companyId)
      .gte('created_at', sinceIso);
    leads = (data ?? []) as any[];
  } catch {
    leads = [];
  }

  let attributions: Array<{
    lead_id: string;
    visitor_session_id: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    referrer: string | null;
  }> = [];
  try {
    const { data } = await ownedDbTable('lead_attributions')
      .select('lead_id, visitor_session_id, utm_source, utm_medium, referrer')
      .eq('company_id', companyId)
      .gte('created_at', sinceIso);
    attributions = (data ?? []) as any[];
  } catch {
    attributions = [];
  }

  const attrByLead = new Map(attributions.map((a) => [a.lead_id, a]));
  const leadsWithAttribution = leads.filter((l) => attrByLead.has(l.id)).length;
  const leadsWithSession = leads.filter((l) => Boolean(l.visitor_session_id)).length;
  const missingAttribution = leads.length - leadsWithAttribution;
  const missingUtmButHasReferrer = attributions.filter(
    (a) => !a.utm_source && Boolean(a.referrer),
  ).length;

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

  const channelBreakdown: Record<ReferrerClass, number> = {
    direct: 0, organic_search: 0, paid: 0, social: 0, email: 0, referral: 0, internal: 0, unknown: 0,
  };
  for (const a of attributions) {
    const cls = classifyReferrer({ referrer: a.referrer, utmMedium: a.utm_medium, utmSource: a.utm_source });
    channelBreakdown[cls] += 1;
  }

  const attributionConfidence =
    leads.length === 0
      ? 0
      : Math.round(
          ((leadsWithAttribution * 0.6 + leadsWithSession * 0.4) / leads.length) * 100,
        );

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
    generatedAt: new Date().toISOString(),
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
