/**
 * WS-7 (BR-24 / FR-04 · FR-21 · FR-22 · FR-23) — Account Intelligence.
 *
 * The manifest's entity table names this row "aggregation over
 * `prospect_accounts` + `market_pulse_*` + engagement", tenant-scoped, and
 * marks it REQUIRED — NOT YET IMPLEMENTED. This is that aggregation.
 *
 * The Account is the point at which intelligence shared by several Prospects
 * stops being copied. Three people at one company produce three Prospects and
 * ONE set of firmographics; without an aggregation point each Prospect would
 * carry its own copy of the same company facts, and they would diverge.
 *
 * ─── IT DERIVES. IT STORES NOTHING. ───────────────────────────────────────
 * There is no `account_intelligence` table and this module creates none. The
 * manifest assigns WS-7 an aggregation, and — alone among the entity rows —
 * names no key and no table for it, because every input already has a durable
 * canonical home with its own writer:
 *
 *   `prospect_accounts`   firmographics, written ONLY by LI-2's boundary
 *   `source_assertions`   the evidence behind each of them
 *   `unified_persons`     the contact roster and its buying roles
 *   `canonical_leads`     the Prospects pursuing this Account
 *   `engagement_threads`  the conversation record (WS-5 writes it)
 *   `market_pulse_*`      tenant market intelligence (WS-3 reads it)
 *
 * A stored aggregate would be a second, unarbitrated copy of facts LI-2 already
 * arbitrates, and it would go stale the moment any input changed. Deriving on
 * read also makes idempotency structural rather than something to enforce: a
 * pure read repeated twice cannot duplicate anything. No migration is required
 * and none is authored.
 *
 * ─── THE SIX QUALITY DIMENSIONS STAY SIX ──────────────────────────────────
 * `completeness`, `confidence`, `freshness`, `provenance` and `consistency` are
 * reported separately and never combined into a score. The sixth —
 * ACTIONABILITY — is deliberately absent: the manifest assigns it to WS-8
 * (readiness + suppression), and an account aggregator that emitted one would
 * be a second readiness authority. A test asserts its absence.
 *
 * ─── CONSISTENCY IS LI-2'S VERDICT, NOT A SECOND OPINION ──────────────────
 * Disagreement is decided by `decideCanonicalUpdates` — LI-2's own pure
 * function — rather than re-derived here. It is called with an EMPTY canonical
 * row on purpose: RULE C (never overwrite) would otherwise mask RULE B behind
 * `canonical_value_already_set`, and WS-7's question is "do the sources
 * disagree?", which is a different question from "may we write?".
 *
 * ─── MARKETPULSE STAYS TENANT-LEVEL ───────────────────────────────────────
 * WS-3 established that `market_pulse_*` is intelligence about the TENANT'S
 * market, never about an external company. It is carried here under its own
 * key, typed with `subject: 'tenant_market'`, and it is structurally incapable
 * of reaching `attributes`: the two are built from different sources and never
 * merged. A tenant's scan region is not this company's geography, and a test
 * pins that no account attribute can be sourced from MarketPulse.
 *
 * ─── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
 * It resolves no account (WS-1 owns `accountResolution` and the identity
 * rules), scores nothing (WS-6), recommends nothing (WS-8), writes no signal
 * (WS-5) and ratifies no ICP (WS-6). It reports observed facts and who
 * observed them.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { ACCOUNT_ATTRIBUTE_COLUMNS } from './attributes';
import { decideCanonicalUpdates } from './ingestionBoundary';
import {
  readTenantMarketContext,
  type MarketContext,
  type MarketContextInput,
} from '../marketPulse/prospectIntelligence';

/** Bumped when the aggregation contract changes, so a caller traces its answer. */
export const ACCOUNT_INTELLIGENCE_VERSION = 'ws7.1';

/**
 * Provenance columns carry WHO said it, not a fact about the company, so they
 * are excluded from the fact surface — the same exclusion WS-2's seam applies.
 */
const PROVENANCE_COLUMNS = new Set(['attributes_source', 'attributes_updated_at']);

/** The company facts an Account can hold. Derived, so it cannot drift from LI-1. */
export const ACCOUNT_FACT_COLUMNS: readonly string[] =
  ACCOUNT_ATTRIBUTE_COLUMNS.filter((c) => !PROVENANCE_COLUMNS.has(c));

// ─────────────────────────────────────────────────────────────────────────────
// Rows, as the ports hand them back — column names verbatim.
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountRow {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string | null;
  readonly domain_normalized: string | null;
  readonly status: string | null;
  readonly merged_into_id: string | null;
  readonly confidence: number | null;
  readonly first_seen_at: string | null;
  readonly last_verified_at: string | null;
  readonly attributes_source: string | null;
  readonly attributes_updated_at: string | null;
  readonly [column: string]: unknown;
}

/**
 * The person columns the roster carries — a SUBSET of LI-1's person surface,
 * declared once so the select list, the row shape and the mapping cannot drift.
 *
 * Deliberately a list rather than an interface with one field per column.
 * Restating LI-1's columns as named fields would duplicate its contract, and
 * LI-2's boundary guard flags exactly that shape: a file that names spine
 * columns beside a spine table looks like a second writer, whether or not it
 * is one. Deriving from a list keeps the read honest AND keeps the guard sharp.
 */
export const CONTACT_COLUMNS = [
  'job_title', 'department', 'seniority',
  // FR-21. Free text for two of them; `buying_role` is a closed vocabulary,
  // enforced by the database CHECK and mirrored in WS-6/7's contract.
  'authority', 'influence', 'buying_role',
] as const;
export type ContactColumn = typeof CONTACT_COLUMNS[number];

export type PersonRow = { readonly id: string }
  & Readonly<Partial<Record<ContactColumn, unknown>>>;

export interface ProspectRow {
  readonly id: string;
  readonly unified_person_id: string | null;
  readonly source: string | null;
  readonly created_at: string | null;
}

export interface AssertionRow {
  readonly id: string;
  readonly attribute: string;
  readonly normalized_value: string | null;
  readonly provider: string | null;
  readonly confidence: number | null;
  readonly observed_at: string | null;
  readonly source_record_id: string | null;
}

export interface EngagementThreadRow {
  readonly id: string;
  readonly unified_person_id: string | null;
  readonly updated_at: string | null;
  readonly created_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The aggregate.
// ─────────────────────────────────────────────────────────────────────────────

/** One company fact, with the evidence that produced it. */
export interface AccountFact {
  readonly attribute: string;
  /** The CANONICAL value — LI-2 arbitrated it. Never taken from an assertion. */
  readonly value: unknown;
  /** Always `observed`: a company fact someone asserted, not a derivation. */
  readonly kind: 'observed';
  readonly provenance: readonly {
    readonly provider: string | null;
    readonly sourceRecordId: string | null;
    readonly observedAt: string | null;
    readonly confidence: number | null;
  }[];
  /**
   * `uncontested` — the live evidence agrees (LI-2 RULE A).
   * `sources_disagree` — LI-2 RULE B; the value stays whatever it already was.
   * `unattested` — a value with no live assertion behind it (pre-LI-2 data).
   * `unknown` — no value and no evidence. Absence, reported as absence.
   */
  readonly consistency: 'uncontested' | 'sources_disagree' | 'unattested' | 'unknown';
}

/** One person at this Account. FR-23 multi-contact; FR-21 buying roles. */
export interface AccountContact {
  readonly personId: string;
  /** LI-1's person attributes, keyed by their canonical column names. */
  readonly attributes: Readonly<Record<ContactColumn, string | null>>;
  /** The Prospects pursuing this person. Several are normal, not a duplicate. */
  readonly prospectIds: readonly string[];
}

export interface AccountIntelligence {
  readonly version: string;
  readonly organizationId: string;
  readonly accountId: string;
  readonly reason: string;

  readonly account: {
    readonly id: string;
    readonly name: string | null;
    readonly domain: string | null;
    readonly status: string | null;
    /** Set when this Account was merged away; its intelligence lives there. */
    readonly mergedIntoId: string | null;
    readonly firstSeenAt: string | null;
    readonly lastVerifiedAt: string | null;
  };

  readonly facts: readonly AccountFact[];

  /** COMPLETENESS — counts and names, never a score. */
  readonly completeness: {
    readonly known: number;
    readonly total: number;
    readonly missing: readonly string[];
  };
  /** CONFIDENCE — the Account's own, and each attribute's, kept apart. */
  readonly confidence: {
    readonly account: number | null;
    readonly byAttribute: Readonly<Record<string, number | null>>;
  };
  /** FRESHNESS — when the facts were last written, and how old that is. */
  readonly freshness: {
    readonly attributesUpdatedAt: string | null;
    readonly ageDays: number | null;
    /** Null means NO POLICY WAS SUPPLIED — not "fresh". */
    readonly stale: boolean | null;
  };
  /** PROVENANCE — who contributed, and which evidence records. */
  readonly provenance: {
    readonly attributesSource: string | null;
    readonly providers: readonly string[];
    readonly sourceRecordIds: readonly string[];
  };
  /** CONSISTENCY — LI-2's RULE B verdict, not a second opinion. */
  readonly consistency: {
    readonly contested: readonly string[];
    readonly unattested: readonly string[];
  };
  // ACTIONABILITY is intentionally absent — WS-8 owns it.

  readonly contacts: readonly AccountContact[];
  readonly prospects: readonly {
    readonly prospectId: string;
    readonly personId: string | null;
    readonly source: string | null;
    readonly createdAt: string | null;
  }[];
  readonly engagement: {
    readonly threadCount: number;
    readonly personsEngaged: number;
    readonly lastActivityAt: string | null;
  };

  /**
   * TENANT market intelligence. Not evidence about this company, and typed so
   * it cannot be mistaken for it. Present only when the caller asked for it.
   */
  readonly marketContext: {
    readonly subject: 'tenant_market';
    readonly context: MarketContext;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Everything WS-7 reads. One port; exactly one place names a table. */
export interface AccountIntelligencePorts {
  loadAccount(organizationId: string, accountId: string): Promise<AccountRow | null>;
  loadContacts(organizationId: string, accountId: string): Promise<readonly PersonRow[]>;
  loadProspects(organizationId: string, personIds: readonly string[]): Promise<readonly ProspectRow[]>;
  loadAssertions(organizationId: string, accountId: string): Promise<readonly AssertionRow[]>;
  loadEngagement(organizationId: string, personIds: readonly string[]): Promise<readonly EngagementThreadRow[]>;
  /** WS-3's read-only seam, injected so WS-7 owns no MarketPulse access. */
  loadMarketContext(input: MarketContextInput): Promise<MarketContext>;
}

export interface AccountIntelligenceInput {
  /** TENANT. Explicit, never ambient — a context pointer is not a credential. */
  readonly organizationId: string;
  readonly accountId: string;
  /** Include tenant market context. Off by default: it is an extra read. */
  readonly includeMarketContext?: boolean;
  /** Caller policy for attribute freshness. Absent means age is reported only. */
  readonly stalenessDays?: number;
  /** Injected. The only source of "now". */
  readonly now: string;
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/**
 * `null`, `undefined` and `''` stay null. `Number(null)` is 0, and a confidence
 * nobody recorded must never arrive as a confident zero.
 */
const numberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const daysBetween = (from: string | null, to: string): number | null => {
  if (!from) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
};

const latest = (times: Array<string | null>): string | null => {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const t of times) {
    if (!t) continue;
    const ms = Date.parse(t);
    if (!Number.isFinite(ms) || ms <= bestMs) continue;
    best = t; bestMs = ms;
  }
  return best;
};

/**
 * The default ports. The ONLY place in WS-7 that names a table.
 *
 * Every read carries the tenant column explicitly. The person-keyed reads
 * (`loadProspects`, `loadEngagement`) filter on the tenant AS WELL AS the
 * person ids: the ids come from a tenant-scoped roster, but relying on that
 * would make the boundary depend on a previous query being correct rather than
 * on this one being scoped.
 */
export const defaultAccountIntelligencePorts: AccountIntelligencePorts = {
  async loadAccount(organizationId: string, accountId: string): Promise<AccountRow | null> {
    const { data, error } = await ownedDbTable('prospect_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('organization_id', organizationId)      // tenant boundary — never optional
      .maybeSingle();
    if (error) throw new Error(`prospect_accounts read failed: ${error.message}`);
    return (data as AccountRow | null) ?? null;
  },

  async loadContacts(organizationId: string, accountId: string): Promise<readonly PersonRow[]> {
    const { data, error } = await ownedDbTable('unified_persons')
      // Built from the same list the mapping reads, so the two cannot diverge.
      .select(['id', ...CONTACT_COLUMNS].join(', '))
      .eq('company_id', organizationId)           // tenant boundary — never optional
      .eq('account_id', accountId);
    if (error) throw new Error(`unified_persons read failed: ${error.message}`);
    // Cast through `unknown`: PostgREST infers a row shape from a LITERAL select
    // string, and this one is built from CONTACT_COLUMNS so that the select, the
    // row type and the mapping stay a single source of truth. Losing the
    // inference is the price of that, and the column list is the guarantee.
    return ((data ?? []) as unknown) as PersonRow[];
  },

  async loadProspects(organizationId: string, personIds: readonly string[]): Promise<readonly ProspectRow[]> {
    if (personIds.length === 0) return [];
    const { data, error } = await ownedDbTable('canonical_leads')
      .select('id, unified_person_id, source, created_at')
      .eq('company_id', organizationId)           // tenant boundary — never optional
      .in('unified_person_id', [...personIds]);
    if (error) throw new Error(`canonical_leads read failed: ${error.message}`);
    return (data ?? []) as ProspectRow[];
  },

  async loadAssertions(organizationId: string, accountId: string): Promise<readonly AssertionRow[]> {
    const { data, error } = await ownedDbTable('source_assertions')
      .select('id, attribute, normalized_value, provider, confidence, observed_at, source_record_id')
      .eq('organization_id', organizationId)      // tenant boundary — never optional
      .eq('account_id', accountId)
      // LIVE evidence only, matching LI-2's own canonical-decision query.
      .is('superseded_at', null);
    if (error) throw new Error(`source_assertions read failed: ${error.message}`);
    return (data ?? []) as AssertionRow[];
  },

  async loadEngagement(organizationId: string, personIds: readonly string[]): Promise<readonly EngagementThreadRow[]> {
    if (personIds.length === 0) return [];
    const { data, error } = await ownedDbTable('engagement_threads')
      .select('id, unified_person_id, updated_at, created_at')
      .eq('organization_id', organizationId)      // tenant boundary — never optional
      .in('unified_person_id', [...personIds]);
    if (error) throw new Error(`engagement_threads read failed: ${error.message}`);
    return (data ?? []) as EngagementThreadRow[];
  },

  loadMarketContext: (input) => readTenantMarketContext(input),
};

/**
 * Aggregate everything known about one Account, for one tenant.
 *
 * Pure with respect to the database: it writes nothing, so calling it twice
 * returns the same answer and creates nothing the second time. That is why
 * idempotency needs no deduplication model — there is nothing to deduplicate.
 *
 * Returns null when the Account is not readable in this tenant. That is an
 * identity fact, not an empty aggregate, and a caller must be able to tell
 * "no such account here" from "an account we know nothing about".
 */
export async function aggregateAccountIntelligence(
  input: AccountIntelligenceInput,
  ports: AccountIntelligencePorts = defaultAccountIntelligencePorts,
): Promise<AccountIntelligence | null> {
  if (!input.organizationId?.trim()) {
    throw new Error('organizationId is required to aggregate account intelligence');
  }
  if (!input.accountId?.trim()) {
    throw new Error('accountId is required to aggregate account intelligence');
  }
  if (!input.now?.trim()) {
    throw new Error('now is required — account freshness is never derived from ambient time');
  }

  const account = await ports.loadAccount(input.organizationId, input.accountId);
  if (!account) return null;

  const [contacts, assertions] = await Promise.all([
    ports.loadContacts(input.organizationId, input.accountId),
    ports.loadAssertions(input.organizationId, input.accountId),
  ]);

  const personIds = contacts.map((c) => c.id);
  const [prospects, threads] = await Promise.all([
    ports.loadProspects(input.organizationId, personIds),
    ports.loadEngagement(input.organizationId, personIds),
  ]);

  // ── CONSISTENCY — LI-2's verdict, obtained from LI-2's own function ──────
  // The canonical row passed in is EMPTY on purpose. With the real row, RULE C
  // ("never overwrite a value already set") fires first and reports
  // `canonical_value_already_set`, hiding whether the sources actually agree.
  // An empty row disables RULE C, leaving RULE B as the only reason anything is
  // withheld — which is exactly the disagreement question WS-7 is asking.
  const li2 = decideCanonicalUpdates(
    {},
    assertions.map((a) => ({ attribute: a.attribute, normalized_value: a.normalized_value, id: a.id })),
    ACCOUNT_ATTRIBUTE_COLUMNS,
  );
  const contested = new Set(
    li2.withhold.filter((w) => w.reason === 'sources_disagree').map((w) => w.attribute),
  );

  // ── FACTS — canonical values, with the evidence behind each ──────────────
  const assertionsByAttribute = new Map<string, AssertionRow[]>();
  for (const a of assertions) {
    const list = assertionsByAttribute.get(a.attribute) ?? [];
    list.push(a);
    assertionsByAttribute.set(a.attribute, list);
  }

  const facts: AccountFact[] = [];
  const missing: string[] = [];
  const unattested: string[] = [];
  const byAttribute: Record<string, number | null> = {};

  for (const attribute of ACCOUNT_FACT_COLUMNS) {
    const value = account[attribute];
    const known = value !== null && value !== undefined;
    if (!known) missing.push(attribute);

    const evidence = assertionsByAttribute.get(attribute) ?? [];
    // The attribute's confidence is the strongest any source stated. A source
    // that stated none contributes nothing rather than a zero.
    const stated = evidence.map((e) => numberOrNull(e.confidence)).filter((c): c is number => c !== null);
    byAttribute[attribute] = stated.length > 0 ? Math.max(...stated) : null;

    const consistency: AccountFact['consistency'] =
      contested.has(attribute) ? 'sources_disagree'
      : evidence.length > 0 ? 'uncontested'
      : known ? 'unattested'          // a value with no live evidence behind it
      : 'unknown';                    // absence, reported as absence
    if (consistency === 'unattested') unattested.push(attribute);

    facts.push({
      attribute,
      // Always the canonical value. Reading it from an assertion would let one
      // Prospect's unsupported claim become an Account-wide fact.
      value: known ? value : null,
      kind: 'observed',
      provenance: evidence.map((e) => ({
        provider: text(e.provider),
        sourceRecordId: text(e.source_record_id),
        observedAt: text(e.observed_at),
        confidence: numberOrNull(e.confidence),
      })),
      consistency,
    });
  }

  // ── ROSTER — several people and several Prospects per Account is NORMAL ──
  const prospectsByPerson = new Map<string, string[]>();
  for (const p of prospects) {
    const pid = text(p.unified_person_id);
    if (!pid) continue;
    const list = prospectsByPerson.get(pid) ?? [];
    list.push(p.id);
    prospectsByPerson.set(pid, list);
  }

  const roster: AccountContact[] = contacts.map((c) => ({
    personId: c.id,
    attributes: Object.fromEntries(
      CONTACT_COLUMNS.map((col) => [col, text((c as Record<string, unknown>)[col])]),
    ) as Record<ContactColumn, string | null>,
    prospectIds: prospectsByPerson.get(c.id) ?? [],
  }));

  // ── FRESHNESS ────────────────────────────────────────────────────────────
  const attributesUpdatedAt = text(account.attributes_updated_at);
  const ageDays = daysBetween(attributesUpdatedAt, input.now);
  const hasPolicy = typeof input.stalenessDays === 'number' && input.stalenessDays >= 0;

  // ── TENANT MARKET CONTEXT — asked for, never assumed, never merged ───────
  const marketContext = input.includeMarketContext
    ? {
      subject: 'tenant_market' as const,
      context: await ports.loadMarketContext({
        organizationId: input.organizationId,
        stalenessDays: input.stalenessDays,
        now: input.now,
      }),
    }
    : null;

  const known = ACCOUNT_FACT_COLUMNS.length - missing.length;

  return {
    version: ACCOUNT_INTELLIGENCE_VERSION,
    organizationId: input.organizationId,
    accountId: account.id,
    reason: account.status === 'merged' && account.merged_into_id
      ? `this account was merged into ${account.merged_into_id}; its current intelligence lives there`
      : `${known}/${ACCOUNT_FACT_COLUMNS.length} company facts, ${roster.length} contact(s), ${prospects.length} prospect(s)`,

    account: {
      id: account.id,
      name: text(account.name),
      domain: text(account.domain_normalized),
      status: text(account.status),
      mergedIntoId: text(account.merged_into_id),
      firstSeenAt: text(account.first_seen_at),
      lastVerifiedAt: text(account.last_verified_at),
    },

    facts,
    completeness: { known, total: ACCOUNT_FACT_COLUMNS.length, missing },
    confidence: { account: numberOrNull(account.confidence), byAttribute },
    freshness: {
      attributesUpdatedAt,
      ageDays,
      // An age that cannot be shown is STALE under a real policy, not fresh —
      // the same rule WS-2 applies to a field with no `observedAt`.
      stale: hasPolicy ? (ageDays === null || ageDays > (input.stalenessDays as number)) : null,
    },
    provenance: {
      attributesSource: text(account.attributes_source),
      providers: [...new Set(assertions.map((a) => text(a.provider)).filter((p): p is string => p !== null))].sort(),
      sourceRecordIds: [...new Set(assertions.map((a) => text(a.source_record_id)).filter((s): s is string => s !== null))].sort(),
    },
    consistency: { contested: [...contested].sort(), unattested: unattested.sort() },

    contacts: roster,
    prospects: prospects.map((p) => ({
      prospectId: p.id,
      personId: text(p.unified_person_id),
      source: text(p.source),
      createdAt: text(p.created_at),
    })),
    engagement: {
      threadCount: threads.length,
      personsEngaged: new Set(
        threads.map((t) => text(t.unified_person_id)).filter((p): p is string => p !== null),
      ).size,
      // Null, never an epoch: no conversation is not a conversation long ago.
      lastActivityAt: latest(threads.map((t) => t.updated_at ?? t.created_at ?? null)),
    },

    marketContext,
  };
}
