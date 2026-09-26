/**
 * PI-SIM-001 — simulated LEAD SOURCES.
 *
 * Every simulator here implements `LeadSourceAdapter` — the same contract a
 * real Apollo, Sales Navigator or CRM adapter must implement — and does nothing
 * else. `translate` is pure: no network, no database, no identity rule, no
 * deduplication. The canonical orchestrator persists; these translate. That
 * separation is what makes a simulator swappable for a real adapter without the
 * pipeline noticing, which is the entire objective.
 *
 * ─── WHY THESE ARE NOT REGISTERED AT IMPORT ───────────────────────────────
 * `registerSimulationSources()` must be called explicitly and refuses outside a
 * simulation-enabled environment. A simulated source silently registered in a
 * production process would be a fabricated prospect source, which is worse than
 * no simulator at all.
 *
 * ─── SOURCE KEYS ARE NAMESPACED ───────────────────────────────────────────
 * Every key carries a `-sim` suffix. `source_records.provider` is free text, so
 * a simulated observation is permanently distinguishable from a real one in the
 * evidence store — a row can never be mistaken for something a vendor said.
 *
 * ─── MARKETPULSE, STATED PLAINLY ──────────────────────────────────────────
 * `marketpulse-person-sim` represents the PROPOSED future behaviour of
 * MarketPulse as a person source. The production contract today defines
 * MarketPulse as TENANT-LEVEL market intelligence, not a person source
 * (`accountIntelligence.ts`: "MARKETPULSE STAYS TENANT-LEVEL"). This simulator
 * does not change that contract and must not be read as establishing it.
 *
 * ─── SALES NAVIGATOR, STATED PLAINLY ──────────────────────────────────────
 * `salesnav-sim` simulates RETRIEVAL ONLY. There is no scraping, no browser
 * automation, no credential and no LinkedIn call — the simulated list host is
 * `.local` and unroutable. The real connector remains blocked on OAuth and
 * provider-terms review, which `dataSourceCatalogue` records as unmet.
 */

import type {
  AdapterResult, LeadSourceAdapter, NormalizedIngestionRecord,
} from '../leadIngestion/contracts';
import type { ManualLeadInput } from '../leadIngestion/adapters/manualAdapter';
import {
  SIM_ACCOUNTS, SIM_PEOPLE, SIM_TIME, SIM_SALES_NAV_LISTS,
  isSimulatedSalesNavUrl, type SimPerson,
} from './fixtures';

/** Simulation runs only where it is explicitly allowed. */
export function simulationEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  const raw = String(process.env.ENABLE_PI_SIMULATION ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export class SimulationDisabledError extends Error {
  constructor() {
    super('PI simulation is not enabled in this environment (set ENABLE_PI_SIMULATION)');
    this.name = 'SimulationDisabledError';
  }
}

export const SIM_SOURCES = {
  activeLeads: 'active-leads-sim',
  marketPulse: 'marketpulse-person-sim',
  engagementDm: 'engagement-dm-sim',
  engagementComment: 'engagement-comment-sim',
  salesNav: 'salesnav-sim',
} as const;

// ── shared translation helpers ──────────────────────────────────────────────

/**
 * Build the person half. `externalKeys` carries the LinkedIn identity under the
 * SAME `linkedin` namespace for every source, which is precisely what lets six
 * observations converge on one person instead of six.
 */
function personOf(p: SimPerson, opts: {
  withEmail?: boolean; withPhone?: boolean; jobTitle?: string | null;
} = {}) {
  return {
    fullName: p.fullName,
    firstName: p.firstName,
    lastName: p.lastName,
    email: opts.withEmail === false ? null : p.email,
    phone: opts.withPhone ? p.phone : null,
    jobTitle: opts.jobTitle === undefined ? p.jobTitle : opts.jobTitle,
    seniority: p.seniority,
    externalKeys: p.linkedinId ? { linkedin: { external_id: p.linkedinId } } : null,
  };
}

function accountOf(p: SimPerson) {
  const a = p.accountName === 'Acme' ? SIM_ACCOUNTS.acme : SIM_ACCOUNTS.globex;
  return {
    externalId: a.externalId,
    name: a.name,
    domain: a.domain,
    industry: a.industry,
    employeeBand: a.employeeBand,
    employeeCount: a.employeeCount,
  };
}

const record = (
  organizationId: string, source: string, externalId: string,
  p: SimPerson, observedAt: string, confidence: number,
  opts: Parameters<typeof personOf>[1] = {},
): NormalizedIngestionRecord => ({
  organizationId,
  source,
  entityType: 'person',
  externalId,
  person: personOf(p, opts),
  account: accountOf(p),
  observedAt,
  confidence,
});

/** A simulated raw payload. Deliberately shaped unlike the normalized record. */
const rawOf = (p: SimPerson, extra: Record<string, unknown>) => ({
  sim: true,
  person_name: p.fullName,
  linkedin_id: p.linkedinId,
  ...extra,
});

// ── 1. Active Leads ─────────────────────────────────────────────────────────

export const activeLeadsSimAdapter: LeadSourceAdapter = {
  source: SIM_SOURCES.activeLeads,
  label: 'Active Leads (simulated)',
  capabilities: ['person_discovery', 'account_discovery'],
  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult {
    const key = String(raw.personKey ?? '') as SimPerson['key'];
    const p = SIM_PEOPLE[key];
    if (!p) throw new Error(`unknown simulated person '${String(raw.personKey)}'`);
    return {
      raw,
      normalized: record(
        organizationId, SIM_SOURCES.activeLeads, `active-lead:${p.key}`,
        p, SIM_TIME.activeLead, 0.6,
      ),
    };
  },
};

export const simulatedActiveLeadRecords = (keys: readonly SimPerson['key'][]) =>
  keys.map((k) => rawOf(SIM_PEOPLE[k], {
    personKey: k, captured_at: SIM_TIME.activeLead, channel: 'website_form',
  }));

// ── 2. MarketPulse (EXPERIMENTAL person-source simulation) ──────────────────

export const marketPulsePersonSimAdapter: LeadSourceAdapter = {
  source: SIM_SOURCES.marketPulse,
  label: 'MarketPulse person observations (SIMULATED — proposed behaviour)',
  capabilities: ['person_discovery'],
  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult {
    const key = String(raw.personKey ?? '') as SimPerson['key'];
    const p = SIM_PEOPLE[key];
    if (!p) throw new Error(`unknown simulated person '${String(raw.personKey)}'`);
    return {
      raw,
      normalized: record(
        organizationId, SIM_SOURCES.marketPulse, `marketpulse:${p.key}`,
        // MarketPulse is a market signal: it knows the person and employer but
        // not their contact details. Modelled as such rather than as a full row.
        p, SIM_TIME.marketPulse, 0.4, { withEmail: false },
      ),
    };
  },
};

export const simulatedMarketPulseRecords = (keys: readonly SimPerson['key'][]) =>
  keys.map((k) => rawOf(SIM_PEOPLE[k], {
    personKey: k, signal: 'hiring_intent', observed_at: SIM_TIME.marketPulse,
  }));

// ── 3/4. Engagement — DMs and comments ──────────────────────────────────────

const engagementAdapter = (
  source: string, label: string, observedAt: string, prefix: string,
): LeadSourceAdapter => ({
  source,
  label,
  capabilities: ['person_discovery'],
  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult {
    const key = String(raw.personKey ?? '') as SimPerson['key'];
    const p = SIM_PEOPLE[key];
    if (!p) throw new Error(`unknown simulated person '${String(raw.personKey)}'`);
    return {
      raw,
      normalized: {
        ...record(organizationId, source, `${prefix}:${p.key}`, p, observedAt, 0.5, {
          withEmail: false,
          // An engagement surface shows a headline, not a verified job title.
          // The production bridge refuses that mapping for the same reason, so
          // the simulator refuses it too rather than inventing stronger
          // evidence than the real channel could ever supply.
          jobTitle: null,
        }),
        // Engagement identifies a person; it does not establish their employer.
        account: null,
      },
    };
  },
});

export const engagementDmSimAdapter = engagementAdapter(
  SIM_SOURCES.engagementDm, 'Engagement / direct message (simulated)',
  SIM_TIME.engagementDm, 'engagement-dm',
);

export const engagementCommentSimAdapter = engagementAdapter(
  SIM_SOURCES.engagementComment, 'Engagement / comment (simulated)',
  SIM_TIME.engagementComment, 'engagement-comment',
);

export const simulatedEngagementDmRecords = (keys: readonly SimPerson['key'][]) =>
  keys.map((k) => rawOf(SIM_PEOPLE[k], {
    personKey: k, conversation_id: `CONV-${k}-1`, message: 'Thanks for reaching out.',
    observed_at: SIM_TIME.engagementDm,
  }));

export const simulatedEngagementCommentRecords = (keys: readonly SimPerson['key'][]) =>
  keys.map((k) => rawOf(SIM_PEOPLE[k], {
    personKey: k, post_id: 'POST-777', comment: 'Useful breakdown.',
    observed_at: SIM_TIME.engagementComment,
  }));

// ── 5. Sales Navigator (SIMULATED RETRIEVAL ONLY) ───────────────────────────

export class SimulatedListUrlError extends Error {
  constructor(url: string) {
    super(`'${url}' is not a simulated Sales Navigator list reference`);
    this.name = 'SimulatedListUrlError';
  }
}

export interface SimSalesNavPage {
  readonly listUrl: string;
  readonly snapshot: 1 | 2;
  readonly page: number;
  readonly pageSize: number;
  readonly members: readonly Record<string, unknown>[];
  readonly nextPage: number | null;
  readonly totalMembers: number;
}

/**
 * Simulated retrieval of a saved list.
 *
 * The URL is validated as a SIMULATION reference and is never dialled. It is
 * the intake reference — the list's identity — and is deliberately NOT used as
 * any person's identity; each member carries its own source identity, which is
 * what makes a re-submission idempotent rather than duplicating anybody.
 */
export function retrieveSimulatedSalesNavList(opts: {
  listUrl: string; snapshot?: 1 | 2; page?: number; pageSize?: number;
}): SimSalesNavPage {
  const { listUrl } = opts;
  if (!isSimulatedSalesNavUrl(listUrl)) throw new SimulatedListUrlError(listUrl);
  const list = SIM_SALES_NAV_LISTS[listUrl];
  if (!list) throw new SimulatedListUrlError(listUrl);

  const snapshot = opts.snapshot ?? 1;
  const pageSize = opts.pageSize ?? 25;
  const page = opts.page ?? 1;
  const keys = snapshot === 1 ? list.snapshot1 : list.snapshot2;

  const start = (page - 1) * pageSize;
  const slice = keys.slice(start, start + pageSize);
  const observedAt = snapshot === 1 ? SIM_TIME.salesNavSnapshot1 : SIM_TIME.salesNavSnapshot2;

  const members = slice.map((k) => {
    const p = SIM_PEOPLE[k];
    return rawOf(p, {
      personKey: k,
      list_url: listUrl,
      snapshot,
      observed_at: observedAt,
      // Snapshot 2 shows attribute drift for Jane: the same person, a new title.
      title: snapshot === 2 && k === 'jane' ? 'SVP Marketing' : p.jobTitle,
    });
  });

  return {
    listUrl,
    snapshot,
    page,
    pageSize,
    members,
    nextPage: start + pageSize < keys.length ? page + 1 : null,
    totalMembers: keys.length,
  };
}

export const salesNavSimAdapter: LeadSourceAdapter = {
  source: SIM_SOURCES.salesNav,
  label: 'LinkedIn Sales Navigator saved list (SIMULATED)',
  capabilities: ['person_discovery', 'account_discovery', 'bulk_fetch'],
  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult {
    const key = String(raw.personKey ?? '') as SimPerson['key'];
    const p = SIM_PEOPLE[key];
    if (!p) throw new Error(`unknown simulated person '${String(raw.personKey)}'`);
    const title = typeof raw.title === 'string' ? raw.title : p.jobTitle;
    const observedAt = typeof raw.observed_at === 'string'
      ? raw.observed_at : SIM_TIME.salesNavSnapshot1;
    return {
      raw,
      normalized: record(
        organizationId, SIM_SOURCES.salesNav,
        // The MEMBER identity, not the list URL. A person in two lists is one
        // person; the same person re-retrieved is the same external id.
        `salesnav:${p.linkedinId ?? p.key}`,
        p, observedAt, 0.9, { jobTitle: title, withEmail: false },
      ),
    };
  },
};

// ── 6/7. CSV and XLSX rows ──────────────────────────────────────────────────

/**
 * Rows for the EXISTING `csvAdapter`, which is labelled "CSV / Excel import"
 * and takes already-parsed rows by approved design — the file never reaches the
 * server. So XLSX and CSV are the same server contract here, and no
 * server-side spreadsheet parser is introduced for simulation.
 */
export const simulatedSpreadsheetRows = (
  organizationId: string, keys: readonly SimPerson['key'][], observedAt: string,
): ManualLeadInput[] => keys.map((k) => {
  const p = SIM_PEOPLE[k];
  return {
    organizationId,
    referenceId: `${p.linkedinId ?? p.key}`,
    fullName: p.fullName,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    jobTitle: p.jobTitle,
    companyName: p.accountName,
    companyDomain: p.accountDomain,
    observedAt,
  };
});

export const simulatedCsvRows = (organizationId: string, keys: readonly SimPerson['key'][]) =>
  simulatedSpreadsheetRows(organizationId, keys, SIM_TIME.csv);

export const simulatedXlsxRows = (organizationId: string, keys: readonly SimPerson['key'][]) =>
  simulatedSpreadsheetRows(organizationId, keys, SIM_TIME.xlsx);

// ── registration ────────────────────────────────────────────────────────────

export const SIMULATION_SOURCE_ADAPTERS: readonly LeadSourceAdapter[] = [
  activeLeadsSimAdapter,
  marketPulsePersonSimAdapter,
  engagementDmSimAdapter,
  engagementCommentSimAdapter,
  salesNavSimAdapter,
];

/**
 * Register the simulated sources with the real LI-4D registry.
 *
 * Refuses outside a simulation-enabled environment. The caller passes the
 * registrar so this module never imports the registry directly — keeping the
 * simulation layer a leaf that production code cannot accidentally depend on.
 */
export function registerSimulationSources(
  register: (adapter: LeadSourceAdapter) => void,
): readonly string[] {
  if (!simulationEnabled()) throw new SimulationDisabledError();
  for (const a of SIMULATION_SOURCE_ADAPTERS) register(a);
  return SIMULATION_SOURCE_ADAPTERS.map((a) => a.source);
}
