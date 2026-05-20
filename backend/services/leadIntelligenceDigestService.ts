/**
 * Lead intelligence digest — operator-facing, deterministic, advisory-only.
 *
 * Composes EXISTING tables (no new pipeline):
 *   - leads                  (source-of-truth conversion record)
 *   - campaign_touchpoints   (attribution carrier)
 *   - tracking_events        (page-level dropoff signal)
 *
 * Each section is a deterministic aggregation. No ML, no scoring engine.
 * Cached with lightCache (60s) — these widgets are dashboard reads.
 */
import { ownedDbTable } from '../db/writeOwner';
import { cached } from './lightCache';

const WINDOW_MS = 30 * 86_400_000;

interface LeadRow { id: string; source: string | null; created_at: string; visitor_session_id: string | null; }
interface TouchRow { lead_id: string | null; visitor_session_id: string | null; campaign: string | null; source: string | null; medium: string | null; page_url: string | null; touched_at: string; }
interface EventRow { event_name: string; current_page: string | null; visitor_session_id: string | null; occurred_at: string; }

export interface LeadIntelligenceDigest {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  totalLeads: number;
  topCampaigns: Array<{ campaign: string; source: string | null; medium: string | null; leads: number; conversionRate: number }>;
  topLandingPages: Array<{ pageUrl: string; sessions: number; leads: number; conversionRate: number }>;
  highDropoffPages: Array<{ pageUrl: string; pageviews: number; abandoned: number; abandonmentRate: number }>;
  leadSourceComparison: Array<{ source: string; leads: number; share: number }>;
  conversionTrendByDay: Array<{ day: string; leads: number }>;
  practicalSuggestions: string[];
}

async function loadLeads(companyId: string, sinceIso: string): Promise<LeadRow[]> {
  try {
    const { data } = await ownedDbTable('leads')
      .select('id, source, created_at, visitor_session_id')
      .eq('company_id', companyId)
      .gte('created_at', sinceIso)
      .limit(10_000);
    return (data ?? []) as LeadRow[];
  } catch { return []; }
}
async function loadTouches(companyId: string, sinceIso: string): Promise<TouchRow[]> {
  try {
    const { data } = await ownedDbTable('campaign_touchpoints')
      .select('lead_id, visitor_session_id, campaign, source, medium, page_url, touched_at')
      .eq('company_id', companyId)
      .gte('touched_at', sinceIso)
      .limit(50_000);
    return (data ?? []) as TouchRow[];
  } catch { return []; }
}
async function loadFormEvents(companyId: string, sinceIso: string): Promise<EventRow[]> {
  try {
    const { data } = await ownedDbTable('tracking_events')
      .select('event_name, current_page, visitor_session_id, occurred_at')
      .eq('company_id', companyId)
      .in('event_name', ['page_view', 'form_start', 'form_submit'])
      .gte('occurred_at', sinceIso)
      .limit(50_000);
    return (data ?? []) as EventRow[];
  } catch { return []; }
}

export async function buildLeadIntelligenceDigest(companyId: string): Promise<LeadIntelligenceDigest> {
  return cached(`lead-digest:${companyId}`, 60_000, async () => {
    const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
    const [leads, touches, events] = await Promise.all([
      loadLeads(companyId, sinceIso),
      loadTouches(companyId, sinceIso),
      loadFormEvents(companyId, sinceIso),
    ]);

    // ── Top campaigns
    type CampAgg = { leads: number; sessions: Set<string>; source: string | null; medium: string | null };
    const camps = new Map<string, CampAgg>();
    const leadById = new Map(leads.map((l) => [l.id, l]));
    for (const t of touches) {
      const key = String(t.campaign ?? '(direct)');
      const c = camps.get(key) ?? { leads: 0, sessions: new Set<string>(), source: t.source, medium: t.medium };
      if (t.visitor_session_id) c.sessions.add(t.visitor_session_id);
      if (t.lead_id && leadById.has(t.lead_id)) c.leads += 1;
      c.source = c.source ?? t.source;
      c.medium = c.medium ?? t.medium;
      camps.set(key, c);
    }
    const topCampaigns = [...camps.entries()]
      .map(([campaign, c]) => ({
        campaign,
        source: c.source,
        medium: c.medium,
        leads: c.leads,
        conversionRate: c.sessions.size > 0 ? Number((c.leads / c.sessions.size).toFixed(3)) : 0,
      }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 10);

    // ── Top landing pages
    const landingsBySession = new Map<string, string>(); // session → first page_url
    for (const t of touches) {
      if (!t.visitor_session_id || !t.page_url) continue;
      if (!landingsBySession.has(t.visitor_session_id)) landingsBySession.set(t.visitor_session_id, t.page_url);
    }
    const leadSessions = new Set(leads.map((l) => l.visitor_session_id).filter(Boolean) as string[]);
    const landingStats = new Map<string, { sessions: number; leads: number }>();
    for (const [sess, pageUrl] of landingsBySession) {
      const s = landingStats.get(pageUrl) ?? { sessions: 0, leads: 0 };
      s.sessions += 1;
      if (leadSessions.has(sess)) s.leads += 1;
      landingStats.set(pageUrl, s);
    }
    const topLandingPages = [...landingStats.entries()]
      .map(([pageUrl, s]) => ({ pageUrl, sessions: s.sessions, leads: s.leads, conversionRate: s.sessions > 0 ? Number((s.leads / s.sessions).toFixed(3)) : 0 }))
      .sort((a, b) => b.leads - a.leads || b.sessions - a.sessions)
      .slice(0, 10);

    // ── High-dropoff pages: page_view sessions that NEVER form_submit
    const pageviewsByPage = new Map<string, Set<string>>(); // pageUrl → sessions
    const submittedSessions = new Set<string>();
    for (const e of events) {
      if (e.event_name === 'page_view' && e.current_page && e.visitor_session_id) {
        const s = pageviewsByPage.get(e.current_page) ?? new Set<string>();
        s.add(e.visitor_session_id);
        pageviewsByPage.set(e.current_page, s);
      }
      if (e.event_name === 'form_submit' && e.visitor_session_id) submittedSessions.add(e.visitor_session_id);
    }
    const highDropoffPages = [...pageviewsByPage.entries()]
      .map(([pageUrl, sessions]) => {
        let abandoned = 0;
        for (const s of sessions) if (!submittedSessions.has(s)) abandoned += 1;
        return { pageUrl, pageviews: sessions.size, abandoned, abandonmentRate: sessions.size > 0 ? Number((abandoned / sessions.size).toFixed(3)) : 0 };
      })
      .filter((p) => p.pageviews >= 10 && p.abandonmentRate >= 0.7) // only show pages with meaningful traffic AND high dropoff
      .sort((a, b) => b.abandoned - a.abandoned)
      .slice(0, 10);

    // ── Lead-source comparison
    const sourceCounts = new Map<string, number>();
    for (const l of leads) sourceCounts.set(l.source ?? 'unknown', (sourceCounts.get(l.source ?? 'unknown') ?? 0) + 1);
    const total = leads.length;
    const leadSourceComparison = [...sourceCounts.entries()]
      .map(([source, n]) => ({ source, leads: n, share: total > 0 ? Number((n / total).toFixed(3)) : 0 }))
      .sort((a, b) => b.leads - a.leads);

    // ── Conversion trend (day buckets)
    const trendMap = new Map<string, number>();
    for (const l of leads) {
      const day = l.created_at.slice(0, 10);
      trendMap.set(day, (trendMap.get(day) ?? 0) + 1);
    }
    const conversionTrendByDay = [...trendMap.entries()]
      .map(([day, leadsCount]) => ({ day, leads: leadsCount }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));

    // ── Practical suggestions — deterministic, derived from the aggregates above.
    const suggestions: string[] = [];
    if (topCampaigns[0] && topCampaigns[0].conversionRate < 0.02 && topCampaigns[0].leads > 5) {
      suggestions.push(`Top campaign "${topCampaigns[0].campaign}" has a low session→lead rate (${(topCampaigns[0].conversionRate * 100).toFixed(1)}%). Review the landing page CTA.`);
    }
    if (highDropoffPages[0]) {
      suggestions.push(`Page with the highest unconverted traffic: ${highDropoffPages[0].pageUrl} (${highDropoffPages[0].abandoned} unconverted sessions). Add or improve a lead capture CTA.`);
    }
    if (leadSourceComparison[0] && leadSourceComparison[0].share > 0.7) {
      suggestions.push(`${leadSourceComparison[0].source} is concentrating ${(leadSourceComparison[0].share * 100).toFixed(0)}% of leads — diversify upstream sources.`);
    }
    if (conversionTrendByDay.length >= 14) {
      const recent = conversionTrendByDay.slice(-7).reduce((a, b) => a + b.leads, 0);
      const prior = conversionTrendByDay.slice(-14, -7).reduce((a, b) => a + b.leads, 0);
      if (prior > 0 && recent < prior * 0.5) suggestions.push(`Lead volume in the last 7 days is ${(((prior - recent) / prior) * 100).toFixed(0)}% below the prior 7 days — investigate top-of-funnel.`);
    }

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      windowDays: 30,
      totalLeads: leads.length,
      topCampaigns,
      topLandingPages,
      highDropoffPages,
      leadSourceComparison,
      conversionTrendByDay,
      practicalSuggestions: suggestions,
    };
  });
}
