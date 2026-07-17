/**
 * companyIdentityValidationService.ts
 *
 * THE single authoritative company-eligibility engine. Decides — once, at
 * signup — whether a company may self-register on Omnivyra. Onboarding and
 * setup-company CONSUME this verdict and never re-derive it.
 *
 * Business rule (authoritative):
 *   1. Email is not from a personal/free provider.
 *   2. Email domain has valid email capability (MX, not disposable/blocked/forwarding).
 *   3. A live website exists at the email domain.
 *   4. Website domain matches email domain.
 *   5. Company domain is not already claimed by another organization.
 *
 * Website source (per product decision D2): the website is DERIVED from the
 * email domain (`https://www.<normalizedEmailDomain>`), so rule 4 is satisfied
 * by construction and the meaningful website gate is rule 3 (a live, canonical,
 * non-forwarding site at that domain). The DOMAIN_MISMATCH branch is retained
 * for correctness should a caller ever pass an explicit website.
 *
 * Invite carve-out (decision D1): personal-email teammates join via invite /
 * approved access-request and enter through magic-link → sync-supabase-user,
 * NOT through the self-serve signup gate that calls this engine. This engine
 * therefore blocks personal email for self-serve without affecting invites.
 *
 * Composition (no new validation logic — wraps the existing, hardened stages):
 *   A,B  personal/MX/disposable/forwarding-MX  → checkDomainEligibility
 *   C,D,F website existence/reachability/canonical/forwarding → resolveDomain
 *   E    normalization                          → normalizeCompanyDomain
 *   G    existing-company check                 → companies website/admin domain
 */

import dns from 'dns/promises';
import { supabase } from '../db/supabaseClient';
import { safeFetch } from '../../lib/security/safeFetch';
import { checkDomainEligibility } from './domainEligibilityService';
import { resolveDomain, type ResolveDomainResult } from './domainCanonicalService';
import { detectParkedDomain, type ParkedDomainVerdict } from './parkedDomainDetectionService';
import { normalizeCompanyDomain } from '../../lib/shared/domain/companyDomain';
import type { DomainEligibilityResult } from '../../lib/auth/domainEligibilityModel';
import {
  getCachedDomainVerdict,
  setCachedDomainVerdict,
  type CachedDomainVerdict,
} from './companyIdentityValidationCache';

/** Bump when the validation semantics change; stored alongside the verdict. */
export const COMPANY_IDENTITY_VALIDATION_VERSION = 'company-identity-v1';

/**
 * Thrown when the website probe fails for a domain that DOES resolve in DNS
 * (or whose DNS was only transiently unavailable). Callers must treat this as
 * "try again", NOT a rejection — hard-rejecting here would false-reject a
 * legitimate company whose site is momentarily unreachable. signup.ts's
 * try/catch maps any throw to a 503 IDENTITY_VALIDATION_UNAVAILABLE ("we could
 * not verify your organization right now — try again").
 */
export class WebsiteProbeTransientError extends Error {
  constructor(public readonly domain: string) {
    super(`WEBSITE_PROBE_TRANSIENT:${domain}`);
    this.name = 'WebsiteProbeTransientError';
  }
}

/**
 * Staged DNS-existence classifier (PROD-CX-004 §2). Distinguishes a DEFINITIVE
 * "this domain does not exist anywhere" from a real domain whose website we
 * merely could not reach — so that a hard reject is only ever issued on a
 * UNANIMOUS, cross-resolver absence.
 *
 * Verdicts:
 *   - 'has_records'       → an A/AAAA web host resolves via at least ONE resolver
 *                           (c-ares, getaddrinfo, or Cloudflare/Google DoH). A
 *                           failed HTTP probe is then just an unreachable site.
 *   - 'registered_no_web' → no web A/AAAA anywhere, but the domain publishes MX
 *                           (mail) or NS (delegated zone) → a real registered
 *                           organisation whose website is elsewhere/not yet up.
 *   - 'transient'         → nothing found, but at least one resolver failed with
 *                           a transient error (ETIMEOUT / ESERVFAIL / EAI_AGAIN /
 *                           EREFUSED / DoH network) → we genuinely cannot tell.
 *   - 'no_records'        → UNANIMOUS: every resolver definitively returned
 *                           NXDOMAIN / NODATA and there is no MX and no NS. The
 *                           domain does not exist → the only hard-reject signal.
 *
 * Stage order (each feeds the next; short-circuits on the first web host found):
 *   c-ares A/AAAA → getaddrinfo → DoH Cloudflare + Google → MX → NS.
 *
 * DoH runs through the SSRF-safe fetch seam and is strictly fail-open — a DoH
 * network/parse error contributes no signal and can never cause a hard reject.
 */
export type DomainDnsClass = 'has_records' | 'registered_no_web' | 'transient' | 'no_records';

export interface DomainDnsResolvers {
  /** c-ares (raw DNS) A records. */
  resolve4?: (host: string) => Promise<string[]>;
  /** c-ares (raw DNS) AAAA records. */
  resolve6?: (host: string) => Promise<string[]>;
  /** getaddrinfo (OS resolver) — resolves where c-ares spuriously fails. */
  lookup?: (host: string) => Promise<string[]>;
  /** MX exchanges for the apex. */
  resolveMx?: (host: string) => Promise<string[]>;
  /** NS hosts for the apex. */
  resolveNs?: (host: string) => Promise<string[]>;
  /** DNS-over-HTTPS union (Cloudflare + Google), returns record data strings. */
  dohQuery?: (name: string, type: 'A' | 'AAAA' | 'MX' | 'NS') => Promise<string[]>;
}

const DOH_TIMEOUT_MS = 8_000;
const DOH_TYPE_CODE: Record<string, number> = { A: 1, AAAA: 28, MX: 15, NS: 2 };

/** One DoH JSON resolver (RFC 8484 application/dns-json). Fail-open → []. */
async function dohFrom(endpoint: string, name: string, type: string): Promise<string[]> {
  try {
    const url = `${endpoint}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
    const res = await safeFetch(
      url,
      { method: 'GET', headers: { accept: 'application/dns-json' } },
      { timeoutMs: DOH_TIMEOUT_MS },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as
      | { Status?: number; Answer?: Array<{ type?: number; data?: string }> }
      | null;
    if (!body || body.Status !== 0 || !Array.isArray(body.Answer)) return [];
    const want = DOH_TYPE_CODE[type];
    return body.Answer
      .filter((a) => a && a.type === want && typeof a.data === 'string' && a.data.length > 0)
      .map((a) => a.data as string);
  } catch {
    return [];
  }
}

/** Default DoH: query Cloudflare AND Google in parallel and union the answers. */
async function defaultDohQuery(name: string, type: 'A' | 'AAAA' | 'MX' | 'NS'): Promise<string[]> {
  const [cf, google] = await Promise.all([
    dohFrom('https://cloudflare-dns.com/dns-query', name, type),
    dohFrom('https://dns.google/resolve', name, type),
  ]);
  return [...cf, ...google];
}

export async function classifyDomainDnsDefault(
  domain: string,
  resolvers: DomainDnsResolvers = {},
): Promise<DomainDnsClass> {
  const resolve4 = resolvers.resolve4 ?? ((h: string) => dns.resolve4(h));
  const resolve6 = resolvers.resolve6 ?? ((h: string) => dns.resolve6(h));
  const lookup =
    resolvers.lookup ??
    (async (h: string) => (await dns.lookup(h, { all: true, verbatim: true })).map((r) => r.address));
  const resolveMx = resolvers.resolveMx ?? (async (h: string) => (await dns.resolveMx(h)).map((m) => m.exchange));
  const resolveNs = resolvers.resolveNs ?? ((h: string) => dns.resolveNs(h));
  const dohQuery = resolvers.dohQuery ?? defaultDohQuery;

  let sawTransient = false;
  // Runs one lookup; empty on any failure, marking transient unless the error is
  // a definitive "no such record" (ENOTFOUND / ENODATA / NODATA).
  const tryRecords = async (fn: () => Promise<string[]>): Promise<string[]> => {
    try {
      const r = await fn();
      return Array.isArray(r) ? r.filter((x) => typeof x === 'string' && x.length > 0) : [];
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? '';
      if (code !== 'ENOTFOUND' && code !== 'ENODATA' && code !== 'NODATA') sawTransient = true;
      return [];
    }
  };

  const hosts = [domain, `www.${domain}`];

  // ── Stage 1: web-host existence (A/AAAA). c-ares → getaddrinfo. Any hit wins.
  for (const host of hosts) {
    if ((await tryRecords(() => resolve4(host))).length) return 'has_records';
    if ((await tryRecords(() => resolve6(host))).length) return 'has_records';
    if ((await tryRecords(() => lookup(host))).length) return 'has_records';
  }
  // Independent DoH resolvers — catch c-ares/getaddrinfo serverless false
  // negatives (the SNIS class). Fail-open.
  for (const host of hosts) {
    if ((await tryRecords(() => dohQuery(host, 'A'))).length) return 'has_records';
    if ((await tryRecords(() => dohQuery(host, 'AAAA'))).length) return 'has_records';
  }

  // ── Stage 2: no web host, but MX or NS proves a real, registered domain.
  const mx = [
    ...(await tryRecords(() => resolveMx(domain))),
    ...(await tryRecords(() => dohQuery(domain, 'MX'))),
  ];
  if (mx.length) return 'registered_no_web';
  const ns = [
    ...(await tryRecords(() => resolveNs(domain))),
    ...(await tryRecords(() => dohQuery(domain, 'NS'))),
  ];
  if (ns.length) return 'registered_no_web';

  // ── Stage 3: nothing anywhere. Transient trouble ⇒ don't reject; only a
  // unanimous definitive absence is a hard-reject signal.
  return sawTransient ? 'transient' : 'no_records';
}

export interface CompanyIdentity {
  eligible: boolean;

  emailDomain: string;
  normalizedEmailDomain: string;

  websiteUrl: string;
  websiteDomain: string;
  normalizedWebsiteDomain: string;

  /** Canonical identity key = registrable domain + TLD. */
  companyIdentityDomain: string;

  /** Null when eligible; otherwise a canonical result code explaining the block. */
  validationReason: DomainEligibilityResult | null;

  /** True when the user should be routed to the manual-review queue, not hard-rejected. */
  requiresManualReview: boolean;

  /**
   * PROD-CX-004 §6 auto-approve signal. True ONLY for the narrow, provably-real
   * case: the email domain has valid MX (proven by the eligibility stage) AND a
   * web host resolves in DNS (some resolver saw A/AAAA), but the website was
   * merely unreachable from our egress — no SSRF, forwarding, canonical, or
   * parked concern. Callers that also hold proof of email ownership (signup after
   * verification) may treat this as an auto-approval instead of a manual review.
   * Never set for registered_no_web / forwarding / parked / canonical outcomes.
   */
  autoApprovable?: boolean;

  /**
   * Validation diagnostics (AUTH-001 §7) — structured detail for operators;
   * never surfaced to end users. Currently carries the parked-domain marker.
   */
  diagnostics?: { parkedMarker?: string } | null;

  /** Set when rule 5 matched — the org that already owns this domain. */
  existingCompany?: { id: string; name: string | null } | null;
}

/** Injectable seams — defaults wire to the real, hardened implementations. */
export interface ValidateCompanyIdentityDeps {
  checkEligibility?: (email: string) => Promise<{ result: DomainEligibilityResult; eligible: boolean }>;
  probeWebsite?: (domain: string) => Promise<ResolveDomainResult>;
  /** AUTH-001 §7 — parked/expired-lander content check (defaults to the real detector). */
  probeParked?: (finalDomain: string) => Promise<ParkedDomainVerdict>;
  lookupClaimedCompany?: (normalizedDomain: string) => Promise<{ id: string; name: string | null } | null>;
  /** Transient-vs-definitive DNS classifier (defaults to the real resolver). */
  classifyDomainDns?: (domain: string) => Promise<DomainDnsClass>;
  /** Phase 11D cache seams (defaults wire to the in-memory success cache). */
  now?: () => number;
  cacheGet?: (domain: string, nowMs: number) => CachedDomainVerdict | null;
  cacheSet?: (domain: string, verdict: CachedDomainVerdict) => void;
}

/** Default rule-5 lookup: an active company already owning this domain. */
async function defaultLookupClaimedCompany(
  normalizedDomain: string,
): Promise<{ id: string; name: string | null } | null> {
  if (!normalizedDomain) return null;
  const { data } = await supabase
    .from('companies')
    .select('id, name')
    .eq('status', 'active')
    .or(`website_domain.eq.${normalizedDomain},admin_email_domain.eq.${normalizedDomain}`)
    .maybeSingle();
  return data ? { id: (data as any).id, name: (data as any).name ?? null } : null;
}

function block(
  base: Omit<CompanyIdentity, 'eligible' | 'validationReason' | 'requiresManualReview' | 'existingCompany'>,
  reason: DomainEligibilityResult,
  requiresManualReview: boolean,
  existingCompany: { id: string; name: string | null } | null = null,
): CompanyIdentity {
  return { ...base, eligible: false, validationReason: reason, requiresManualReview, existingCompany };
}

/**
 * Authoritative company-identity validation. Pure decision flow over three
 * injectable stages; no side effects (does not write the review queue or any
 * verdict — callers persist as appropriate).
 */
export async function validateCompanyIdentity(
  email: string,
  deps: ValidateCompanyIdentityDeps = {},
): Promise<CompanyIdentity> {
  const checkEligibility = deps.checkEligibility ?? (async (e: string) => {
    const r = await checkDomainEligibility(e);
    return { result: r.result, eligible: r.eligible };
  });
  const probeWebsite = deps.probeWebsite ?? resolveDomain;
  const probeParked = deps.probeParked ?? detectParkedDomain;
  const lookupClaimedCompany = deps.lookupClaimedCompany ?? defaultLookupClaimedCompany;
  const classifyDomainDns = deps.classifyDomainDns ?? classifyDomainDnsDefault;
  const now = deps.now ?? Date.now;
  const cacheGet = deps.cacheGet ?? getCachedDomainVerdict;
  const cacheSet = deps.cacheSet ?? setCachedDomainVerdict;

  const rawEmailDomain = String(email || '').trim().toLowerCase().split('@')[1]?.trim() ?? '';
  const normalizedEmailDomain = normalizeCompanyDomain(email);

  // Website is derived from the (normalized) email domain — see D2.
  const websiteDomain = normalizedEmailDomain;
  const websiteUrl = normalizedEmailDomain ? `https://www.${normalizedEmailDomain}` : '';
  const normalizedWebsiteDomain = normalizeCompanyDomain(websiteUrl);

  const base = {
    emailDomain: rawEmailDomain,
    normalizedEmailDomain,
    websiteUrl,
    websiteDomain,
    normalizedWebsiteDomain,
    companyIdentityDomain: normalizedEmailDomain,
  } as const;

  // Malformed / missing domain.
  if (!normalizedEmailDomain) return block(base, 'BLOCKED', false);

  // ── Phase 11D cache: a recent SUCCESSFUL verdict for this domain lets us skip
  // the expensive eligibility + DNS/website probe. The claimed-domain check (DB
  // state, changes over time) is ALWAYS re-run on a hit, so the cache can never
  // let a now-claimed domain through. Only clean successes are ever cached, so a
  // hit is always eligible=true. Validation policy is unchanged.
  const cached = cacheGet(normalizedEmailDomain, now());
  if (cached) {
    const claimedOnHit = await lookupClaimedCompany(normalizedEmailDomain);
    if (claimedOnHit) return block(base, 'CLAIMED_DOMAIN', false, claimedOnHit);
    return {
      ...base,
      websiteUrl: cached.websiteUrl,
      websiteDomain: cached.websiteDomain,
      normalizedWebsiteDomain: cached.normalizedWebsiteDomain,
      companyIdentityDomain: cached.companyIdentityDomain,
      eligible: true,
      validationReason: null,
      requiresManualReview: false,
      existingCompany: null,
    };
  }

  // ── A,B: personal / MX / disposable / blocked / forwarding-MX ──────────────
  const eligibility = await checkEligibility(email);
  if (!eligibility.eligible) {
    // PUBLIC_EMAIL / DISPOSABLE_EMAIL / NO_EMAIL_CAPABILITY / BLOCKED → hard block.
    // FORWARDING_DOMAIN → manual-review path.
    const review = eligibility.result === 'FORWARDING_DOMAIN';
    return block(base, eligibility.result, review);
  }

  // ── Rule 4: derived website must match email domain (always true under D2) ──
  if (normalizedWebsiteDomain && normalizedWebsiteDomain !== normalizedEmailDomain) {
    return block(base, 'DOMAIN_MISMATCH', false);
  }

  // ── Rule 5: domain already claimed by another organization ─────────────────
  const claimed = await lookupClaimedCompany(normalizedEmailDomain);
  if (claimed) return block(base, 'CLAIMED_DOMAIN', false, claimed);

  // ── C,D,F: live website existence / reachability / canonical / forwarding ──
  const resolution = await probeWebsite(normalizedEmailDomain);
  if (resolution.resolution_blocked) {
    // SSRF / private-IP — hard block, never a review candidate.
    return block(base, 'BLOCKED', false);
  }
  if (resolution.resolution_failed) {
    // The resolver collapses DNS/timeout/network failures into one flag. The
    // staged classifier (c-ares → getaddrinfo → DoH → MX → NS) re-derives what
    // actually exists so a HARD reject is issued ONLY on a unanimous, definitive
    // absence — every ambiguity becomes a review or a retry, never a permanent
    // rejection of a real organisation (PROD-CX-004 §2/§4/§6).
    const dnsClass = await classifyDomainDns(normalizedEmailDomain);
    if (dnsClass === 'no_records') {
      // UNANIMOUS across every resolver: no A/AAAA, no MX, no NS anywhere → the
      // domain does not exist → the ONLY hard reject (requiresManualReview=false).
      return block(base, 'NO_WEBSITE_FOUND', false);
    }
    if (dnsClass === 'transient') {
      // We genuinely cannot determine existence right now (resolvers flaking) →
      // "try again" (503), which is recoverable and self-heals. Never a reject.
      throw new WebsiteProbeTransientError(normalizedEmailDomain);
    }
    if (dnsClass === 'has_records' || dnsClass === 'registered_no_web') {
      // The domain provably EXISTS and is a real, active organisation:
      //   • has_records       → a web host resolves via at least one resolver;
      //   • registered_no_web → MX/NS publish a real registered/delegated domain.
      // In BOTH cases valid MX was already proven by the eligibility stage (rule
      // 2) — the organisation demonstrably receives mail (it received our signup
      // email). Only the website was unreachable from our egress, which on
      // serverless is frequently a REGIONAL DNS artefact (some authoritative NS
      // are slow/unresolvable from a given runtime) rather than a real absence.
      // Blocking here would false-reject a confirmed-real organisation, which is
      // exactly what PROD-CX-004 forbids. Mark AUTO-APPROVABLE (§6): email
      // ownership is proven downstream by the verification that gates account
      // creation, so no unverified account is ever created. Never a hard reject.
      return { ...block(base, 'NO_WEBSITE_FOUND', true), autoApprovable: true };
    }
    // (unreachable in practice: eligibility already proved MX, so classifyDomainDns
    // will always find at least MX → registered_no_web) — defensive hard reject
    // only if the domain publishes absolutely nothing anywhere.
    return block(base, 'NO_WEBSITE_FOUND', false);
  }
  if (resolution.input_domain !== resolution.final_domain) {
    return block(base, 'DOMAIN_NOT_CANONICAL', true);
  }
  if (resolution.is_forwarding) {
    return block(base, 'FORWARDING_DOMAIN', true);
  }

  // ── AUTH-001 §7: parked / expired-lander content check ─────────────────────
  // Runs ONLY when every prior rule passed (one bounded extra GET on the
  // account-creating path). Fail-open: an unchecked probe never blocks.
  // A positive match routes to manual review, mirroring NO_WEBSITE_FOUND.
  const parkedVerdict = await probeParked(resolution.final_domain);
  if (parkedVerdict.parked) {
    return {
      ...block(base, 'PARKED_DOMAIN', true),
      diagnostics: { parkedMarker: parkedVerdict.marker },
    };
  }

  // All five rules satisfied — cache the SUCCESSFUL domain verdict (clean success
  // only; every block()/review-required path above returned without caching, so
  // failures, timeouts, DNS errors, blocks, and review outcomes are never cached).
  cacheSet(normalizedEmailDomain, {
    websiteUrl: base.websiteUrl,
    websiteDomain: base.websiteDomain,
    normalizedWebsiteDomain: base.normalizedWebsiteDomain,
    companyIdentityDomain: base.companyIdentityDomain,
    reviewRequired: false,
    cachedAt: now(),
  });

  return {
    ...base,
    eligible: true,
    validationReason: null,
    requiresManualReview: false,
    existingCompany: null,
  };
}
