/**
 * CPG-012 — Brazil: the national register of legal entities (CNPJ), behind the
 * provider contract.
 *
 *   jurisdiction BR → registry Receita Federal (CNPJ) → scheme CNPJ → RegistryProvider
 *
 * IDENTIFIER SEMANTICS — materially different from the other schemes:
 *   · 14 digits "AA.AAA.AAA/BBBB-CC" with TWO mod-11 check digits (CC);
 *   · the number identifies an ESTABLISHMENT: the 8-digit root (AA…) is the
 *     legal entity, BBBB the establishment (0001 = head office). Two branches
 *     of one company have different CNPJs and the SAME root — `entityKey`
 *     makes them one legal entity, never a "conflict".
 * GLEIF files CNPJs (formatted) under RA000681 (Receita Federal) and under
 * the state boards of trade (e.g. RA000053 JUCERJA, seen live); the mapping
 * accepts a value only when it passes the CNPJ checksum.
 *
 * ACCESS — LIVE BUT LIMITED: records come from BrasilAPI (brasilapi.com.br), a
 * keyless open-source MIRROR of the Receita Federal's open CNPJ data, not the
 * registry itself (the Receita's own lookup is CAPTCHA-gated). It is used as a
 * mirror: its source descriptor is tier 2, never tier 1.
 */

import type { IdentifierScheme } from '../schemes';
import type { ProviderFailure, RegistryProvider, RegistryRecord } from '../providerContract';
import { failureFromStatus } from '../providerContract';
import { field, member } from '../../jsonAccess';

export const BR_API_HOST = 'brasilapi.com.br';
export const brRecordUrl = (cnpj: string) => `https://${BR_API_HOST}/api/cnpj/v1/${cnpj}`;

function cnpjDigit(base: string): number {
  const w = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = [...base].reduce((acc, d, i) => acc + Number(d) * w[i], 0);
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}
export function normalizeCnpj(raw: string): string | null {
  const s = raw.trim().replace(/[.\s/-]/g, '');
  if (!/^\d{14}$/.test(s) || /^(\d)\1{13}$/.test(s)) return null;
  const d1 = cnpjDigit(s.slice(0, 12));
  const d2 = cnpjDigit(s.slice(0, 12) + d1);
  return d1 === Number(s[12]) && d2 === Number(s[13]) ? s : null;
}
export const cnpjDisplay = (v: string) => `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;

export const CNPJ_SCHEME: IdentifierScheme = {
  code: 'CNPJ', name: 'CNPJ (Brazil)', jurisdiction: 'BR', issuer: 'Receita Federal do Brasil',
  normalize: normalizeCnpj,
  entityKey: (v) => v.slice(0, 8),
  documentPattern: (v) => new RegExp(`(?<![0-9])${v.slice(0, 2)}\\.?${v.slice(2, 5)}\\.?${v.slice(5, 8)}/?${v.slice(8, 12)}-?${v.slice(12)}(?![0-9])`),
  display: cnpjDisplay,
  firstPartyStatements: [{ label: 'CNPJ stated by the company', pattern: /\bCNPJ(?:\/MF)?\s*(?:n[º°o]\.?)?\s*[:.]?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/g }],
  externalReferences: [{
    namespace: 'gleif_ra',
    // Receita Federal + the state boards of trade GLEIF lists (RA000036–RA000062).
    authorityCodes: ['RA000681', ...Array.from({ length: 27 }, (_, i) => `RA0000${36 + i}`)],
    fromExternal: (_code, raw) => normalizeCnpj(raw),
    toExternal: (v) => ({ authorityCodes: ['RA000681', ...Array.from({ length: 27 }, (_, i) => `RA0000${36 + i}`)], raw: [cnpjDisplay(v)] }),
  }],
};

const title = (s: string) => s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, a: string, b: string) => a + b.toUpperCase());

export const brCnpjProvider: RegistryProvider = {
  providerId: 'br_receita',
  registryName: 'CNPJ register (Brazil) via BrasilAPI mirror',
  jurisdiction: 'BR',
  country: 'BR',
  schemes: [CNPJ_SCHEME],
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION'],
  lookupModes: ['by_identifier'],
  availability: 'LIVE',
  availabilityDetail: 'LIVE-BUT-LIMITED: BrasilAPI, a keyless open-source mirror of Receita Federal open CNPJ data — not the registry itself.',
  providerFamily: 'br_receita',
  async resolveFromExplicitIdentifier(registryId, ctx): Promise<RegistryRecord | ProviderFailure> {
    const cnpj = normalizeCnpj(registryId.replace(/^CNPJ:/i, ''));
    if (!cnpj) return { failure: 'invalid_identifier', detail: `${registryId} fails the CNPJ check digits` };
    const url = brRecordUrl(cnpj);
    const r = await ctx.fetcher(url, { allowedHosts: [BR_API_HOST] }).catch(() => null);
    if (!r || !r.ok) return failureFromStatus(r?.status ?? null, url);
    let j: unknown;
    try { j = JSON.parse(r.text); } catch { return { failure: 'malformed_response', detail: `${url} → not JSON` }; }
    if (String(field(j, 'cnpj') ?? '') !== cnpj) return { failure: field(j, 'cnpj') ? 'ambiguous' : 'malformed_response', detail: `${url} → record for ${field(j, 'cnpj') ?? '(none)'}, not ${cnpj}` };
    const legalName = String(member(j, 'razao_social') ?? '').trim();
    if (!legalName) return { failure: 'not_found', detail: `${url} → no legal name` };
    const sit = String(member(j, 'descricao_situacao_cadastral') ?? '').toUpperCase();
    const municipio = member(j, 'municipio');
    return {
      providerId: 'br_receita', scheme: 'CNPJ', registryId: `CNPJ:${cnpj}`, legalName,
      jurisdiction: 'BR',
      status: sit === 'ATIVA' ? 'active' : sit === 'BAIXADA' || sit === 'NULA' || sit === 'INAPTA' ? 'inactive' : null,
      headquarters: municipio ? `${title(String(municipio))}, ${String(member(j, 'uf') ?? '')}, Brazil`.replace(', , ', ', ') : null,
      crossReferences: [], relationships: [],
      sourceUrl: url, retrievedAt: ctx.retrievedAt, providerFamily: 'br_receita',
      metadata: { tradeName: member(j, 'nome_fantasia') ?? null, establishment: member(j, 'descricao_identificador_matriz_filial') ?? null, startedOn: member(j, 'data_inicio_atividade') ?? null, mirror: 'brasilapi' },
    };
  },
};
