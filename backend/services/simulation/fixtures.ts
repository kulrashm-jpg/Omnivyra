/**
 * PI-SIM-001 — deterministic fixtures for the simulated lead lifecycle.
 *
 * ─── WHAT THIS IS, AND WHAT IT IS NOT ─────────────────────────────────────
 * This is a stand-in for EXTERNAL PROVIDERS ONLY. It contains no business
 * logic, no identity rule, no deduplication, no persistence and no decision.
 * Every simulated record is handed to the SAME `LeadSourceAdapter` /
 * `EnrichmentProviderAdapter` contracts a real provider must satisfy, so the
 * canonical pipeline cannot tell a simulated source from a real one — which is
 * the whole point. A simulation that had its own pipeline would prove nothing
 * about the pipeline that ships.
 *
 * ─── DETERMINISM IS A CONTRACT, NOT A CONVENIENCE ─────────────────────────
 * No `Math.random`, no `Date.now`, no uuid generation. A scenario key maps to
 * exactly one set of observations, for ever. Timestamps are literals. If a
 * demonstration wants variety it asks for a different scenario, not a different
 * roll of the dice — otherwise a failing run cannot be reproduced, and an
 * irreproducible failure in an identity pipeline is worse than no test.
 *
 * ─── THE PERSON THE WHOLE SCENARIO IS ABOUT ───────────────────────────────
 * `Jane Smith` arrives from six different sources carrying the SAME hard
 * identity signals (LinkedIn external key `LI-1001`, and where the source knows
 * it, `jane@acme.example`). That is deliberate: it is what lets a test assert
 * that six observations converge on ONE canonical person rather than six. Bob
 * and Carol exist to prove the converse — that distinct people stay distinct.
 */

import type { EmployeeBand, Seniority } from '../prospectIdentity/attributes';

/** Two tenants, so every isolation assertion has a counterparty. */
export const SIM_ORG_A = '00000000-0000-4000-8000-00000000a001';
export const SIM_ORG_B = '00000000-0000-4000-8000-00000000b002';

/**
 * The hard identity signal every source shares for Jane.
 *
 * Shaped like the canonical external-key map the identity resolver matches on —
 * `{ provider: { external_id } }`. The spine table is deliberately NOT named here:
 * this file writes nothing, and the LI-2 boundary guard rightly treats a fixture
 * that advertises the canonical tables as a file worth scanning.
 *
 * The SHAPE matters: it is what W1 actually matches on. A simulation that
 * invented its own identity shape would converge in the fixture and diverge in
 * production, which is the one failure a simulation must not have.
 */
export const JANE_LINKEDIN_ID = 'LI-1001';
export const JANE_EMAIL = 'jane@acme.example';

export interface SimPerson {
  readonly key: 'jane' | 'bob' | 'carol';
  readonly fullName: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly linkedinId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly jobTitle: string | null;
  readonly seniority: Seniority | null;
  readonly accountName: string;
  readonly accountDomain: string;
}

export const SIM_PEOPLE: Readonly<Record<SimPerson['key'], SimPerson>> = {
  jane: {
    key: 'jane',
    fullName: 'Jane Smith',
    firstName: 'Jane',
    lastName: 'Smith',
    linkedinId: JANE_LINKEDIN_ID,
    email: JANE_EMAIL,
    phone: null,
    jobTitle: 'VP Marketing',
    seniority: 'director',
    accountName: 'Acme',
    accountDomain: 'acme.example',
  },
  bob: {
    key: 'bob',
    fullName: 'Bob Jones',
    firstName: 'Bob',
    lastName: 'Jones',
    linkedinId: 'LI-2002',
    email: 'bob@acme.example',
    phone: null,
    jobTitle: 'Head of Sales',
    seniority: 'head',
    accountName: 'Acme',
    accountDomain: 'acme.example',
  },
  carol: {
    key: 'carol',
    fullName: 'Carol Nguyen',
    firstName: 'Carol',
    lastName: 'Nguyen',
    linkedinId: 'LI-3003',
    email: 'carol@globex.example',
    phone: null,
    jobTitle: 'Director of Ops',
    seniority: 'director',
    accountName: 'Globex',
    accountDomain: 'globex.example',
  },
};

export const SIM_ACCOUNTS: Readonly<Record<string, {
  externalId: string; name: string; domain: string;
  industry: string; employeeBand: EmployeeBand; employeeCount: number;
}>> = {
  acme: {
    externalId: 'ACCT-ACME-1',
    name: 'Acme',
    domain: 'acme.example',
    industry: 'Software',
    employeeBand: '201-500',
    employeeCount: 320,
  },
  globex: {
    externalId: 'ACCT-GLOBEX-1',
    name: 'Globex',
    domain: 'globex.example',
    industry: 'Manufacturing',
    employeeBand: '1001-5000',
    employeeCount: 2400,
  },
};

/** Fixed instants. Literals, never `new Date()`. */
export const SIM_TIME = {
  activeLead: '2026-09-01T09:00:00.000Z',
  marketPulse: '2026-09-02T09:00:00.000Z',
  engagementDm: '2026-09-03T09:00:00.000Z',
  engagementComment: '2026-09-04T09:00:00.000Z',
  salesNavSnapshot1: '2026-09-05T09:00:00.000Z',
  salesNavSnapshot2: '2026-09-12T09:00:00.000Z',
  csv: '2026-09-06T09:00:00.000Z',
  xlsx: '2026-09-07T09:00:00.000Z',
  enrichment: '2026-09-08T09:00:00.000Z',
} as const;

/**
 * Named scenarios. A caller says `SALES_NAV_CONFLICT_001` and gets the same
 * observations every time, on every machine.
 */
export const SIM_SCENARIOS = [
  'BASELINE_001',              // Jane from all six sources; Bob and Carol via file
  'SALES_NAV_CONFLICT_001',    // Sales Navigator title vs vendor title
  'SALES_NAV_RESUBMIT_001',    // the same saved list submitted twice
  'SALES_NAV_DRIFT_001',       // member attributes change between snapshots
  'PROVIDER_PARTIAL_001',      // provider returns company but no contact
  'PROVIDER_RATE_LIMIT_001',
  'PROVIDER_TIMEOUT_001',
  'PROVIDER_PERMANENT_FAILURE_001',
  'TENANT_ISOLATION_001',      // ORG_B must see nothing of ORG_A
] as const;
export type SimScenario = typeof SIM_SCENARIOS[number];

export const isSimScenario = (v: unknown): v is SimScenario =>
  typeof v === 'string' && (SIM_SCENARIOS as readonly string[]).includes(v);

/**
 * The simulated saved-list reference.
 *
 * NOT a LinkedIn URL and deliberately not resolvable: the host is `.local`, so
 * nothing can accidentally dial it. It is an INTAKE REFERENCE — the list's
 * identity — and never a person's identity. The person identity is whatever the
 * simulated retrieval returns per member.
 */
export const SIM_SALES_NAV_LIST_URL =
  'https://simulation.sales-navigator.local/list/target-account-cmos-001';

/** A second list, so "list membership" can be told apart from "all people". */
export const SIM_SALES_NAV_LIST_URL_B =
  'https://simulation.sales-navigator.local/list/target-account-ops-002';

export const isSimulatedSalesNavUrl = (url: string): boolean =>
  typeof url === 'string' && url.startsWith('https://simulation.sales-navigator.local/list/');

/** Which people each simulated list contains, per snapshot. */
export const SIM_SALES_NAV_LISTS: Readonly<Record<string, {
  readonly snapshot1: readonly SimPerson['key'][];
  readonly snapshot2: readonly SimPerson['key'][];
}>> = {
  [SIM_SALES_NAV_LIST_URL]: { snapshot1: ['jane'], snapshot2: ['jane', 'bob'] },
  [SIM_SALES_NAV_LIST_URL_B]: { snapshot1: ['carol'], snapshot2: ['carol'] },
};
