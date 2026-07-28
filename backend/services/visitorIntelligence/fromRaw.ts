/**
 * V-A102..A107 — Visitor ingestion (pure, deterministic). Projects raw visitor observations (from a
 * first-party analytics/capture source) into canonical evidence + facets + references-only graph edges
 * on the SHARED spine. Identity is DESCRIPTIVE only (no resolution); acquisition captures UTM evidence
 * (no attribution modelling); behavioral is evidence-first (no intent inference). Absent fields abstain
 * (never fabricate).
 */

import type { VisitorFacets, VisitorStatus, VisitorLifecycleState, EvidenceRef } from './types';
import type { GraphEdge } from '../intelligence/canonical';
import { facet, evidenceRef } from '../intelligence/canonical';
import { visitorEdge } from './graph';

export interface VisitorRawInput {
  companyId: string;
  asOf: string;
  source?: string;
  visitorId?: string;
  anonymousId?: string;
  status?: VisitorStatus;
  aliases?: string[];
  leadRef?: string | null;
  companyRef?: string | null;
  identityConfidence?: number;
  // device
  device?: string; browser?: string; os?: string; screen?: string; language?: string; timezone?: string; capabilities?: string[];
  // geo
  country?: string; region?: string; city?: string;
  // referral / acquisition
  referrer?: string; referrerDomain?: string; referrerType?: string;
  acquisitionSource?: string; medium?: string; campaign?: string; entryPage?: string; landingContext?: string; utm?: Record<string, string>;
  // session
  sessionCount?: number; firstSeenAt?: string; lastSeenAt?: string; exitPage?: string; durationSeconds?: number; pageCount?: number; frequency?: string; bounce?: boolean;
  // behavioral
  pagesViewed?: string[]; contentConsumed?: string[]; searchActivity?: string[]; downloads?: string[]; engagementEvents?: string[]; interactionCategories?: string[];
  // engagement + lifecycle
  engagementLevel?: string; engagementSignals?: string[]; lifecycle?: VisitorLifecycleState;
  // reference targets (references-only edges)
  offeringRefs?: string[]; contentRefs?: string[];
}

/** Deterministic canonical id: slug of visitorId ?? anonymousId (exact — same id ⇒ same visitor). */
export function resolveVisitorId(raw: { visitorId?: string; anonymousId?: string }): string {
  const base = String(raw.visitorId ?? raw.anonymousId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'visitor';
}

const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');

export interface AdoptedVisitor { key: { companyId: string; visitorId: string }; facets: Partial<VisitorFacets>; evidence: EvidenceRef[]; edges: GraphEdge[]; }

/** PROJECT one raw visitor into canonical evidence + facets + references-only edges (never fabricates). */
export function visitorFromRaw(raw: VisitorRawInput): AdoptedVisitor {
  const src = raw.source ?? 'visitor_capture';
  const id = resolveVisitorId(raw);
  const evidence: EvidenceRef[] = [];
  const ev = (label: string, value: string | number | boolean, kind: 'structured' | 'observed' | 'inferred' = 'observed'): EvidenceRef => {
    const e = evidenceRef({ id: `visitor:${label}:${src}:${raw.asOf}`, kind, label, value, source: { system: src }, observedAt: raw.asOf, recordedAt: raw.asOf });
    evidence.push(e); return e;
  };
  const facets: Partial<VisitorFacets> = {};
  const one = <T>(cond: boolean, name: keyof VisitorFacets, value: T, evs: EvidenceRef[]) => { if (cond) (facets as any)[name] = facet(value, evs); };

  const status: VisitorStatus = raw.status ?? (raw.leadRef ? 'identified' : 'anonymous');
  one(true, 'identity', { canonical_id: id, status, aliases: raw.aliases, leadRef: raw.leadRef ?? null, companyRef: raw.companyRef ?? null, identityConfidence: raw.identityConfidence }, [ev('status', status, 'structured')]);

  one(has(raw.device) || has(raw.browser) || has(raw.os) || has(raw.language) || has(raw.timezone) || has(raw.screen) || has(raw.capabilities),
    'device', { device: raw.device, browser: raw.browser, os: raw.os, screen: raw.screen, language: raw.language, timezone: raw.timezone, capabilities: raw.capabilities },
    [ev('device', [raw.device, raw.browser, raw.os].filter(Boolean).join(' / ') || 'device', 'structured')]);

  one(has(raw.country) || has(raw.region) || has(raw.city), 'geo', { country: raw.country, region: raw.region, city: raw.city, timezone: raw.timezone },
    [ev('geo', [raw.country, raw.region, raw.city].filter(Boolean).join(' / ') || 'geo')]);

  one(has(raw.referrer) || has(raw.referrerDomain) || has(raw.referrerType), 'referral', { referrer: raw.referrer, referrerDomain: raw.referrerDomain, referrerType: raw.referrerType },
    [ev('referral', raw.referrer ?? raw.referrerDomain ?? 'referral')]);

  const acqEv: EvidenceRef[] = [];
  if (has(raw.acquisitionSource) || has(raw.medium) || has(raw.campaign) || has(raw.entryPage) || (raw.utm && Object.keys(raw.utm).length)) {
    acqEv.push(ev('acquisition', [raw.acquisitionSource, raw.medium, raw.campaign].filter(Boolean).join(' / ') || 'acquisition', 'structured'));
    if (raw.utm) for (const [k, v] of Object.entries(raw.utm).sort()) acqEv.push(ev(`utm_${k}`, v, 'structured'));
  }
  one(acqEv.length > 0, 'acquisition', { source: raw.acquisitionSource, medium: raw.medium, campaign: raw.campaign, entryPage: raw.entryPage, landingContext: raw.landingContext, utm: raw.utm }, acqEv);

  one(raw.sessionCount != null || has(raw.firstSeenAt) || has(raw.lastSeenAt) || raw.pageCount != null || raw.durationSeconds != null || raw.bounce != null,
    'session', { sessionCount: raw.sessionCount, firstSeenAt: raw.firstSeenAt, lastSeenAt: raw.lastSeenAt, entryPage: raw.entryPage, exitPage: raw.exitPage, durationSeconds: raw.durationSeconds, pageCount: raw.pageCount, frequency: raw.frequency, bounce: raw.bounce },
    [ev('session', raw.sessionCount ?? 1, 'structured')]);

  one(has(raw.pagesViewed) || has(raw.contentConsumed) || has(raw.searchActivity) || has(raw.downloads) || has(raw.engagementEvents) || has(raw.interactionCategories),
    'behavioral', { pagesViewed: raw.pagesViewed, contentConsumed: raw.contentConsumed, searchActivity: raw.searchActivity, downloads: raw.downloads, engagementEvents: raw.engagementEvents, interactionCategories: raw.interactionCategories },
    [ev('behavioral', (raw.pagesViewed ?? []).length + (raw.engagementEvents ?? []).length, 'observed')]);

  one(has(raw.engagementLevel) || has(raw.engagementSignals), 'engagement', { level: raw.engagementLevel, signals: raw.engagementSignals }, [ev('engagement', raw.engagementLevel ?? 'engaged', 'inferred')]);
  one(has(raw.lifecycle), 'lifecycle', { state: raw.lifecycle }, [ev('lifecycle', raw.lifecycle ?? '', 'inferred')]);

  // References-only edges (only when a target exists) — visitor owns none of these nodes.
  const edges: GraphEdge[] = [];
  if (has(raw.leadRef)) edges.push(visitorEdge(id, 'identified_as', 'lead', raw.leadRef!, [ev('lead_ref', raw.leadRef!, 'structured')], 0.7));
  if (has(raw.companyRef)) edges.push(visitorEdge(id, 'belongs_to', 'company', raw.companyRef!, [ev('company_ref', raw.companyRef!, 'structured')], 0.6));
  if (has(raw.campaign)) edges.push(visitorEdge(id, 'acquired_via', 'campaign', String(raw.campaign), [ev('campaign_ref', String(raw.campaign), 'structured')], 0.6));
  for (const o of (raw.offeringRefs ?? [])) edges.push(visitorEdge(id, 'engaged_with', 'offering', o, [ev(`offering_view:${o}`, o)], 0.5));
  for (const c of (raw.contentRefs ?? [])) edges.push(visitorEdge(id, 'engaged_with', 'content', c, [ev(`content_view:${c}`, c)], 0.5));

  return { key: { companyId: raw.companyId, visitorId: id }, facets, evidence, edges };
}
