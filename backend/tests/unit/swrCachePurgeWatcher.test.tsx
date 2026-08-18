/**
 * @jest-environment jsdom
 */
/**
 * P1.9 — what fires the full SWR cache purge on a cold load.
 *
 * The watcher purges on any CompanyContext userId change. On a cold load the
 * first observation is `null` (auth has not resolved), so the arrival of the
 * signed-in principal reads as a principal CHANGE — firing a full
 * `revalidate:false` purge at exactly the moment first requests are in flight.
 */
import React from 'react';
import { render, act } from '@testing-library/react';

const clearSwrCacheMock = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/swr/swrClient', () => ({ clearSwrCache: (...a: unknown[]) => clearSwrCacheMock(...a) }));

let ctxUser: { userId: string } | null = null;
jest.mock('../../../components/CompanyContext', () => ({ useCompanyContext: () => ({ user: ctxUser }) }));

const onAuthStateChange = jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } }));
jest.mock('../../../lib/supabaseBrowser', () => ({ getSupabaseBrowser: () => ({ auth: { onAuthStateChange } }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SwrCachePurgeWatcher } = require('../../../components/swr/SwrCachePurgeWatcher');

beforeEach(() => { clearSwrCacheMock.mockClear(); ctxUser = null; });

const renderWatcher = () => render(<SwrCachePurgeWatcher />);

describe('SwrCachePurgeWatcher purge triggers', () => {
  it('does not purge on initial mount', () => {
    renderWatcher();
    expect(clearSwrCacheMock).not.toHaveBeenCalled();
  });

  it('CRITICAL — sign-in resolution (null → principal) must NOT purge', async () => {
    const { rerender } = renderWatcher();
    ctxUser = { userId: 'user-a' };
    await act(async () => { rerender(<SwrCachePurgeWatcher />); });
    // Anonymous → authenticated is auth RESOLUTION, not a principal change.
    // Purging here wipes in-flight first-load requests and never refetches.
    expect(clearSwrCacheMock).not.toHaveBeenCalled();
  });

  it('a real principal change (A → B) still purges', async () => {
    ctxUser = { userId: 'user-a' };
    const { rerender } = renderWatcher();
    ctxUser = { userId: 'user-b' };
    await act(async () => { rerender(<SwrCachePurgeWatcher />); });
    expect(clearSwrCacheMock).toHaveBeenCalledTimes(1);
  });

  it('principal leaving (A → null) still purges', async () => {
    ctxUser = { userId: 'user-a' };
    const { rerender } = renderWatcher();
    ctxUser = null;
    await act(async () => { rerender(<SwrCachePurgeWatcher />); });
    expect(clearSwrCacheMock).toHaveBeenCalledTimes(1);
  });

  it('SIGNED_OUT still purges', async () => {
    renderWatcher();
    const handler = onAuthStateChange.mock.calls.at(-1)?.[0] as unknown as (e: string) => void;
    await act(async () => { handler('SIGNED_OUT'); });
    expect(clearSwrCacheMock).toHaveBeenCalledTimes(1);
  });

  it('TOKEN_REFRESHED does not purge', async () => {
    renderWatcher();
    const handler = onAuthStateChange.mock.calls.at(-1)?.[0] as unknown as (e: string) => void;
    await act(async () => { handler('TOKEN_REFRESHED'); });
    expect(clearSwrCacheMock).not.toHaveBeenCalled();
  });
});
