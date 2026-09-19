// CPG-C1(1) repository matcher and CPG-C1(6) development-only registry matcher
// (candidate-002 §17). Deliberately CONSERVATIVE: a false positive only moves a
// company out of held-out; a false negative would contaminate held-out.

const LEGAL_SUFFIXES = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co', 'limited', 'ltd', 'plc', 'llc', 'lp',
  'gmbh', 'ag', 'se', 'sa', 's a', 'sas', 's a s', 'nv', 'bv', 'ltda', 'spa', 'ab', 'oy', 'asa',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Example Holdings, Inc." → ["Example Holdings, Inc.", "Example Holdings"] (distinct, non-trivial). */
export function nameVariants(name) {
  const out = new Set([name.trim()]);
  let stripped = name.trim().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of LEGAL_SUFFIXES) {
      const re = new RegExp(`\\s+${escapeRe(suf)}$`, 'i');
      if (re.test(stripped)) { stripped = stripped.replace(re, '').trim(); changed = true; }
    }
  }
  if (stripped.length >= 3) out.add(stripped);
  return [...out];
}

/** Word-boundary, case-insensitive, whitespace/underscore/hyphen-flexible pattern for a name. */
export function namePattern(name) {
  const body = name.split(/\s+/).map(escapeRe).join('[\\s_-]+');
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'i');
}

export function domainPattern(domain) {
  return new RegExp(`(?<![A-Za-z0-9-])${escapeRe(domain)}(?![A-Za-z0-9-])`, 'i');
}

export function identifierPattern(value) {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])`);
}

/**
 * Decision D-D — the CPG-C1(1) scan scope, as two named path classes.
 *   TEST: committed test fixtures, snapshots, mocks, specs.
 *   CPG_IMPLEMENTATION: CPG's own source, evaluation harnesses, routes and UI —
 *     companies named there were used while building CPG even if no test cites them.
 */
export const TEST_PATH = /(^|\/)(tests?|__tests__|fixtures?|__snapshots__|__mocks__|e2e)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|\.snap$/i;
export const CPG_IMPLEMENTATION_PATH = /^(backend\/services\/companyProfile\/|backend\/evaluation\/|pages\/api\/company-profile\/|pages\/api\/company-grounding\/|components\/companyProfile|components\/companyFacts)/;

export function scanScope(p) {
  if (TEST_PATH.test(p)) return 'TEST';
  if (CPG_IMPLEMENTATION_PATH.test(p)) return 'CPG_IMPLEMENTATION';
  return null;
}

/** Build the token list for one candidate. UNKNOWN values produce no token. */
export function tokensFor(candidate) {
  const tokens = [];
  for (const v of nameVariants(candidate.company_name)) tokens.push({ kind: 'name', value: v, re: namePattern(v) });
  if (candidate.canonical_domain && candidate.canonical_domain !== 'UNKNOWN') {
    tokens.push({ kind: 'domain', value: candidate.canonical_domain, re: domainPattern(candidate.canonical_domain) });
  }
  for (const id of [candidate.identifier_value, candidate.wikidata_qid].filter(Boolean)) {
    tokens.push({ kind: 'identifier', value: id, re: identifierPattern(id) });
  }
  return tokens;
}

/** Scan one file's text; returns [{kind, value, line}] with at most one hit per token per file. */
export function scanText(text, tokens) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (const t of tokens) {
    const idx = lines.findIndex((l) => t.re.test(l));
    if (idx >= 0) hits.push({ kind: t.kind, value: t.value, line: idx + 1 });
  }
  return hits;
}

/**
 * CPG-C1(6) — match a candidate against the protocol-frozen development-only registry.
 * A registry name matches if it appears as a whole word in any candidate name variant
 * (so a registry name also matches any longer company name containing it as a whole word — conservative by design); a registry domain
 * matches the candidate domain exactly or as a parent domain.
 */
export function registryMatches(candidate, registry) {
  const out = [];
  const names = nameVariants(candidate.company_name);
  const domain = candidate.canonical_domain && candidate.canonical_domain !== 'UNKNOWN' ? candidate.canonical_domain.toLowerCase() : null;
  for (const entry of registry.entries) {
    const nameHit = entry.names.find((n) => names.some((v) => namePattern(n).test(v)));
    const domainHit = domain && entry.domains.find((d) => domain === d || domain.endsWith(`.${d}`));
    if (nameHit || domainHit) {
      out.push({ entry_id: entry.id, matched: nameHit ? `name "${nameHit}"` : `domain "${domainHit}"`, basis: entry.basis });
    }
  }
  return out;
}
