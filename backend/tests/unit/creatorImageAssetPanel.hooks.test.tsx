/**
 * @jest-environment jsdom
 */
import React from 'react';
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import CreatorImageAssetPanel from '../../../components/creator/CreatorImageAssetPanel';
import type { TemplateAssetSlot } from '../../../lib/content/compositionAssetRouting';

const fetchMock = jest.fn();
const templateSlots: readonly TemplateAssetSlot[] = [
  { purpose: 'subject', mode: 'condition' },
];

function renderPanel(companyId: string | null = 'company-a', compositionId: string | null = 'composition-a') {
  return render(
    <CreatorImageAssetPanel
      companyId={companyId}
      compositionId={compositionId}
      creatorTypeLabel="image"
      templateSlots={templateSlots}
    />,
  );
}

function response(items: unknown[] = [], ok = true) {
  return {
    ok,
    json: jest.fn().mockResolvedValue({ items }),
  } as unknown as Response;
}

function attachedItem(filename: string) {
  return {
    reference: {
      id: `reference-${filename}`,
      assetId: `asset-${filename}`,
      purpose: 'subject',
      mode: 'condition',
      ordinal: 0,
    },
    asset: { id: `asset-${filename}`, sourceUrl: null, originalFilename: filename },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('CreatorImageAssetPanel hook and request lifecycle', () => {
  test.each([
    ['company identifier is missing', null, 'composition-a'],
    ['composition identifier is missing', 'company-a', null],
    ['both identifiers are missing', null, null],
  ])('renders nothing and makes no composition request when %s', (_label, companyId, compositionId) => {
    renderPanel(companyId, compositionId);
    expect(screen.queryByText('Your Own Image')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('transitions from missing identifiers to valid identifiers with stable hook order', async () => {
    fetchMock.mockResolvedValueOnce(response());
    const { rerender } = renderPanel(null, 'composition-a');

    expect(() => rerender(
      <CreatorImageAssetPanel
        companyId="company-a"
        compositionId="composition-a"
        creatorTypeLabel="image"
        templateSlots={templateSlots}
      />,
    )).not.toThrow();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain('company_id=company-a');
    expect(String(fetchMock.mock.calls[0][0])).toContain('composition_id=composition-a');
    expect(await screen.findByText('Add an image')).toBeInTheDocument();
  });

  it('aborts the previous request and hides its data when valid identifiers become missing', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const { rerender } = renderPanel();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const requestOptions = fetchMock.mock.calls[0][1] as RequestInit;
    const signal = requestOptions.signal as AbortSignal;

    expect(() => rerender(
      <CreatorImageAssetPanel
        companyId="company-a"
        compositionId={null}
        creatorTypeLabel="image"
        templateSlots={templateSlots}
      />,
    )).not.toThrow();
    expect(signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Your Own Image')).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(response([attachedItem('stale.png')]));
    });
    expect(screen.queryByText('stale.png')).not.toBeInTheDocument();
  });

  it('shows loading, preserves the empty state after a request error, then recovers', async () => {
    const failedRequest = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(failedRequest.promise)
      .mockResolvedValueOnce(response([attachedItem('recovered.png')]));
    const { rerender } = renderPanel();

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    await act(async () => {
      failedRequest.reject(new Error('temporary network failure'));
      await failedRequest.promise.catch(() => undefined);
    });
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(screen.getByText('Add an image')).toBeInTheDocument();

    rerender(
      <CreatorImageAssetPanel
        companyId="company-a"
        compositionId="composition-b"
        creatorTypeLabel="image"
        templateSlots={templateSlots}
      />,
    );
    expect(await screen.findByText('recovered.png')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('switches valid compositions without showing a response from the previous scope', async () => {
    const oldRequest = deferred<Response>();
    const newRequest = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const { rerender } = renderPanel('company-a', 'composition-a');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const oldSignal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;

    rerender(
      <CreatorImageAssetPanel
        companyId="company-b"
        compositionId="composition-b"
        creatorTypeLabel="image"
        templateSlots={templateSlots}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(oldSignal.aborted).toBe(true);

    await act(async () => {
      newRequest.resolve(response([attachedItem('company-b.png')]));
    });
    expect(await screen.findByText('company-b.png')).toBeInTheDocument();

    await act(async () => {
      oldRequest.resolve(response([attachedItem('company-a-stale.png')]));
    });
    expect(screen.getByText('company-b.png')).toBeInTheDocument();
    expect(screen.queryByText('company-a-stale.png')).not.toBeInTheDocument();
    expect(String(fetchMock.mock.calls[1][0])).toContain('company_id=company-b');
    expect(String(fetchMock.mock.calls[1][0])).toContain('composition_id=composition-b');
  });
});
