/**
 * Company registry evidence for the Digital Snapshot — the existing company-profile grounding core
 * (companyProfile/grounding), run inside the report's public research. Nothing is persisted.
 *
 *   1. establishIdentity reads the company's own homepage plus up to two legal-notice / imprint and
 *      two investor pages (SSRF-safe fetcher, one shared time budget) and extracts identifiers the
 *      company STATES: CIN / LLPIN (India), LEI, UK company number, SIREN, CNPJ, SEC CIK, listings.
 *   2. Each identifier goes to its national registry where that registry can be read automatically
 *      (GLEIF, SEC EDGAR, France Sirene, Brazil CNPJ — keyless). Registries that block automated
 *      access (India MCA: HTTP 403 + CAPTCHA) or need a credential (UK Companies House, Japan) are
 *      recorded as such — never as "not found".
 *   3. GLEIF can confirm a stated national number (e.g. an Indian CIN) when a GLEIF record names it
 *      for the same legal entity (registeredAs cross-reference).
 *
 * Statuses: verified (a registry confirmed an identifier for this company) · stated_unverified (the
 * company states one; no registry could confirm it) · none_stated (no identifier on the pages read)
 * · failed (the step could not run). An identifier the company does not state is unknown, not absent.
 */
import { establishIdentity } from '../../companyProfile/grounding/acquisition/identityEstablishment';
import { createSafeEvidenceFetcher } from '../../companyProfile/grounding/acquisition/safeEvidenceFetcher';
import type { EvidenceFetcher } from '../../companyProfile/grounding/acquisition/evidenceSource';

export type RegistryStatus = 'verified' | 'stated_unverified' | 'none_stated' | 'failed';

export type RegistryEvidence = {
  status: RegistryStatus;
  checkedAt: string;
  detail: string;
  /** First-party pages the step read, with their HTTP status (null = no response). */
  pagesRead: Array<{ url: string; status: number | null; role: string }>;
  identifiers: Array<{
    /** Scheme-qualified, e.g. "CIN:U72900KA2023PTC123456", "LEI:5493…". */
    id: string;
    scheme: string;
    provider: string;
    legalName: string | null;
    status: string | null;
    jurisdiction: string | null;
    /** Confirmed by the registry itself (not just stated by the company). */
    verified: boolean;
    role: 'subject' | 'site_publisher' | 'related_entity' | null;
    establishedBy: string;
    /** Where the statement or confirmation came from. */
    sourceUrl: string | null;
  }>;
  /** Registries that were relevant but could not be read, and why (inaccessible, credential required…). */
  unavailable: Array<{ id: string; provider: string; outcome: string; detail: string }>;
};

/** Country names from the company's declared markets → ISO codes the registry layer selects on. Pure. */
export function jurisdictionsFrom(values: Array<string | null | undefined>): string[] {
  const MAP: Array<[RegExp, string]> = [
    [/\bindia\b/i, 'IN'], [/\b(united kingdom|uk|england|scotland|wales|great britain)\b/i, 'GB'], [/\b(united states|usa|u\.s\.|us)\b/i, 'US'],
    [/\bfrance\b/i, 'FR'], [/\bgermany\b/i, 'DE'], [/\bbrazil\b/i, 'BR'], [/\bjapan\b/i, 'JP'], [/\bsingapore\b/i, 'SG'], [/\bsouth africa\b/i, 'ZA'],
  ];
  const out = new Set<string>();
  for (const v of values) for (const [re, code] of MAP) if (v && re.test(v)) out.add(code);
  return [...out];
}

/** Collect registry evidence for one company. Never throws. `fetcher` is a test seam. */
export async function collectRegistryEvidence(input: {
  domain: string;
  companyNames: string[];
  jurisdictions: string[];
  knownIdentifiers?: string[];
  fetcher?: EvidenceFetcher;
  budgetMs?: number;
  now?: () => Date;
}): Promise<RegistryEvidence> {
  const checkedAt = (input.now ?? (() => new Date()))().toISOString();
  try {
    const report = await establishIdentity({
      canonicalDomain: input.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      fetcher: input.fetcher ?? createSafeEvidenceFetcher({ budgetMs: input.budgetMs ?? 25_000 }),
      retrievedAt: checkedAt,
      companyNames: input.companyNames.filter(Boolean),
      jurisdictions: input.jurisdictions,
      knownIdentifiers: input.knownIdentifiers ?? [],
    });
    const identifiers: RegistryEvidence['identifiers'] = report.registryIdentities.map((i) => ({
      id: i.registryId, scheme: String(i.scheme), provider: i.provider, legalName: i.legalName ?? null, status: i.status ?? null,
      jurisdiction: i.jurisdiction ?? null, verified: Boolean(i.registryVerified), role: i.role ?? null, establishedBy: i.establishedBy,
      sourceUrl: i.chain?.find((s) => s.sourceUrl)?.sourceUrl ?? null,
    }));
    const unavailable = (report.registry?.candidates ?? [])
      .filter((c) => ['inaccessible', 'credential_required', 'not_implemented', 'record_unavailable'].includes(c.outcome))
      .map((c) => ({ id: c.registryId, provider: c.providerId, outcome: c.outcome, detail: c.detail.slice(0, 240) }));
    const verified = identifiers.filter((i) => i.verified && i.role !== 'related_entity');
    const status: RegistryStatus = verified.length ? 'verified' : identifiers.length || unavailable.length ? 'stated_unverified' : 'none_stated';
    const pagesRead = report.pagesRead.map((p) => ({ url: p.url, status: p.status ?? null, role: String(p.role) }));
    const read = pagesRead.filter((p) => p.status && p.status < 400).length;
    const detail = status === 'verified'
      ? `${verified.map((i) => `${i.id}${i.legalName ? ` (${i.legalName})` : ''}`).join('; ')} confirmed by ${[...new Set(verified.map((i) => i.provider))].join(', ')}.`
      : status === 'stated_unverified'
        ? `The company states ${[...new Set([...identifiers.map((i) => i.id), ...unavailable.map((u) => u.id)])].join(', ')}; no registry could confirm it automatically${unavailable.length ? ` (${unavailable.map((u) => `${u.provider}: ${u.outcome.replace(/_/g, ' ')}`).join('; ')})` : ''}.`
        : `No registration number (CIN, LEI, company number…) is stated on the ${read} page${read === 1 ? '' : 's'} read (homepage, legal and investor pages).`;
    return { status, checkedAt, detail, pagesRead, identifiers, unavailable };
  } catch (e) {
    return { status: 'failed', checkedAt, detail: `The registry step could not run: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`, pagesRead: [], identifiers: [], unavailable: [] };
  }
}
