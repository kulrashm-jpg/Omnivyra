/**
 * @jest-environment jsdom
 */
/**
 * Content flow — chip suggestions must be requested once per card set.
 *
 * fetchCardSuggestions omits the key of any card whose request fails, and the
 * effect's re-entry guard read `cardSuggestions[0]`. So a failing first card
 * left the guard permanently falsy while setCardSuggestions handed back a fresh
 * object each render — the effect re-ran and re-issued EVERY card request,
 * without bound. These pin the single-attempt behaviour and the legitimate
 * repeat.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { useManagedIntelligenceData } from '@/components/content/managed-intelligence/useManagedIntelligenceData';

const SUGGEST = '/api/company/blog/brief-suggestions';
let suggestCalls = 0;
let suggestOk = true;
const realFetch = global.fetch;

function installFetch() {
  suggestCalls = 0;
  (global as any).fetch = jest.fn(async (url: string) => {
    const u = String(url);
    if (u.includes(SUGGEST)) {
      suggestCalls++;
      return { ok: suggestOk, json: async () => ({ suggestions: ['a', 'b'] }) };
    }
    if (u.includes('/api/company/blogs')) return { ok: true, json: async () => ({ blogs: [] }) };
    if (u.includes('/api/company-profile')) return { ok: true, json: async () => ({ profile: { name: 'Acme' } }) };
    return { ok: true, json: async () => ({}) };
  });
}

function Probe({ contentType, companyId }: { contentType: any; companyId: string }) {
  const d = useManagedIntelligenceData({
    contentType, formatLabel: 'Blog', targetWords: 800, depthLabel: 'standard depth',
    selectedCompanyId: companyId, selectedCompanyName: 'Acme',
  });
  return <div data-testid="probe" data-loading={String(d.loading)} data-cards={d.cards.length} />;
}

const settle = async (ms = 60) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

beforeEach(() => { suggestOk = true; installFetch(); });
afterAll(() => { (global as any).fetch = realFetch; });

describe('A — normal operation', () => {
  it('requests chips once per card, then stops', async () => {
    render(<Probe contentType="article" companyId="c1" />);
    await settle();
    const afterFirst = suggestCalls;
    expect(afterFirst).toBeGreaterThan(0);
    await settle(120);
    expect(suggestCalls).toBe(afterFirst);   // no further rounds
  });
});

describe('B — duplicate prevention (the defect)', () => {
  it('does NOT re-issue every request when the suggestions call fails', async () => {
    suggestOk = false;                        // every card returns non-ok → results {}
    render(<Probe contentType="article" companyId="c1" />);
    await settle();
    const afterFirstRound = suggestCalls;
    expect(afterFirstRound).toBeGreaterThan(0);

    await settle(200);                        // plenty of renders for a loop to show
    expect(suggestCalls).toBe(afterFirstRound);
  });

  it('a partial failure does not re-request the cards that already succeeded', async () => {
    let n = 0;
    (global as any).fetch = jest.fn(async (url: string) => {
      const u = String(url);
      if (u.includes(SUGGEST)) { suggestCalls++; n++; return { ok: n > 1, json: async () => ({ suggestions: ['x'] }) }; }
      if (u.includes('/api/company/blogs')) return { ok: true, json: async () => ({ blogs: [] }) };
      if (u.includes('/api/company-profile')) return { ok: true, json: async () => ({ profile: { name: 'Acme' } }) };
      return { ok: true, json: async () => ({}) };
    });
    suggestCalls = 0;
    render(<Probe contentType="article" companyId="c1" />);
    await settle();
    const afterFirstRound = suggestCalls;
    await settle(200);
    expect(suggestCalls).toBe(afterFirstRound);
  });
});

describe('C — legitimate repeat', () => {
  it('a new company fetches chips again', async () => {
    const { rerender } = render(<Probe contentType="article" companyId="c1" />);
    await settle();
    const afterFirst = suggestCalls;
    rerender(<Probe contentType="article" companyId="c2" />);
    await settle();
    expect(suggestCalls).toBeGreaterThan(afterFirst);
  });

  it('a new content type fetches chips again', async () => {
    const { rerender } = render(<Probe contentType="article" companyId="c1" />);
    await settle();
    const afterFirst = suggestCalls;
    rerender(<Probe contentType="guide" companyId="c1" />);
    await settle();
    expect(suggestCalls).toBeGreaterThan(afterFirst);
  });
});

describe('D — failure semantics preserved', () => {
  it('a failed suggestions round leaves the page usable and not loading', async () => {
    suggestOk = false;
    const { getByTestId } = render(<Probe contentType="article" companyId="c1" />);
    await settle();
    await waitFor(() => expect(getByTestId('probe').getAttribute('data-loading')).toBe('false'));
    expect(Number(getByTestId('probe').getAttribute('data-cards'))).toBeGreaterThan(0);
  });

  it('a failed profile/library read still resolves loading', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    const { getByTestId } = render(<Probe contentType="article" companyId="c1" />);
    await settle();
    await waitFor(() => expect(getByTestId('probe').getAttribute('data-loading')).toBe('false'));
  });
});

describe('E — lifecycle safety', () => {
  it('unmounting mid-flight does not start another round', async () => {
    const { unmount } = render(<Probe contentType="article" companyId="c1" />);
    await settle(10);
    unmount();
    const atUnmount = suggestCalls;
    await settle(150);
    expect(suggestCalls).toBe(atUnmount);
  });
});
