/**
 * CPG-001 / CPG-009 — entity resolution: is this document about THIS company?
 *
 * THE RULE THIS ENFORCES: two companies must never be merged because their
 * names look alike. Name similarity alone can never produce identity strong
 * enough to verify anything, however many sources repeat the name.
 *
 * ─── CPG-009 IDENTITY HIERARCHY (deterministic, no fuzzy proof) ────────────
 *   DECISIVE   near-unique, hard to coincide on:
 *                · the company's canonical domain, or a secondary domain whose
 *                  association is ESTABLISHED by explicit evidence (DomainAlias);
 *                · the document is hosted on such a domain (first party);
 *                · the document's own statement of the company's website
 *                  (JSON-LD Organization url/sameAs, a "Website" field, a
 *                  structured source's official-website property);
 *                · registry identifier; LinkedIn company identifier.
 *   SUPPORTING leadership names; a link to the company's domain; location.
 *   WEAK       company name (or an established former name).
 *
 *   Classes:  DECISIVE    ≥1 decisive match, no decisive contradiction
 *             SUPPORTING  a non-name supporting signal + name or location
 *             WEAK        name and/or location only
 *             MISMATCH    a decisive identifier contradicted, or nothing matched
 *             UNKNOWN     nothing comparable
 *
 * A single CONTRADICTED decisive signal forces MISMATCH, whatever else agrees:
 * agreeing on a name while disagreeing on the website is the signature of two
 * different companies.
 *
 * Identity strength means "strength of evidence that this document refers to
 * this company". It is NOT a probability, and it is NOT field-evidence strength.
 * The weights are ENGINEERING DEFAULTS, uncalibrated.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type {
  DomainAlias, EntityMatch, EntityMatchStatus, EntitySignals, IdentityClass, IdentitySignal,
} from './types';
import { ALIAS_STRENGTH } from './acquisition/domainIdentity';
import { registrableDomain } from './acquisition/sourceRegistry';
import { compareRegistryIds, entityIdentityKey, legalNamesEquivalent, normalizeLegalName } from './registryIdentity';
import { foldForComparison } from './textFold';

const DECISIVE_WEIGHT = 0.55;
const LEADERSHIP_WEIGHT = 0.25;
const LOCATION_WEIGHT = 0.12;
const DOMAIN_LINK_WEIGHT = 0.12;
const NAME_WEIGHT = 0.08;

/**
 * ⚠️ CPG-009 FIX — only LEGAL FORMS are stripped. The first version also
 * stripped "technologies", "solutions" and "holdings", so "Acme Holdings" (a
 * parent) and "Acme Technologies" (the target) both became "acme" and matched
 * perfectly — a parent/subsidiary collapse built into name comparison.
 *
 * ⚠️ CPG-010 — ONE legal-name normaliser (registryIdentity.normalizeLegalName),
 * and legal forms are stripped only as a TRAILING run: `\bco\b` also matched
 * the "co" of "Co-operative", and "private" was stripped from "Private Equity".
 */
export function normalizeName(s: string): string {
  return normalizeLegalName(s);
}

export function normalizeDomain(d: string | null): string | null {
  if (!d) return null;
  const raw = d.trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = raw.includes('://') ? new URL(raw).hostname : raw.split('/')[0];
    return host.replace(/^www\./, '');
  } catch {
    return raw.replace(/^www\./, '');
  }
}

function normalizeLinkedIn(u: string | null): string | null {
  if (!u) return null;
  const m = u.toLowerCase().match(/linkedin\.com\/company\/([^/?#]+)/);
  return m ? m[1] : (/^[a-z0-9-]+$/.test(u.toLowerCase()) ? u.toLowerCase() : null);
}

function normalizePerson(s: string): string {
  // CPG-012: script-neutral (was [^a-z ], which folded every non-Latin name to "").
  return foldForComparison(s).replace(/\p{N}+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Jaccard over name tokens. Deliberately NOT used as a decisive signal. */
function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / new Set([...ta, ...tb]).size;
}

/**
 * Hosts that appear in `sameAs` for every company. A JSON-LD Organization
 * listing them says nothing about which company it is, so they can never
 * CONTRADICT the canonical domain.
 */
const PROFILE_HOSTS = /(^|\.)(linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|github\.com|wikipedia\.org|wikidata\.org|crunchbase\.com|medium\.com|tiktok\.com|t\.me|glassdoor\.com|apple\.com|play\.google\.com)$/;

/** Does `host` belong to the company — canonical domain (or subdomain), or an ESTABLISHED alias? */
function ownDomain(host: string | null, canonical: string | null, aliases: readonly DomainAlias[]):
  { how: 'canonical' } | { how: 'alias'; alias: DomainAlias } | null {
  if (!host) return null;
  const within = (h: string, d: string) => h === d || h.endsWith(`.${d}`);
  if (canonical && within(host, canonical)) return { how: 'canonical' };
  for (const a of aliases) {
    const d = normalizeDomain(a.domain);
    if (d && within(host, d)) return { how: 'alias', alias: a };
  }
  return null;
}

const DOMAIN_SIGNALS = new Set<IdentitySignal['signal']>(['domain', 'domain_alias', 'first_party_host', 'domain_statement']);

/**
 * Resolve whether `candidate` (a document's signals) refers to the same company
 * as `known`. Returns `unresolved`/UNKNOWN when there is nothing to compare —
 * absence of evidence is not evidence of a different company.
 */
export function resolveEntity(known: EntitySignals, candidate: EntitySignals): EntityMatch {
  const signals: IdentitySignal[] = [];
  const add = (s: IdentitySignal) => signals.push(s);
  const canonical = normalizeDomain(known.domain);
  const aliases = known.domainAliases ?? [];
  const aliasDetail = (a: DomainAlias) => `established alias ${a.domain} (${a.evidence}: ${a.detail})`;

  // ── decisive: the source declares itself the company's site ─────────────
  const cd = normalizeDomain(candidate.domain);
  if (canonical && cd) {
    const o = ownDomain(cd, canonical, aliases);
    if (o?.how === 'canonical') add({ signal: 'domain', strength: 'DECISIVE', outcome: 'match', detail: `domain ${cd} is the company's canonical domain` });
    else if (o?.how === 'alias') add({ signal: 'domain_alias', strength: ALIAS_STRENGTH[o.alias.evidence], outcome: 'match', detail: aliasDetail(o.alias) });
    else add({ signal: 'domain', strength: 'DECISIVE', outcome: 'conflict', detail: `domain ${cd} differs from the company's domain ${canonical}` });
  }

  // ── decisive: the document is hosted on the company's own domain ────────
  const host = normalizeDomain(candidate.sourceHost ?? null);
  if (host && canonical) {
    const o = ownDomain(host, canonical, aliases);
    if (o?.how === 'canonical') add({ signal: 'first_party_host', strength: 'DECISIVE', outcome: 'match', detail: `document hosted on the company's domain (${host})` });
    // An alias proves only what its evidence proves: an IR link is decisive,
    // a same-brand-label link is affiliation (SUPPORTING).
    else if (o?.how === 'alias') add({ signal: 'domain_alias', strength: ALIAS_STRENGTH[o.alias.evidence], outcome: 'match', detail: `document hosted on ${aliasDetail(o.alias)}` });
    // A third-party host is not a contradiction: publishers write about companies.
  }

  // ── decisive: registry identifiers (CPG-010 §6) ─────────────────────────
  // Compared SCHEME BY SCHEME after normalisation (CIK:0001477333 = CIK 1477333).
  // Same id → the same legal entity (DECISIVE). A different id in the same
  // scheme → a different legal entity (MISMATCH), however alike the names: a
  // parent and its subsidiary have different CIKs. Different schemes do not
  // compare. Only ESTABLISHED identities are on the known side — see
  // acquisition/registryEstablishment.ts for how one becomes established.
  // ⚠️ CPG-011 — only SUBJECT identities decide. A site publisher named by the
  // company's legal notice, or a parent a registry reports, is a DIFFERENT
  // legal entity: it must neither verify nor, by its own scheme, contradict.
  const roleOf = (r: { role?: string }) => r.role ?? 'subject';
  const subjects = (known.registryIdentities ?? []).filter((r) => roleOf(r) === 'subject');
  const others = (known.registryIdentities ?? []).filter((r) => roleOf(r) !== 'subject');
  const knownIds = [known.registryId, ...subjects.map((r) => r.registryId)];
  // CPG-012: membership by LEGAL-ENTITY key (an establishment id names its company).
  const norm = (x: string | null | undefined) => entityIdentityKey(x);
  const knownIdSet = new Set(knownIds.map(norm).filter((x): x is string => !!x));
  const candidateIds = [candidate.registryId, ...(candidate.registryIdentities ?? []).map((r) => r.registryId)];
  const cmp = compareRegistryIds(knownIds, candidateIds);
  for (const id of cmp.matches) {
    add({ signal: 'registry_id', strength: 'DECISIVE', outcome: 'match', detail: `registry id ${id} is the company's established identifier` });
  }
  const relatedIds = new Set(others.filter((o) => o.role === 'related_entity').map((o) => norm(o.registryId)).filter((x): x is string => !!x));
  for (const c of cmp.conflicts) {
    // An explicitly related entity is explained by its relationship below.
    if (c.candidate.every((id) => relatedIds.has(norm(id) ?? ''))) continue;
    add({ signal: 'registry_id', strength: 'DECISIVE', outcome: 'conflict',
      detail: `registry id ${c.candidate.join(', ')} differs from the company's ${c.known.join(', ')} (${c.scheme}: a different legal entity)` });
  }
  const candidateSet = new Set(candidateIds.map(norm).filter((x): x is string => !!x));
  for (const o of others) {
    const id = norm(o.registryId);
    if (!id || !candidateSet.has(id) || knownIdSet.has(id)) continue;
    if (o.role === 'related_entity') {
      add({ signal: 'registry_id', strength: 'DECISIVE', outcome: 'conflict',
        detail: `the document is about ${o.legalName ?? id} (${id}), which a registry reports as a related legal entity (${o.chain[0]?.detail ?? 'relationship'}) — not the company itself` });
    } else {
      add({ signal: 'relationship', strength: 'SUPPORTING', outcome: 'note',
        detail: `the document is about ${o.legalName ?? id} (${id}), the legal entity the company's own legal notice names as its site publisher — its relationship to the company is not established` });
    }
  }

  const kl = normalizeLinkedIn(known.linkedinUrl), cl = normalizeLinkedIn(candidate.linkedinUrl);
  if (kl && cl) {
    add(kl === cl
      ? { signal: 'linkedin', strength: 'DECISIVE', outcome: 'match', detail: `LinkedIn company ${cl}` }
      : { signal: 'linkedin', strength: 'DECISIVE', outcome: 'conflict', detail: `LinkedIn company ${cl} differs from ${kl}` });
  }

  // ── what the document itself STATES about identity ──────────────────────
  let statedLocation: string | null = null;
  const statesOwnOfficialWebsite = !!canonical && (candidate.identityEvidence ?? []).some(
    (ev) => ev.kind === 'structured_official_website' && !!ownDomain(normalizeDomain(ev.value), canonical, aliases));
  for (const ev of candidate.identityEvidence ?? []) {
    switch (ev.kind) {
      case 'json_ld_org_url':
      case 'structured_official_website':
      case 'labelled_website': {
        const h = normalizeDomain(ev.value);
        const o = ownDomain(h, canonical, aliases);
        if (!canonical) break;
        // ⚠️ CPG-009 LIVE FIX — a publisher's JSON-LD often gives the
        // Organization's `url` as its OWN profile page (tracxn.com/d/companies/
        // cloudflare). That is self-reference, not a website claim; reading it
        // as "a different website" rejected valid Tracxn evidence as MISMATCH.
        if (h && host && registrableDomain(h) === registrableDomain(host)) break;
        if (o) {
          add({ signal: 'domain_statement', strength: o.how === 'alias' ? ALIAS_STRENGTH[o.alias.evidence] : 'DECISIVE', outcome: 'match',
            detail: `document states the company's website: ${ev.detail}${o.how === 'alias' ? ` — via ${aliasDetail(o.alias)}` : ''}` });
        } else if (ev.kind === 'structured_official_website' && statesOwnOfficialWebsite) {
          // ⚠️ CPG-012 LIVE DEFECT (Tesco): Wikidata lists ONE entity's official websites
          // — tescoplc.com, tesco.ie, tesco.hu, … Each non-matching entry was scored as a
          // contradiction, so the entity that lists the company's own site became a
          // MISMATCH. One entity's other sites are not a different company.
          break;
        } else if (ev.kind !== 'labelled_website' && h && !PROFILE_HOSTS.test(h)) {
          // A labelled "Website" field is only read positively (a page may list
          // many companies); a structured statement ABOUT the named subject
          // that gives another website is a contradiction.
          add({ signal: 'domain_statement', strength: 'DECISIVE', outcome: 'conflict',
            detail: `document states a DIFFERENT website (${h}) for the named company: ${ev.detail}` });
        }
        break;
      }
      case 'registry_id': {
        // Read positively only: a page can list several entities' identifiers
        // (a group's subsidiaries), so a different one stated in the body is
        // not a contradiction — unlike the id a registry record DECLARES.
        const n = norm(ev.value);
        if (n && knownIdSet.has(n)) add({ signal: 'registry_id', strength: 'DECISIVE', outcome: 'match', detail: `document states registry id ${ev.value}` });
        break;
      }
      case 'linkedin_company':
        if (kl && normalizeLinkedIn(ev.value) === kl) add({ signal: 'linkedin', strength: 'DECISIVE', outcome: 'match', detail: `document links LinkedIn company ${kl}` });
        break;
      case 'domain_link':
        if (ownDomain(normalizeDomain(ev.value), canonical, aliases)) {
          add({ signal: 'domain_link', strength: 'SUPPORTING', outcome: 'match', detail: `document links to the company's domain (${ev.value})` });
        }
        break;
      case 'relationship':
        add({ signal: 'relationship', strength: 'SUPPORTING', outcome: 'note', detail: `document states a relationship: ${ev.value} — ${ev.detail}` });
        break;
      case 'location_statement':
        statedLocation ??= ev.value;
        break;
      case 'former_name_statement':
        add({ signal: 'relationship', strength: 'SUPPORTING', outcome: 'note', detail: `document states a former name: ${ev.value}` });
        break;
    }
  }

  // ── supporting ────────────────────────────────────────────────────────────
  if (known.leadership.length > 0 && candidate.leadership.length > 0) {
    const kset = new Set(known.leadership.map(normalizePerson).filter(Boolean));
    const overlap = candidate.leadership.map(normalizePerson).filter((p) => !!p && kset.has(p));
    if (overlap.length > 0) add({ signal: 'leadership', strength: 'SUPPORTING', outcome: 'match', detail: `leadership ${overlap.join(', ')}` });
  }

  const candLocation = candidate.location ?? statedLocation;
  if (known.location && candLocation) {
    const a = normalizeName(known.location), b = normalizeName(candLocation);
    // Location SUPPORTS but never proves; a different location contradicts only weakly.
    add(a && b && (a === b || a.includes(b) || b.includes(a))
      ? { signal: 'location', strength: 'SUPPORTING', outcome: 'match', detail: `location ${candLocation}` }
      : { signal: 'location', strength: 'SUPPORTING', outcome: 'conflict', detail: `location ${candLocation} differs from ${known.location}` });
  }

  let nameSim = 0;
  if (known.companyName && candidate.companyName) {
    nameSim = nameSimilarity(known.companyName, candidate.companyName);
    if (nameSim >= 0.6) {
      add({ signal: 'name', strength: 'WEAK', outcome: 'match', detail: `name "${candidate.companyName}"` });
    } else {
      const former = (known.formerNames ?? []).find((f) => nameSimilarity(f.name, candidate.companyName) >= 0.6);
      if (former) {
        nameSim = nameSimilarity(former.name, candidate.companyName);
        add({ signal: 'former_name', strength: 'WEAK', outcome: 'match', detail: `former name "${former.name}" (established: ${former.evidence})` });
      } else {
        add({ signal: 'name', strength: 'WEAK', outcome: 'conflict', detail: `name "${candidate.companyName}" is not "${known.companyName}"` });
      }
    }
  }

  // ── CPG-010: a registry record's LEGAL name — WEAK, like any name (§6) ──
  // Equality (legal form aside) supports; a difference is only a note — a
  // brand and its legal entity legitimately differ (Zerodha / Zerodha Broking
  // Limited), and a name can never override, or stand in for, a registry id.
  const legal = candidate.legalEntity ?? null;
  if (legal) {
    const knownLegal = [known.legalEntity, known.companyName,
      // CPG-011: only the company's OWN legal names — a publisher's or parent's name is not the company's.
      ...subjects.flatMap((r) => [r.legalName, ...(r.formerNames ?? []).map((f) => f.name)])]
      .filter((x): x is string => !!x);
    const eq = knownLegal.find((n) => legalNamesEquivalent(n, legal));
    add(eq
      ? { signal: 'legal_name', strength: 'WEAK', outcome: 'match', detail: `legal name "${legal}" equals "${eq}" (legal form aside)` }
      : { signal: 'legal_name', strength: 'WEAK', outcome: 'note', detail: `legal name "${legal}" is not a known name of the company — names never decide identity` });
  }

  // ── classification ───────────────────────────────────────────────────────
  const is = (s: IdentitySignal, strength: IdentitySignal['strength'], outcome: IdentitySignal['outcome']) =>
    s.strength === strength && s.outcome === outcome;
  const decisiveMatch = signals.some((s) => is(s, 'DECISIVE', 'match'));
  const decisiveConflict = signals.some((s) => is(s, 'DECISIVE', 'conflict'));
  const matched = (name: IdentitySignal['signal']) => signals.some((s) => s.signal === name && s.outcome === 'match');
  const nameLike = matched('name') || matched('former_name') || matched('legal_name');
  const supportingNonName = matched('leadership') || matched('domain_link')
    || signals.some((s) => s.strength === 'SUPPORTING' && s.outcome === 'match' && (s.signal === 'domain_alias' || s.signal === 'domain_statement'));
  const compared = signals.some((s) => s.outcome !== 'note');

  let identity: IdentityClass;
  let reason: string;
  const firstDetail = (pred: (s: IdentitySignal) => boolean) => signals.find(pred)?.detail ?? '';
  if (!compared) {
    identity = 'UNKNOWN';
    reason = 'no identity signal to compare';
  } else if (decisiveConflict) {
    identity = 'MISMATCH';
    reason = `a decisive identifier is contradicted: ${firstDetail((s) => is(s, 'DECISIVE', 'conflict'))}`;
  } else if (decisiveMatch) {
    identity = 'DECISIVE';
    reason = firstDetail((s) => is(s, 'DECISIVE', 'match'));
  } else if (supportingNonName && (nameLike || matched('location'))) {
    identity = 'SUPPORTING';
    reason = `name plus supporting evidence (${signals.filter((s) => s.strength === 'SUPPORTING' && s.outcome === 'match').map((s) => s.signal).join(', ')}) — no decisive identifier`;
  } else if (signals.some((s) => s.outcome === 'match')) {
    identity = 'WEAK';
    reason = `${nameLike ? 'name' : 'location/leadership'} only — no domain, registry, LinkedIn or website statement ties this document to the company`;
  } else {
    identity = 'MISMATCH';
    reason = `nothing matches: ${signals.filter((s) => s.outcome === 'conflict').map((s) => s.detail).join('; ')}`;
  }

  // ── score (legacy numeric strength; identity, not truth) ─────────────────
  let score = 0;
  if (signals.some((s) => DOMAIN_SIGNALS.has(s.signal) && s.outcome === 'match' && s.strength === 'DECISIVE')) score += DECISIVE_WEIGHT;
  else if (signals.some((s) => DOMAIN_SIGNALS.has(s.signal) && s.outcome === 'match')) score += DOMAIN_LINK_WEIGHT;
  if (matched('registry_id')) score += DECISIVE_WEIGHT;
  if (matched('linkedin')) score += DECISIVE_WEIGHT;
  if (matched('leadership')) score += LEADERSHIP_WEIGHT;
  if (matched('location')) score += LOCATION_WEIGHT;
  if (matched('domain_link')) score += DOMAIN_LINK_WEIGHT;
  if (nameLike) score += NAME_WEIGHT * nameSim;
  score = Math.min(1, Number(score.toFixed(6)));

  // Legacy status, derived from the identity class (kept for confidence
  // weighting and compatibility; the verification gate reads `identity`).
  const status: EntityMatchStatus = identity === 'DECISIVE' ? (score >= 0.75 ? 'exact' : 'strong')
    : identity === 'SUPPORTING' ? 'strong'
    : identity === 'WEAK' ? 'weak'
    : identity === 'MISMATCH' ? 'mismatch' : 'unresolved';

  const legacy = (s: IdentitySignal) => (DOMAIN_SIGNALS.has(s.signal) ? 'domain' : s.signal === 'former_name' ? 'name' : s.signal);
  const matchedOn = [...new Set(signals.filter((s) => s.outcome === 'match').map(legacy))].sort();
  const conflictingOn = [...new Set(signals.filter((s) => s.outcome === 'conflict').map(legacy))].sort();
  return { status, score, identity, signals, reason, matchedOn, conflictingOn };
}

/**
 * Entity-match contribution to field confidence.
 *
 * `unresolved` scores ZERO, not a consolation fraction — same reasoning as
 * `unknown` freshness. Being unable to confirm that a source refers to THIS
 * company is not weak evidence of identity; it is no evidence of identity.
 *
 * CPG-005 surfaced why this matters: a field with no evidence at all still
 * scored 3/100, because an unresolved match earned 0.2 x 15. A completely
 * unevidenced field must score 0.
 */
export const ENTITY_MATCH_WEIGHT: Readonly<Record<EntityMatchStatus, number>> = Object.freeze({
  exact: 1.0, strong: 0.8, weak: 0.4, unresolved: 0, mismatch: 0,
});
