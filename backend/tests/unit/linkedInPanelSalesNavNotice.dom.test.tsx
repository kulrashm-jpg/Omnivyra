/**
 * @jest-environment jsdom
 *
 * Owner requirement 2026-11-11: the tenant data-controller notice is shown wherever
 * Sales Navigator capture is started. LinkedInOperationsPanel renders PI's notice
 * (salesnav_capture only) beside the "Capture Sales Navigator" action.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockApiFetch = jest.fn();
jest.mock('@/lib/apiFetch', () => ({ apiFetch: (u: string, init?: unknown) => mockApiFetch(u, init) }));
jest.mock('@/components/CompanyContext', () => ({ useCompanyContext: () => ({ selectedCompanyId: 'c1' }) }));
jest.mock('@/components/ui/PlatformIcon', () => ({ __esModule: true, default: () => null }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LinkedInOperationsPanel } = require('../../../components/engagement/LinkedInOperationsPanel');

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const NOTICE = { version: 'v1', status: '', title: 'Your data', intro: 'You are the controller.', textSha256: 'h'.repeat(64),
  categories: { vendor_data: 'Vendors text', salesnav_capture: 'Sales Navigator capture text', contact_data: 'Contact text' } };
const cat = (state: string) => ({ state, allowed: state === 'current' || state === 'grace', acceptedAt: null, graceEndsAt: null });
const payload = (salesnav: string) => ({ notice: NOTICE, readable: true,
  categories: { vendor_data: cat('required'), salesnav_capture: cat(salesnav), contact_data: cat('required') } });

const base = {
  loading: false, syncing: false, error: null, overview: null, lastSyncResult: null,
  extensionAuthenticated: true, browserAssistAvailable: true, browserTabOpen: true, browserMessagingTabOpen: false,
  browserFeedTabOpen: false, browserSalesNavigatorTabOpen: true, browserRecruiterTabOpen: false,
  onRefresh: () => undefined, onSyncNow: async () => undefined, onRunBrowserAssist: null,
};

beforeEach(() => mockApiFetch.mockReset());

it('with the capture action offered: the Sales Navigator notice is shown beside it, only that category, blocked until accepted', async () => {
  mockApiFetch.mockResolvedValue(json(200, payload('required')));
  render(<LinkedInOperationsPanel {...base} onCaptureSalesNavigator={async () => undefined} />);
  expect(screen.getByText('Capture Sales Navigator')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('tdn-blocked')).toBeInTheDocument());
  expect(screen.getByTestId('salesnav-data-notice')).toContainElement(screen.getByTestId('tenant-data-notice'));
  expect(screen.getByText('Sales Navigator capture text')).toBeInTheDocument();
  expect(screen.queryByText('Vendors text')).toBeNull();
  expect(mockApiFetch.mock.calls[0][0]).toBe('/api/compliance/tenant-data-ack?companyId=c1');
});

it('accepted: shown as information, no accept control', async () => {
  mockApiFetch.mockResolvedValue(json(200, payload('current')));
  render(<LinkedInOperationsPanel {...base} onCaptureSalesNavigator={async () => undefined} />);
  await waitFor(() => expect(screen.getByTestId('tdn-accepted')).toBeInTheDocument());
  expect(screen.queryByTestId('tdn-accept')).toBeNull();
});

it('without the capture action: no notice and no request', () => {
  render(<LinkedInOperationsPanel {...base} onCaptureSalesNavigator={null} />);
  expect(screen.queryByTestId('salesnav-data-notice')).toBeNull();
  expect(mockApiFetch).not.toHaveBeenCalled();
});
