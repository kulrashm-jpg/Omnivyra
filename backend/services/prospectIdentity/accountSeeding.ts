/**
 * PI-WP-B3 — deterministic account seeding from legitimate prospect evidence.
 *
 * W4 (`accountResolution.ts`) already answers "which external company is this?"
 * and it answers it correctly: a provider reference or a registrable domain,
 * never a name, and `ambiguous` rather than a merge. This module does NOT
 * re-answer that question and deliberately owns no lookup, no insert and no
 * table. It is the ADMISSIBILITY GATE in front of W4 — it decides whether the
 * evidence offered is the kind of thing that may become a company identity at
 * all, and then delegates.
 *
 * It exists because W4's identity key is only as good as the string handed to
 * it, and three classes of string get handed to it today that are not company
 * identities:
 *
 *   1. FREE-MAIL DOMAINS.  `normalizeCompanyDomain('jane@gmail.com')` returns
 *      'gmail.com'. W4 has no opinion about that value, so it becomes a real
 *      `prospect_accounts` row — and then EVERY prospect in the tenant with a
 *      personal address resolves to it by the domain key. That is precisely the
 *      silent account merge W4 exists to prevent, arriving through a door W4
 *      does not watch. The repository already owns the blocklist
 *      (`lib/auth/publicEmailDomains.ts`, AUTH-001's single source of truth);
 *      account identity simply never consulted it.
 *
 *   2. THINGS THAT ARE NOT HOSTNAMES.  `normalizeCompanyDomain` is a pure
 *      *shape* normaliser, not a validator: it returns 'acme .com',
 *      'acme..com' and '-acme.com' unchanged, and collapses the IP literal
 *      '192.168.1.1' to the "domain" '1.1'. Each is a durable identity key
 *      that no real company will ever also produce, so it can only ever
 *      accrete wrong prospects.
 *
 *   3. DATA THAT IS OLD RATHER THAN OBSERVED.  See below.
 *
 * ─── LEGACY DATA IS NOT ACQUISITION EVIDENCE ───────────────────────────────
 * The tempting way to populate `prospect_accounts` is to sweep the email column
 * of the rows that already exist and mint an account per domain. That
 * manufactures evidence. A legacy `unified_persons` row records that a value
 * was once written; it does NOT record that a provider observed that person at
 * that company, when, or from what. Seeding from it produces accounts whose
 * provenance chain terminates in a backfill that was itself provenance-free —
 * and once written they are indistinguishable from accounts a provider really
 * asserted.
 *
 * So admissibility requires PROVENANCE, not just a value: a named non-legacy
 * provider, a retained source record (LI-2's `source_records` identity), and a
 * real observation timestamp. `w3_backfill` and `w4_account_activation` are
 * named refusals — a row that describes itself as a historical backfill is
 * making exactly the claim this gate rejects. `derivedFromCanonicalRow` covers
 * the same failure one step removed: a domain lifted out of a canonical row is
 * a derivation from prior state, not an observation, whoever hands it over.
 *
 * ─── WHY prospectIdentity/ AND NOT leadIngestion/ ──────────────────────────
 * `leadIngestion/` is provider-neutral orchestration — it translates adapters
 * into the canonical chain and calls the owners of each step. Which strings may
 * become a company IDENTITY is not an orchestration concern; it is the same
 * question `accountResolution.ts` answers, at one remove, and it must hold for
 * every caller of W4 (the orchestrator, enrichment persistence, and any future
 * adapter) rather than for one pipeline. It belongs beside the resolver whose
 * inputs it constrains.
 *
 * ─── IT NEVER WRITES ───────────────────────────────────────────────────────
 * `seedAccountFromEvidence` gates and then calls `resolveOrCreateAccount`.
 * There is no second insert path, no second idempotency story and no second
 * tenant filter — a second one of any of those would be the bug, not the fix.
 * Every function that decides is pure; the only async call is the delegation.
 */

import { isPublicEmailDomain } from '../../../lib/auth/publicEmailDomains';
import { recordRawCounter } from '../../observability/metrics';
import {
  resolveOrCreateAccount,
  type AccountCandidate,
  type AccountOutcome,
  type AccountResolution,
} from './accountResolution';
import { KNOWN_MULTI_PART_TLDS } from '../../../lib/shared/domain/companyDomain';
import { normalizeCompanyDomain } from './normalization';

/** Bumped when admissibility rules change, so a decision can be traced to them. */
export const ACCOUNT_SEEDING_VERSION = 'pi.b3.1';

/** `<domain>.<subject>.<unit>` — the HARDEN-001 convention. Bounded labels only. */
export const ACCOUNT_SEEDING_METRIC = 'identity.account.seeding';

/* ───────────────────────────────────────────────────────────────────────────
 * Domain admissibility — pure, total, no I/O.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Why a candidate domain may not become a company identity. A CLOSED set: it is
 * used as a metric label, and an open one would make the series unbounded.
 */
export type DomainRejection =
  | 'absent'
  | 'malformed'
  | 'ip_literal'
  | 'free_mail'
  | 'non_routable';

export type DomainAdmissibility =
  | { admissible: true; domain: string; rejection: null }
  | { admissible: false; domain: null; rejection: DomainRejection };

/**
 * Names that resolve to no company anywhere, ever. Deliberately SHORT: this is
 * a guard against non-routable junk, not a public-suffix registry. `.test` and
 * `.example` are intentionally absent — RFC 2606 reserves them, but the
 * repository's own fixtures use `acme.test` as a stand-in domain and a gate
 * that rejects the test vocabulary teaches callers to route around the gate.
 */
const NON_ROUTABLE_SUFFIXES: readonly string[] = ['.local', '.internal', '.invalid', '.localhost'];
const NON_ROUTABLE_EXACT: ReadonlySet<string> = new Set(['localhost', 'local', 'internal', 'invalid']);

/** One DNS label: alphanumeric, inner hyphens allowed, 1..63 characters. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** A TLD is alphabetic, or a punycode A-label. Never numeric — that is an IP. */
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

const isIpLiteral = (host: string): boolean =>
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||        // IPv4 dotted quad
  /^\[?[0-9a-f:]*:[0-9a-f:]*\]?$/.test(host) ||    // IPv6, bracketed or bare
  /^\d+$/.test(host.replace(/\./g, ''));           // all-numeric, any dotting

/**
 * Reduce a raw value (bare host, URL or email address) to the registrable
 * domain, and say whether that domain may serve as a company identity.
 *
 * The ORDER matters. Shape is checked before the blocklist so that junk is
 * reported as junk rather than as "not a free-mail provider", and the IP check
 * runs against the host BEFORE `normalizeCompanyDomain` collapses it — by the
 * time '192.168.1.1' has become '1.1' the evidence that it was an address is
 * gone.
 */
export function classifyAccountDomain(raw: string | null | undefined): DomainAdmissibility {
  const input = String(raw ?? '').trim().toLowerCase();
  if (!input) return { admissible: false, domain: null, rejection: 'absent' };

  // Take the host the same way the canonical normaliser does, but keep it
  // uncollapsed so the IP shape is still visible.
  const beforeAt = input.includes('@') ? (input.split('@').pop() ?? '') : input;
  const host = beforeAt
    .replace(/^[a-z][a-z0-9+\-.]*:\/\//, '')
    .split('/')[0].split('?')[0].split('#')[0]
    .replace(/^www\./, '')
    .split(':')[0]
    .replace(/\.$/, '');
  if (!host) return { admissible: false, domain: null, rejection: 'absent' };
  if (isIpLiteral(host)) return { admissible: false, domain: null, rejection: 'ip_literal' };

  if (NON_ROUTABLE_EXACT.has(host) || NON_ROUTABLE_SUFFIXES.some((s) => host.endsWith(s))) {
    return { admissible: false, domain: null, rejection: 'non_routable' };
  }

  // Shape. Every label must be a real DNS label and the TLD must be alphabetic,
  // which is what rejects 'acme .com', 'acme..com', '-acme.com' and '1.1'.
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2) {
    return { admissible: false, domain: null, rejection: 'malformed' };
  }
  if (!labels.every((l) => LABEL.test(l)) || !TLD.test(labels[labels.length - 1])) {
    return { admissible: false, domain: null, rejection: 'malformed' };
  }

  // Delegate the actual key derivation — multi-part TLDs and all — to the one
  // canonical normaliser. Re-implementing it here is how two identity keys for
  // one company appear.
  const domain = normalizeCompanyDomain(host);
  if (!domain) return { admissible: false, domain: null, rejection: 'malformed' };

  // A bare public suffix is not a company: 'co.uk' is where companies are
  // registered, not one of them. `registrableRoot` returns it unchanged when
  // there is nothing to the left of it, so without this it would key an account
  // that every UK domain could later be mistaken for.
  if (KNOWN_MULTI_PART_TLDS.has(domain)) {
    return { admissible: false, domain: null, rejection: 'malformed' };
  }

  // The blocklist is consulted on BOTH the full host and the registrable root:
  // 'jane@mail.yahoo.com' must be refused on 'yahoo.com' even though the host
  // itself is not listed.
  if (isPublicEmailDomain(domain) || isPublicEmailDomain(host)) {
    return { admissible: false, domain: null, rejection: 'free_mail' };
  }

  return { admissible: true, domain, rejection: null };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Provenance admissibility — pure, total, no I/O.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * What must be true for a value to count as an ACQUISITION observation rather
 * than a fact the database happens to contain. Mirrors the fields LI-2's
 * `ProviderSourceRecord` already carries, so a caller that ingested through the
 * boundary has these to hand and never has to invent them.
 */
export interface EvidenceProvenance {
  /** The system that OBSERVED this, e.g. 'apollo', 'crm', 'csv'. */
  provider: string;
  /** The provider's own record id — the retained `source_records` identity. */
  sourceRecordId: string;
  /** When the SOURCE observed it. ISO-8601. */
  observedAt: string;
}

/**
 * Provider markers that describe prior state rather than an observation. A
 * record stamped with one of these is asserting "this came from what we already
 * had", which is the precise claim seeding must refuse.
 */
export const LEGACY_PROVENANCE_PROVIDERS: ReadonlySet<string> = new Set([
  'w3_backfill',
  'w4_account_activation',
  'legacy',
  'legacy_backfill',
  'legacy_unified_persons',
  'unified_persons',
  'backfill',
  'migration',
]);

export type ProvenanceRejection =
  | 'missing_provenance'
  | 'legacy_provenance'
  | 'derived_from_canonical_row'
  | 'unusable_observed_at';

export type ProvenanceVerdict =
  | { evidenceBacked: true; rejection: null }
  | { evidenceBacked: false; rejection: ProvenanceRejection };

/**
 * Decide whether provenance describes a real acquisition.
 *
 * `at` is the caller's clock, passed in rather than read, so the decision stays
 * pure and testable. A timestamp in the future is refused: it is either a bad
 * parse or a fabricated observation, and both are reasons not to mint identity.
 */
export function classifyProvenance(
  provenance: EvidenceProvenance | null | undefined,
  derivedFromCanonicalRow: boolean,
  at: string = new Date().toISOString(),
): ProvenanceVerdict {
  if (derivedFromCanonicalRow) {
    return { evidenceBacked: false, rejection: 'derived_from_canonical_row' };
  }
  const provider = String(provenance?.provider ?? '').trim().toLowerCase();
  const recordId = String(provenance?.sourceRecordId ?? '').trim();
  if (!provider || !recordId) {
    return { evidenceBacked: false, rejection: 'missing_provenance' };
  }
  if (LEGACY_PROVENANCE_PROVIDERS.has(provider)) {
    return { evidenceBacked: false, rejection: 'legacy_provenance' };
  }
  const observed = Date.parse(String(provenance?.observedAt ?? ''));
  if (!Number.isFinite(observed)) {
    return { evidenceBacked: false, rejection: 'unusable_observed_at' };
  }
  const now = Date.parse(at);
  // 60s of tolerance for clock skew between the provider and this process; a
  // real observation is never meaningfully ahead of us.
  if (Number.isFinite(now) && observed > now + 60_000) {
    return { evidenceBacked: false, rejection: 'unusable_observed_at' };
  }
  return { evidenceBacked: true, rejection: null };
}

/* ───────────────────────────────────────────────────────────────────────────
 * The seeding decision.
 * ────────────────────────────────────────────────────────────────────────── */

export interface AccountSeedEvidence {
  /** The identity evidence, in W4's own vocabulary. */
  candidate: AccountCandidate;
  /** Who observed it, from what record, and when. */
  provenance?: EvidenceProvenance | null;
  /**
   * TRUE when the domain came out of a row we already held — a legacy
   * `unified_persons.email`, a prior canonical value — rather than from the
   * provider's answer. Callers set this honestly; it is the difference between
   * evidence and an echo.
   */
  derivedFromCanonicalRow?: boolean;
}

export type SeedRefusal =
  | DomainRejection
  | ProvenanceRejection
  | 'no_tenant'
  | 'no_deterministic_identity';

export interface AccountSeedDecision {
  organizationId: string;
  /** True when this evidence may be handed to W4. */
  admissible: boolean;
  refusal: SeedRefusal | null;
  /** The registrable domain W4 will key on, when one survived. */
  normalizedDomain: string | null;
  /** Present when a provider reference is available as the stronger key. */
  sourceKey: { source: string; sourceReference: string } | null;
  /**
   * Set when a domain was dropped but the seed proceeded on a provider
   * reference. Reported, never silent: a withheld domain is a data-quality
   * finding about the source.
   */
  withheldDomain: { raw: string; rejection: DomainRejection } | null;
  /** The candidate as it may be handed to W4 — inadmissible identity removed. */
  sanitizedCandidate: AccountCandidate;
  reason: string;
}

const clean = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * Decide, without touching the database, whether this evidence may seed an
 * account — and what W4 is allowed to see if it may.
 *
 * ─── WHY AN INADMISSIBLE DOMAIN DOES NOT ALWAYS REFUSE THE WHOLE SEED ─────
 * A CRM record can carry a legitimate immutable account id AND a contact's
 * gmail address. Refusing outright would lose an account the provider is the
 * system of record for; passing it through would let W4 write
 * `domain_normalized = 'gmail.com'`. So the domain is REMOVED and the seed
 * proceeds on the provider reference, with the removal reported. With no
 * provider reference there is nothing left, and the answer is a refusal.
 *
 * `websiteUrl` is nulled alongside `domain` because W4 derives its key from
 * `candidate.domain ?? candidate.websiteUrl` — leaving the website in place
 * would let the rejected value walk back in through the fallback. The mirror of
 * W4's own precedence is exact and deliberate: the effective identity input is
 * `domain ?? websiteUrl`, and that is the string classified below.
 */
export function assessAccountSeed(
  organizationId: string,
  evidence: AccountSeedEvidence,
  at: string = new Date().toISOString(),
): AccountSeedDecision {
  const candidate = evidence.candidate ?? {};
  const source = clean(candidate.source);
  const ref = clean(candidate.sourceReference);
  const sourceKey = source && ref ? { source, sourceReference: ref } : null;

  const base = {
    organizationId,
    normalizedDomain: null as string | null,
    sourceKey,
    withheldDomain: null as AccountSeedDecision['withheldDomain'],
    sanitizedCandidate: { ...candidate, domain: null, websiteUrl: null } as AccountCandidate,
  };

  if (!organizationId?.trim()) {
    return { ...base, admissible: false, refusal: 'no_tenant',
      reason: 'organizationId is required — an account without a tenant is never valid' };
  }

  // Provenance first. A value with no acquisition behind it is inadmissible
  // however well-formed it is, so there is no point classifying it.
  const prov = classifyProvenance(evidence.provenance, evidence.derivedFromCanonicalRow === true, at);
  if (!prov.evidenceBacked) {
    return { ...base, admissible: false, refusal: prov.rejection,
      reason: `provenance does not describe an acquisition (${prov.rejection}); existing data is not evidence that a domain was observed` };
  }

  // W4's own precedence, mirrored exactly.
  const effective = candidate.domain ?? candidate.websiteUrl ?? null;
  const domainVerdict = classifyAccountDomain(effective);

  if (domainVerdict.admissible) {
    return {
      ...base,
      admissible: true,
      refusal: null,
      normalizedDomain: domainVerdict.domain,
      sanitizedCandidate: { ...candidate, domain: domainVerdict.domain },
      reason: sourceKey
        ? 'provider reference and admissible domain, both evidence-backed'
        : 'admissible registrable domain, evidence-backed',
    };
  }

  if (sourceKey) {
    const raw = clean(effective);
    return {
      ...base,
      admissible: true,
      refusal: null,
      withheldDomain: raw ? { raw, rejection: domainVerdict.rejection } : null,
      reason: raw
        ? `domain withheld (${domainVerdict.rejection}); seeding on the provider reference alone`
        : 'provider reference only; the source stated no domain',
    };
  }

  // Nothing deterministic survives. A name is never identity, so 'absent' here
  // is reported as what it actually is.
  const refusal: SeedRefusal =
    domainVerdict.rejection === 'absent' ? 'no_deterministic_identity' : domainVerdict.rejection;
  return { ...base, admissible: false, refusal,
    reason: domainVerdict.rejection === 'absent'
      ? 'no provider reference and no domain — a company name is not an identity'
      : `the only identity offered was an inadmissible domain (${domainVerdict.rejection})` };
}

export type SeedOutcome = AccountOutcome | 'refused';

export interface AccountSeedResult {
  outcome: SeedOutcome;
  accountId: string | null;
  decision: AccountSeedDecision;
  /** W4's answer, absent when the gate refused before delegating. */
  resolution: AccountResolution | null;
  reason: string;
}

/** Bounded observation. No tenant, no domain, no account id — labels only. */
function observe(outcome: SeedOutcome, refusal: SeedRefusal | null): void {
  try {
    recordRawCounter(ACCOUNT_SEEDING_METRIC, 1, { outcome, refusal: refusal ?? 'none' });
  } catch {
    /* observation must never break the decision it observes */
  }
}

/**
 * Seed an account from evidence: gate, then delegate to W4.
 *
 * `resolver` is injectable so the gate can be tested without a database, and
 * defaults to the one real resolver. There is no other write path here — a
 * refusal writes nothing, and an admission writes only what
 * `resolveOrCreateAccount` writes.
 *
 * `ambiguous` is passed straight through as a REFUSAL to link, exactly as W4
 * meant it: two candidate accounts is a question for a human, not a merge.
 */
export async function seedAccountFromEvidence(
  organizationId: string,
  evidence: AccountSeedEvidence,
  at: string = new Date().toISOString(),
  resolver: typeof resolveOrCreateAccount = resolveOrCreateAccount,
): Promise<AccountSeedResult> {
  const decision = assessAccountSeed(organizationId, evidence, at);
  if (!decision.admissible) {
    observe('refused', decision.refusal);
    return { outcome: 'refused', accountId: null, decision, resolution: null, reason: decision.reason };
  }

  const resolution = await resolver(organizationId, decision.sanitizedCandidate, at);
  observe(resolution.outcome, null);

  // W4 already refuses to act on ambiguity; the account id is null there. Not
  // re-deciding it, just not undoing it.
  const accountId = resolution.outcome === 'ambiguous' ? null : resolution.accountId;
  return {
    outcome: resolution.outcome,
    accountId,
    decision,
    resolution,
    reason: decision.withheldDomain
      ? `${resolution.reason} (${decision.reason})`
      : resolution.reason,
  };
}
