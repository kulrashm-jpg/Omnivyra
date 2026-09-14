/**
 * @jest-environment jsdom
 *
 * CPG-012 slice — the Company Profile form's real `fillFactsFromWikidata`
 * (useCompanyProfileFormController) consuming a REAL grounded response.
 *
 * The response is produced by the real composer (orchestrateGrounding → CPG
 * resolver) over fixture pages and a fixture Wikidata entity; the hook is the
 * production hook, given a stub ProfileState. Proves: the action calls the
 * lookup route, fills ONLY confirmed facts, in ONE update (the old per-field
 * calls kept only the last), even from view mode (where the old handler
 * silently dropped them while reporting success), and shows the truthful
 * message.
 */

import { renderHook, act } from '@testing-library/react';
import { useCompanyProfileFormController } from '../../../components/companyProfileFormController';
import { lookupGroundedCompanyFacts } from '../../services/companyProfile/grounding/companyFactsLookup';
import type { EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type { WikidataLookup } from '../../services/companyProfile/grounding/acquisition/wikidataSource';

jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), query: {}, pathname: '/company-profile' }) }));

const DOMAIN = 'acme.example.com';
const fetcher: EvidenceFetcher = async (url) => (url === `https://${DOMAIN}/` ? { ok: true, status: 200, url, text: '<p>Acme</p>' } : { ok: false, status: 404, url, text: '' });
const wiki = (official: string[]): WikidataLookup => async () => ({
  founded_year: '1999', team_size: '5000', revenue_range: '$2B', matched_label: 'Acme Industries', qid: 'Q4242', official_websites: official,
});
const grounded = (official: string[]) => lookupGroundedCompanyFacts({
  companyId: 'co-1', companyName: 'Acme Industries', websiteUrl: `https://${DOMAIN}`, asOf: '2026-09-11T00:00:00.000Z', fetcher, wikidataLookup: wiki(official),
});

function stubState(payload: unknown, over: Record<string, unknown> = {}) {
  const spies = {
    fetchWithAuth: jest.fn(async () => ({ ok: true, json: async () => payload })),
    updateActiveProfile: jest.fn(),
    handleCompanyFactChange: jest.fn(),
    setIsEditing: jest.fn(),
    setSuccessMessage: jest.fn(),
    setErrorMessage: jest.fn(),
  };
  const values: Record<string, unknown> = {
    companyId: 'co-1', isEditing: false, companyFacts: {},
    activeProfile: { company_id: 'co-1', name: 'Acme Industries', report_settings: { company_facts: {}, other: 'kept' } },
    ...spies, ...over,
  };
  // Everything else the hook destructures: a no-op function (setters, handlers) — never data.
  const state = new Proxy(values, { get: (t, k) => (k in t ? t[k as string] : jest.fn()) });
  return { state, spies };
}

describe('Company Profile form → grounded facts lookup', () => {
  it('fills only the confirmed fact, in one update, from VIEW mode, with a truthful message', async () => {
    const payload = await grounded([`https://www.${DOMAIN}`]);
    const { state, spies } = stubState(payload);
    const { result } = renderHook(() => useCompanyProfileFormController(state as never));
    await act(async () => { await result.current.fillFactsFromWikidata(); });

    expect(spies.fetchWithAuth).toHaveBeenCalledWith('/api/company-profile/company-facts-lookup?companyId=co-1', expect.objectContaining({ method: 'POST' }));
    expect(spies.updateActiveProfile).toHaveBeenCalledTimes(1);
    expect(spies.updateActiveProfile).toHaveBeenCalledWith({
      company_id: 'co-1', name: 'Acme Industries',
      report_settings: { company_facts: { founded_year: '1999' }, other: 'kept' },
    });
    expect(spies.handleCompanyFactChange).not.toHaveBeenCalled();
    expect(spies.setIsEditing).toHaveBeenCalledWith(true);
    const msg = spies.setSuccessMessage.mock.calls.filter((c) => c[0]).pop()![0] as string;
    expect(msg).toContain(`Filled founded year from public records — Wikidata entry "Acme Industries" is tied to ${DOMAIN} by its official website.`);
    expect(msg).toContain('Team size: Wikidata lists 5000, but that is below the evidence needed to confirm it — not filled.');
    expect(spies.setErrorMessage).not.toHaveBeenCalledWith(expect.any(String));
  });

  it('several confirmed facts land together — none is lost to a stale profile', async () => {
    const payload = await grounded([`https://www.${DOMAIN}`]);
    // Treat all three as confirmed (as a second tied source would make them) to exercise the batch.
    const all = { ...payload, facts: { founded_year: '1999', team_size: '5000', revenue_range: '$2B' } };
    const { state, spies } = stubState(all);
    const { result } = renderHook(() => useCompanyProfileFormController(state as never));
    await act(async () => { await result.current.fillFactsFromWikidata(); });
    expect(spies.updateActiveProfile).toHaveBeenCalledTimes(1);
    expect(spies.updateActiveProfile.mock.calls[0][0].report_settings.company_facts).toEqual({ founded_year: '1999', team_size: '5000', revenue_range: '$2B' });
  });

  it('a name-only Wikidata match changes nothing in the form and says why', async () => {
    const payload = await grounded([]);
    const { state, spies } = stubState(payload);
    const { result } = renderHook(() => useCompanyProfileFormController(state as never));
    await act(async () => { await result.current.fillFactsFromWikidata(); });
    expect(spies.updateActiveProfile).not.toHaveBeenCalled();
    const msg = spies.setSuccessMessage.mock.calls.filter((c) => c[0]).pop()![0] as string;
    expect(msg).toBe(`Wikidata has an entry named "Acme Industries", but it could not be tied to ${DOMAIN}, so it was not used. Nothing was filled. Please fill these facts in manually, then Save.`);
  });

  it('never overwrites a value the user already has', async () => {
    const payload = await grounded([`https://www.${DOMAIN}`]);
    const { state, spies } = stubState(payload, { companyFacts: { founded_year: '1987' } });
    const { result } = renderHook(() => useCompanyProfileFormController(state as never));
    await act(async () => { await result.current.fillFactsFromWikidata(); });
    expect(spies.updateActiveProfile).not.toHaveBeenCalled();
  });
});
