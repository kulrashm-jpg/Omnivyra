/**
 * How much an alias proves. An IR link, the company's own JSON-LD site root,
 * or a redirect say "this domain is ours". A same-brand-label link only
 * suggests AFFILIATION — live, infosys.com → infosys.org is the Infosys
 * FOUNDATION, a separate legal entity — so it is SUPPORTING, never decisive.
 *
 * Its own module (CPG-012) so sourceRegistry can read it without importing
 * domainIdentity, which itself imports sourceRegistry — a runtime cycle the
 * architecture audit blocks. domainIdentity re-exports it unchanged.
 */

import type { DomainAlias } from '../types';

export const ALIAS_STRENGTH: Readonly<Record<DomainAlias['evidence'], 'DECISIVE' | 'SUPPORTING'>> = Object.freeze({
  first_party_ir_link: 'DECISIVE',
  first_party_json_ld_sameAs: 'DECISIVE',
  redirect_from_canonical: 'DECISIVE',
  first_party_same_brand_link: 'SUPPORTING',
  official_filing_statement: 'DECISIVE',
});
