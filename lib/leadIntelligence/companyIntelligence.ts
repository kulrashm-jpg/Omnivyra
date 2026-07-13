/**
 * Company Intelligence & Account Buying Intent — DETERMINISTIC (NO AI / NO LLM).
 *
 * Aggregates per-contact intelligence across every known lead that shares a prospect
 * company into one account-centric profile: an explainable account intent score,
 * stakeholder analysis, a merged account journey, ranked account interests, channel
 * readiness, and a company action plan. Pure + reusable. Company grouping is a
 * deterministic KEY derived from existing evidence (company_name → email domain,
 * excluding free providers) — it reuses existing fields, not a new identity system.
 * Unknown companies are handled gracefully (no key → not grouped).
 */

import type { CanonicalLeadView } from './types';
import type { BuyingIntentProfile, DecisionStage, Interest } from './buyingIntent';
// Canonical free/public-provider list (AUTH-001 Section 5) — superset of the
// short local list this file previously carried.
import { PUBLIC_EMAIL_DOMAINS as FREE_EMAIL_DOMAINS } from '../auth/publicEmailDomains';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const leadMeta = (view: CanonicalLeadView): Record<string, unknown> => obj(obj(view.attribution.sourceMetadata).metadata);

const SENIOR_TITLE = /\b(ceo|cto|cfo|coo|cmo|founder|owner|president|vp|vice president|director|head|chief)\b/i;
const MID_TITLE = /\b(manager|lead|principal|senior|specialist|analyst|coordinator|architect)\b/i;
const STAGE_ORDER: DecisionStage[] = ['awareness', 'interest', 'evaluation', 'shortlisting', 'decision', 'customer'];

/** Deterministic prospect-company key from existing evidence. null = unknown company. */
export function resolveCompanyKey(view: CanonicalLeadView): string | null {
  const name = str(leadMeta(view).company_name);
  if (name) return name.toLowerCase();
  const email = view.identity.email;
  if (email && email.includes('@')) {
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) return domain;
  }
  return null;
}

export function resolveCompanyName(view: CanonicalLeadView): string | null {
  const name = str(leadMeta(view).company_name);
  if (name) return name;
  const key = resolveCompanyKey(view);
  return key; // domain fallback
}

export type StakeholderRole = 'decision_maker' | 'champion' | 'influencer' | 'evaluator' | 'user' | 'unknown';

export interface Stakeholder {
  contact: string;        // email / unifiedPersonId / source ref (provenance)
  role: StakeholderRole;
  title: string | null;
  intentScore: number;
  decisionStage: DecisionStage;
  reachable: boolean;
  evidence: string[];
  confidence: number;
}

export interface AccountInterest {
  interest: Interest;
  score: number;
  strength: 'strong' | 'moderate' | 'weak';
  supportingEvidence: string[];
  contributingContacts: string[];
}

export interface AccountJourney {
  firstTouch: string | null;
  latestTouch: string | null;
  activeCampaigns: string[];
  activeContent: string[];
  totalSessions: number;
  totalEngagements: number;
  timelineSummary: Array<{ contact: string; source: string; occurredAt: string | null; steps: string[] }>;
}

export type AccountMotion = 'sales' | 'crm' | 'executive_outreach' | 'multi_thread' | 'enterprise_motion';
export interface AccountReadinessItem {
  motion: AccountMotion;
  status: 'ready' | 'partial' | 'not_ready';
  blockers: string[];
  confidence: number;
}

export interface CompanyAction {
  id: string;
  label: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  targetStakeholder: string | null;
  evidence: string[];
  rationale: string;
  dependencies: string[];
}

export interface AccountSummary {
  companyKey: string;
  companyName: string | null;
  domain: string | null;
  industry: string | null;
  companySize: string | null;
  contactCount: number;
  accountIntentScore: number;
  accountStage: DecisionStage;
  topStakeholder: { contact: string; role: StakeholderRole } | null;
  topInterests: string[];
}

export interface CompanyBuyingIntent {
  score: number;
  scoreBreakdown: Array<{ label: string; points: number; source: string }>;
  evidence: string[];
  confidence: number;
  provenance: string[];
}

export interface CompanyIntelligenceProfile {
  account: AccountSummary;
  buyingIntent: CompanyBuyingIntent;
  stakeholders: { identified: Stakeholder[]; missing: StakeholderRole[]; confidence: number };
  interests: AccountInterest[];
  journey: AccountJourney;
  readiness: AccountReadinessItem[];
  actions: CompanyAction[];
  confidence: number;
  provenance: string[];
}

export interface CompanyIntelligenceSummary {
  companyKey: string;
  companyName: string | null;
  contactCount: number;
  accountIntentScore: number;
  accountStage: DecisionStage;
  topInterests: string[];
  identifiedRoles: StakeholderRole[];
  multiThreaded: boolean;
}

export interface CompanyContact { view: CanonicalLeadView; buyingIntent: BuyingIntentProfile }
export interface CompanyIntelligenceInputs { companyKey: string; companyName?: string | null; contacts: CompanyContact[]; now?: number }

const ENTERPRISE_SIZES = new Set(['501–1000', '1000+']);
const contactLabel = (view: CanonicalLeadView): string =>
  view.identity.email ?? view.identity.contactId ?? view.unifiedPersonId ?? view.sourceRef?.id ?? 'unknown contact';
const reachableOf = (view: CanonicalLeadView): boolean => !!(view.identity.email || view.identity.phone);

/* ── Stakeholder classification (deterministic; Unknown stays Unknown) ───────── */

function classifyStakeholder(c: CompanyContact): Stakeholder {
  const { view, buyingIntent: bi } = c;
  const title = str(leadMeta(view).job_title);
  const evidence: string[] = [];
  let role: StakeholderRole;
  if (title && SENIOR_TITLE.test(title)) { role = 'decision_maker'; evidence.push(`Senior title: ${title}`); }
  else if (bi.score >= 60) { role = 'champion'; evidence.push(`High individual intent (${bi.score})`); }
  else if (title && MID_TITLE.test(title)) { role = 'influencer'; evidence.push(`Mid-level title: ${title}`); }
  else if (bi.decisionStage === 'evaluation' || bi.decisionStage === 'shortlisting') { role = 'evaluator'; evidence.push(`Evaluation-stage engagement`); }
  else if (title) { role = 'user'; evidence.push(`Title: ${title}`); }
  else { role = 'unknown'; }
  const confidence = clamp(role === 'unknown' ? 30 : (title ? 80 : 55) + (bi.score >= 40 ? 10 : 0));
  return { contact: contactLabel(view), role, title, intentScore: bi.score, decisionStage: bi.decisionStage, reachable: reachableOf(view), evidence, confidence };
}

/* ── Account buying intent (aggregate, explainable) ──────────────────────────── */

function buildAccountIntent(contacts: CompanyContact[], stakeholders: Stakeholder[]): CompanyBuyingIntent {
  const sorted = [...contacts].sort((a, b) => b.buyingIntent.score - a.buyingIntent.score);
  const top = sorted[0];
  const topScore = top?.buyingIntent.score ?? 0;
  const engaged = contacts.filter((c) => c.buyingIntent.score >= 15);
  const multiThreadBonus = Math.min(20, Math.max(0, engaged.length - 1) * 8);
  const roles = new Set(stakeholders.map((s) => s.role).filter((r) => r !== 'unknown' && r !== 'user'));
  const stakeholderBonus = Math.min(15, roles.size * 5);

  const breakdown: CompanyBuyingIntent['scoreBreakdown'] = [];
  if (top) breakdown.push({ label: `Top contact intent (${contactLabel(top.view)})`, points: topScore, source: top.view.source });
  if (multiThreadBonus > 0) breakdown.push({ label: `Multi-threading (${engaged.length} engaged contacts)`, points: multiThreadBonus, source: 'account' });
  if (stakeholderBonus > 0) breakdown.push({ label: `Stakeholder coverage (${[...roles].join(', ')})`, points: stakeholderBonus, source: 'account' });

  const score = clamp(topScore + multiThreadBonus + stakeholderBonus);
  const evidence = [...new Set(contacts.flatMap((c) => c.buyingIntent.evidence.map((e) => `${contactLabel(c.view)}: ${e.label}`)))];
  const provenance = [...new Set(contacts.flatMap((c) => c.buyingIntent.provenance))].sort();
  const avgConfidence = contacts.length ? contacts.reduce((a, c) => a + c.buyingIntent.confidence, 0) / contacts.length : 0;
  const confidence = clamp(Math.round(avgConfidence) + Math.min(20, contacts.length * 5));
  return { score, scoreBreakdown: breakdown, evidence, confidence, provenance };
}

/* ── Account interests (aggregate across contacts) ───────────────────────────── */

function buildAccountInterests(contacts: CompanyContact[]): AccountInterest[] {
  const acc = new Map<Interest, { score: number; signals: Set<string>; contacts: Set<string> }>();
  for (const c of contacts) {
    for (const ip of c.buyingIntent.interestProfile) {
      const cur = acc.get(ip.interest) ?? { score: 0, signals: new Set<string>(), contacts: new Set<string>() };
      cur.score += ip.score;
      ip.signals.forEach((s) => cur.signals.add(s));
      cur.contacts.add(contactLabel(c.view));
      acc.set(ip.interest, cur);
    }
  }
  return [...acc.entries()]
    .map(([interest, v]) => ({
      interest,
      score: v.score,
      strength: (v.score >= 30 ? 'strong' : v.score >= 15 ? 'moderate' : 'weak') as AccountInterest['strength'],
      supportingEvidence: [...v.signals].slice(0, 4),
      contributingContacts: [...v.contacts],
    }))
    .sort((a, b) => b.score - a.score || a.interest.localeCompare(b.interest));
}

/* ── Account journey (merged, provenance-preserving) ─────────────────────────── */

function buildAccountJourney(contacts: CompanyContact[]): AccountJourney {
  const times = contacts.map((c) => c.view.occurredAt).filter((t): t is string => !!t).sort();
  const campaigns = new Set<string>();
  const content = new Set<string>();
  const sessionIds = new Set<string>();
  let totalEngagements = 0;
  for (const c of contacts) {
    const cmp = c.view.campaign ?? c.view.utm.campaign; if (cmp) campaigns.add(cmp);
    if (c.view.content) content.add(c.view.content);
    const sid = str(obj(c.view.attribution.sourceMetadata).visitor_session_id) ?? c.view.identity.anonymousId ?? null;
    if (sid) sessionIds.add(sid);
    totalEngagements += c.buyingIntent.evidence.length;
  }
  const timelineSummary = [...contacts]
    .sort((a, b) => Date.parse(a.view.occurredAt ?? '') - Date.parse(b.view.occurredAt ?? ''))
    .map((c) => ({ contact: contactLabel(c.view), source: c.view.sourceLabel, occurredAt: c.view.occurredAt, steps: c.buyingIntent.decisionJourney.map((s) => s.label) }));
  return {
    firstTouch: times[0] ?? null,
    latestTouch: times[times.length - 1] ?? null,
    activeCampaigns: [...campaigns],
    activeContent: [...content],
    totalSessions: sessionIds.size,
    totalEngagements,
    timelineSummary,
  };
}

/* ── Account readiness ───────────────────────────────────────────────────────── */

function buildAccountReadiness(contacts: CompanyContact[], stakeholders: Stakeholder[], score: number, companyName: string | null, enterprise: boolean, confidence: number): AccountReadinessItem[] {
  const reachable = contacts.filter((c) => reachableOf(c.view));
  const engaged = contacts.filter((c) => c.buyingIntent.score >= 15);
  const dm = stakeholders.find((s) => s.role === 'decision_maker');
  const distinctRoles = new Set(stakeholders.map((s) => s.role).filter((r) => r !== 'unknown' && r !== 'user'));

  const sales: AccountReadinessItem = {
    motion: 'sales',
    status: reachable.length > 0 && score >= 40 ? 'ready' : reachable.length > 0 ? 'partial' : 'not_ready',
    blockers: [reachable.length === 0 ? 'No reachable contact' : null, score < 40 ? `Account intent below threshold (${score})` : null].filter((x): x is string => !!x),
    confidence,
  };
  const crm: AccountReadinessItem = {
    motion: 'crm',
    status: companyName && reachable.length > 0 ? 'ready' : reachable.length > 0 ? 'partial' : 'not_ready',
    blockers: [!companyName ? 'No company name' : null, reachable.length === 0 ? 'No reachable contact' : null].filter((x): x is string => !!x),
    confidence,
  };
  const exec: AccountReadinessItem = {
    motion: 'executive_outreach',
    status: dm && dm.reachable ? 'ready' : dm ? 'partial' : 'not_ready',
    blockers: [!dm ? 'No decision-maker identified' : null, dm && !dm.reachable ? 'Decision-maker not reachable' : null].filter((x): x is string => !!x),
    confidence,
  };
  const multi: AccountReadinessItem = {
    motion: 'multi_thread',
    status: engaged.length >= 2 ? 'ready' : engaged.length === 1 ? 'partial' : 'not_ready',
    blockers: engaged.length >= 2 ? [] : [`Only ${engaged.length} engaged contact(s)`],
    confidence,
  };
  const ent: AccountReadinessItem = {
    motion: 'enterprise_motion',
    status: enterprise && distinctRoles.size >= 2 ? 'ready' : enterprise || distinctRoles.size >= 2 ? 'partial' : 'not_ready',
    blockers: [!enterprise ? 'Not an enterprise-sized company' : null, distinctRoles.size < 2 ? 'Fewer than 2 stakeholder roles mapped' : null].filter((x): x is string => !!x),
    confidence,
  };
  return [sales, crm, exec, multi, ent];
}

/* ── Account actions ─────────────────────────────────────────────────────────── */

function buildAccountActions(contacts: CompanyContact[], stakeholders: Stakeholder[], missing: StakeholderRole[], interests: AccountInterest[], enterprise: boolean, score: number): CompanyAction[] {
  const out: CompanyAction[] = [];
  const dm = stakeholders.find((s) => s.role === 'decision_maker');
  const engaged = contacts.filter((c) => c.buyingIntent.score >= 15);
  const topInterest = interests[0]?.interest ?? null;

  if (dm) out.push({ id: 'engage_decision_maker', label: 'Engage the decision maker', priority: 'high', targetStakeholder: `${dm.contact} (decision_maker)`, evidence: dm.evidence, rationale: 'A decision-maker is identified — drive the account conversation through them.', dependencies: dm.reachable ? [] : ['Obtain a reachable channel for the decision-maker'] });
  if (missing.length > 0) out.push({ id: 'map_buying_committee', label: 'Map the buying committee', priority: 'medium', targetStakeholder: null, evidence: [`Missing roles: ${missing.join(', ')}`], rationale: 'Key buying roles are not yet identified — multi-thread to de-risk the deal.', dependencies: [] });
  if (engaged.length < 2) out.push({ id: 'multi_thread', label: 'Multi-thread the account', priority: 'medium', targetStakeholder: null, evidence: [`${engaged.length} engaged contact(s)`], rationale: 'Single-threaded accounts are higher risk — engage additional stakeholders.', dependencies: [] });
  if (enterprise) out.push({ id: 'escalate_enterprise', label: 'Escalate to enterprise sales', priority: 'high', targetStakeholder: dm ? `${dm.contact} (decision_maker)` : null, evidence: ['Enterprise-sized company'], rationale: 'Enterprise account — route to an enterprise motion/AE.', dependencies: [] });
  if (topInterest) out.push({ id: 'consolidate_outreach', label: `Consolidate outreach around ${topInterest}`, priority: 'medium', targetStakeholder: null, evidence: interests[0].supportingEvidence.slice(0, 2), rationale: `The strongest shared interest across contacts is ${topInterest}.`, dependencies: [] });
  if (score < 30) out.push({ id: 'nurture_account', label: 'Nurture the account', priority: 'low', targetStakeholder: null, evidence: [`Account intent ${score}`], rationale: 'Low aggregate intent — nurture until stronger signals appear.', dependencies: [] });

  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return out.sort((a, b) => order[a.priority] - order[b.priority] || a.id.localeCompare(b.id));
}

/* ── Public builder ──────────────────────────────────────────────────────────── */

export function buildCompanyIntelligence(inputs: CompanyIntelligenceInputs): CompanyIntelligenceProfile {
  const contacts = inputs.contacts;
  const first = contacts[0]?.view;
  const meta = first ? leadMeta(first) : {};
  const companyName = inputs.companyName ?? (first ? resolveCompanyName(first) : null);
  const domain = inputs.companyKey.includes('.') && !inputs.companyKey.includes(' ') ? inputs.companyKey : null;
  const companySize = str(meta.company_size);
  const enterprise = ENTERPRISE_SIZES.has(companySize ?? '');

  const stakeholderList = contacts.map(classifyStakeholder).sort((a, b) => b.intentScore - a.intentScore);
  const intent = buildAccountIntent(contacts, stakeholderList);
  const interests = buildAccountInterests(contacts);
  const journey = buildAccountJourney(contacts);

  const REQUIRED: StakeholderRole[] = ['decision_maker', 'champion', 'influencer', 'evaluator'];
  const presentRoles = new Set(stakeholderList.map((s) => s.role));
  const missing = REQUIRED.filter((r) => !presentRoles.has(r));
  const stakeholderConfidence = clamp(contacts.length ? Math.round(stakeholderList.reduce((a, s) => a + s.confidence, 0) / stakeholderList.length) : 0);

  const readiness = buildAccountReadiness(contacts, stakeholderList, intent.score, companyName, enterprise, intent.confidence);
  const actions = buildAccountActions(contacts, stakeholderList, missing, interests, enterprise, intent.score);

  const accountStage = STAGE_ORDER[Math.max(0, ...contacts.map((c) => STAGE_ORDER.indexOf(c.buyingIntent.decisionStage)))];
  const top = stakeholderList[0] ?? null;

  const account: AccountSummary = {
    companyKey: inputs.companyKey,
    companyName,
    domain,
    industry: str(meta.industry),
    companySize,
    contactCount: contacts.length,
    accountIntentScore: intent.score,
    accountStage,
    topStakeholder: top ? { contact: top.contact, role: top.role } : null,
    topInterests: interests.slice(0, 5).map((i) => i.interest),
  };

  const provenance = [...new Set([`company:${inputs.companyKey}`, ...intent.provenance])];
  const confidence = intent.confidence;

  return {
    account,
    buyingIntent: intent,
    stakeholders: { identified: stakeholderList, missing, confidence: stakeholderConfidence },
    interests,
    journey,
    readiness,
    actions,
    confidence,
    provenance,
  };
}

export function summarizeCompanyIntelligence(profile: CompanyIntelligenceProfile): CompanyIntelligenceSummary {
  return {
    companyKey: profile.account.companyKey,
    companyName: profile.account.companyName,
    contactCount: profile.account.contactCount,
    accountIntentScore: profile.account.accountIntentScore,
    accountStage: profile.account.accountStage,
    topInterests: profile.account.topInterests,
    identifiedRoles: [...new Set(profile.stakeholders.identified.map((s) => s.role).filter((r) => r !== 'unknown'))],
    multiThreaded: profile.account.contactCount >= 2,
  };
}
