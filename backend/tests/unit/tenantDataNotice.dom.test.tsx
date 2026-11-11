/**
 * @jest-environment jsdom
 *
 * The tenant data-controller notice, rendered (owner requirement, 2026-11-11).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockApiFetch = jest.fn();
jest.mock('@/lib/apiFetch', () => ({ apiFetch: (u: string, init?: unknown) => mockApiFetch(u, init) }));
jest.mock('@/components/CompanyContext', () => ({ useCompanyContext: () => ({ selectedCompanyId: 'c1' }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TenantDataNotice = require('../../../components/compliance/TenantDataNotice').default;
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const NOTICE = { version: 'v2', status: 'PENDING COUNSEL REVIEW', title: 'Your data', intro: 'You are the controller.', textSha256: 'h'.repeat(64),
  categories: { vendor_data: 'Vendors text', salesnav_capture: 'SN text', contact_data: 'Contact text' } };
const cat = (state: string, extra: Record<string, unknown> = {}) => ({ state, allowed: state === 'current' || state === 'grace', acceptedAt: null, graceEndsAt: null, ...extra });
const payload = (vendor: string, extra: Record<string, unknown> = {}) => ({ notice: NOTICE, readable: true, categories: {
  vendor_data: cat(vendor, extra), salesnav_capture: cat('required'), contact_data: cat('required') } });

beforeEach(() => mockApiFetch.mockReset());

it('accepted: shown as information only, no tick (and the pending-review status is visible)', async () => {
  mockApiFetch.mockResolvedValue(json(200, payload('current')));
  render(<TenantDataNotice companyId="c1" categories={['vendor_data']} />);
  await waitFor(() => expect(screen.getByTestId('tdn-accepted')).toBeInTheDocument());
  expect(screen.getByText('Vendors text')).toBeInTheDocument();
  expect(screen.getByText('PENDING COUNSEL REVIEW')).toBeInTheDocument();
  expect(screen.queryByTestId('tdn-tick')).toBeNull();
  expect(screen.queryByTestId('tdn-blocked')).toBeNull();
});

it('never accepted: blocked message; Accept stays disabled until ticked; posts the SHOWN version + hash', async () => {
  mockApiFetch.mockResolvedValueOnce(json(200, payload('required'))).mockResolvedValueOnce(json(201, {})).mockResolvedValue(json(200, payload('current')));
  render(<TenantDataNotice companyId="c1" categories={['vendor_data']} />);
  await waitFor(() => expect(screen.getByTestId('tdn-blocked')).toBeInTheDocument());
  expect(screen.getByTestId('tdn-accept')).toBeDisabled();
  fireEvent.click(screen.getByTestId('tdn-tick'));
  fireEvent.click(screen.getByTestId('tdn-accept'));
  await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(3));
  const [url, init] = mockApiFetch.mock.calls[1];
  expect(url).toBe('/api/compliance/tenant-data-ack?companyId=c1');
  expect(JSON.parse((init as { body: string }).body)).toEqual({ categories: ['vendor_data'], shownVersion: 'v2', shownTextSha256: 'h'.repeat(64) });
  await waitFor(() => expect(screen.getByTestId('tdn-accepted')).toBeInTheDocument());
});

it('grace: says "please re-accept by", is NOT blocked, and offers the tick', async () => {
  mockApiFetch.mockResolvedValue(json(200, payload('grace', { graceEndsAt: '2026-11-24T00:00:00.000Z' })));
  render(<TenantDataNotice companyId="c1" categories={['vendor_data']} />);
  await waitFor(() => expect(screen.getByTestId('tdn-grace')).toHaveTextContent(/re-accept by/));
  expect(screen.queryByTestId('tdn-blocked')).toBeNull();
  expect(screen.getByTestId('tdn-tick')).toBeInTheDocument();
});

it('a non-admin who tries is told only an admin can accept', async () => {
  mockApiFetch.mockResolvedValueOnce(json(200, payload('required'))).mockResolvedValueOnce(json(403, { code: 'not_company_admin' }));
  render(<TenantDataNotice companyId="c1" categories={['vendor_data']} />);
  await waitFor(() => expect(screen.getByTestId('tdn-tick')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('tdn-tick'));
  fireEvent.click(screen.getByTestId('tdn-accept'));
  await waitFor(() => expect(screen.getByText('Only a company admin can accept this notice.')).toBeInTheDocument());
});

it('no company -> renders nothing and reads nothing', () => {
  const { container } = render(<TenantDataNotice companyId={null} categories={['vendor_data']} />);
  expect(container).toBeEmptyDOMElement();
  expect(mockApiFetch).not.toHaveBeenCalled();
});
