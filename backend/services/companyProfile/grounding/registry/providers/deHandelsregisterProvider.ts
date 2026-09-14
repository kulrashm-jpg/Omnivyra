/**
 * CPG-012 — Germany: the commercial register (Handelsregister), behind the
 * provider contract.
 *
 *   jurisdiction DE → registry Handelsregister (≈147 register courts) → scheme DEHR
 *
 * IDENTIFIER SEMANTICS — materially different from CIK / CIN / SIREN / LEI:
 * a register number is unique only WITHIN ITS REGISTER COURT. "HRB 42243"
 * alone does not identify a company; "Amtsgericht München, HRB 42243" does.
 * The canonical value is therefore COMPOSITE: "<COURT>:<REGISTER><NUMBER>"
 * ("MUENCHEN:HRB42243"). A number without an identifiable court is INVALID —
 * the court is never guessed (a bare "Frankfurt" could be am Main or (Oder)).
 * Registers: HRA / HRB (commercial), GnR (cooperatives; GLEIF also writes
 * "GsR"), PR (partnerships), VR (associations). Berlin numbers may carry a
 * trailing "B" (HRB 12345 B), which is part of the number.
 *
 * GLEIF files each court as its own registration authority; the court table
 * (data/deRegisterCourts.ts) is generated from GLEIF's official list, so a
 * GLEIF cross-reference is exact: registeredAt names the court, registeredAs
 * the number.
 *
 * ACCESS — INACCESSIBLE from this environment: www.handelsregister.de refused
 * the TCP connection on every probe (CPG-012, three attempts); the portal is a
 * session/form application. Not worked around. The German vocabulary this
 * provider needs ("Impressum", "Amtsgericht", "Registergericht") lives HERE.
 */

import type { IdentifierScheme } from '../schemes';
import type { RegistryProvider } from '../providerContract';
import { DE_REGISTER_COURTS } from './data/deRegisterCourts';

/** Fold a court name to a key: umlauts expanded, case and punctuation dropped. */
export function courtKey(name: string): string {
  return name.normalize('NFC').toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS')
    .replace(/[^A-Z0-9]/g, '');
}
const RA_BY_COURT = new Map<string, string>(Object.entries(DE_REGISTER_COURTS).map(([ra, court]) => [courtKey(court), ra]));
const COURT_BY_RA = new Map<string, string>(Object.entries(DE_REGISTER_COURTS).map(([ra, court]) => [ra, courtKey(court)]));
/** English exonyms and common written variants → the register court's own name. Unlisted ambiguity (bare "Frankfurt") stays unresolved. */
const COURT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  MUNICH: 'MUENCHEN', COLOGNE: 'KOELN', NUREMBERG: 'NUERNBERG', HANOVER: 'HANNOVER', BRUNSWICK: 'BRAUNSCHWEIG',
  BERLIN: 'BERLINCHARLOTTENBURG', CHARLOTTENBURG: 'BERLINCHARLOTTENBURG', BERLINCHARLOTTENBURGHRB: 'BERLINCHARLOTTENBURG',
  FRANKFURTMAIN: 'FRANKFURTAMMAIN', FRANKFURTAM: 'FRANKFURTAMMAIN', FRANKFURTAMMAIN: 'FRANKFURTAMMAIN', FRANKFURTAMMAINHRB: 'FRANKFURTAMMAIN',
});
const REGISTER = /(HRA|HRB|GNR|GSR|PR|VR)\s*(\d{1,6})(?:\s?(B))?\b/i;

function resolveCourt(text: string): string | null {
  const k = courtKey(text.replace(/\b(Amtsgericht|Registergericht|Local\s+Court|Court\s+of\s+Registry|Register\s+court|Registry\s+court|AG|Sitz|Domicile|and|und)\b/gi, ' '));
  if (!k) return null;
  if (RA_BY_COURT.has(k)) return k;
  const alias = COURT_ALIASES[k];
  return alias && RA_BY_COURT.has(alias) ? alias : null;
}

/** Parse canonical "MUENCHEN:HRB42243" or free text "Amtsgericht München, HRB 42243" / "HRB 42243, Amtsgericht München". */
export function normalizeDehr(raw: string): string | null {
  const s = raw.normalize('NFC').trim();
  const canon = /^([A-Z0-9]+):(HRA|HRB|GNR|PR|VR)(\d{1,6}B?)$/.exec(s.toUpperCase());
  if (canon) return RA_BY_COURT.has(canon[1]) ? `${canon[1]}:${canon[2]}${canon[3]}` : null;
  const m = REGISTER.exec(s);
  if (!m) return null;
  const court = resolveCourt(s.replace(m[0], ' '));
  if (!court) return null;                       // court qualification is mandatory
  const type = m[1].toUpperCase() === 'GSR' ? 'GNR' : m[1].toUpperCase();
  return `${court}:${type}${m[2]}${m[3] ? 'B' : ''}`;
}
const splitValue = (v: string) => { const [court, reg] = v.split(':'); const m = /^(HRA|HRB|GNR|PR|VR)(\d+)(B?)$/.exec(reg); return { court, type: m?.[1] ?? '', num: m?.[2] ?? '', suffix: m?.[3] ?? '' }; };
const gleifType = (t: string) => (t === 'GNR' ? 'GnR' : t);

export const DEHR_SCHEME: IdentifierScheme = {
  code: 'DEHR', name: 'Handelsregister entry (court + register + number)', jurisdiction: 'DE', issuer: 'German register courts (Registergerichte)',
  normalize: normalizeDehr,
  documentPattern: (v) => { const x = splitValue(v); return new RegExp(`${x.type === 'GNR' ? 'G[ns]R' : x.type}\\s*${x.num}${x.suffix ? '\\s?B' : ''}(?![0-9])`, 'i'); },
  display: (v) => { const x = splitValue(v); return `${gleifType(x.type)} ${x.num}${x.suffix ? ' B' : ''}`; },
  firstPartyStatements: [
    { label: 'German imprint: register court then number',
      pattern: /((?:Amtsgericht|Registergericht|Court\s+of\s+Registry|Register\s+court|Registry\s+court|Local\s+court)\s*:?\s*(?:Amtsgericht\s+)?[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.()\- ]{1,40}?[,;]?\s*(?:HRA|HRB|GnR|GsR|PR|VR)\s*\d{1,6}(?:\s?B)?)\b/g },
    { label: 'German imprint: number then register court',
      pattern: /((?:HRA|HRB|GnR|GsR|PR|VR)\s*\d{1,6}(?:\s?B)?\s*[,;(]?\s*(?:Amtsgericht|Registergericht|Local\s+court)\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{1,40}?)(?=[,.;)]|\s{2}|$)/g },
  ],
  externalReferences: [{
    namespace: 'gleif_ra',
    authorityCodes: Object.keys(DE_REGISTER_COURTS),
    fromExternal: (code, raw) => {
      const court = COURT_BY_RA.get(code);
      const m = REGISTER.exec(raw);
      if (!court || !m) return null;
      const type = m[1].toUpperCase() === 'GSR' ? 'GNR' : m[1].toUpperCase();
      return `${court}:${type}${m[2]}${m[3] ? 'B' : ''}`;
    },
    toExternal: (v) => {
      const x = splitValue(v);
      const ra = RA_BY_COURT.get(x.court);
      const base = `${gleifType(x.type)} ${x.num}`;
      const raws = x.suffix ? [`${base} B`, `${base}B`] : [base];
      if (x.type === 'GNR') raws.push(`GsR ${x.num}`);
      return { authorityCodes: ra ? [ra] : [], raw: raws };
    },
  }],
};

export const deHandelsregisterProvider: RegistryProvider = {
  providerId: 'de_handelsregister',
  registryName: 'Handelsregister (Germany, register courts)',
  jurisdiction: 'DE',
  country: 'DE',
  schemes: [DEHR_SCHEME],
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION', 'CAN_PROVIDE_FILINGS'],
  lookupModes: ['by_identifier'],
  availability: 'INACCESSIBLE',
  availabilityDetail: 'www.handelsregister.de refused the TCP connection on every probe (CPG-012); portal is session/form-based. Not worked around.',
  providerFamily: 'de_handelsregister',
  pageHints: { legalNoticeLinks: /\b(impressum)\b/i, legalNoticePaths: /\/impressum(?:\.html?)?\/?$/i },
  async resolveFromExplicitIdentifier(registryId) {
    return { failure: 'inaccessible', detail: `Handelsregister record for ${registryId} not retrievable from this environment — no request made` };
  },
};
