/**
 * @jest-environment jsdom
 *
 * The WhatsApp broadcasts page tells the operator what was actually QUEUED after
 * "Send Broadcast" (e9 / 05). The create route answers 2xx whenever the broadcast row
 * exists, so before this the form closed silently on a zero or partial enqueue and the
 * operator could believe it was sending. The real page, with `fetch` stubbed.
 *
 * It also pins an ordering hazard: the list refresh clears the error banner when it
 * starts, so the outcome must be shown AFTER the refresh, or it is wiped.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@/components/CompanyContext', () => ({ useCompanyContext: () => ({ selectedCompanyId: 'co-1' }) }));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import WhatsAppBroadcastsPage from '../../../pages/whatsapp/broadcasts';

let createAnswer: { status: number; body: Record<string, unknown> };

const json = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string, init?: { method?: string }) => {
    if (url.startsWith('/api/social-accounts/status')) {
      return json(200, { accounts: [{ platform_key: 'whatsapp', connected: true, expired: false, social_account_id: 'sa-1', account_name: 'WA' }] });
    }
    if (url.startsWith('/api/whatsapp/templates')) return json(200, { templates: [{ template_name: 'tpl', status: 'APPROVED' }] });
    if (url === '/api/whatsapp/broadcasts' && init?.method === 'POST') return json(createAnswer.status, createAnswer.body);
    if (url.startsWith('/api/whatsapp/broadcasts')) return json(200, { broadcasts: [], total: 0 });
    if (url.startsWith('/api/analytics/whatsapp/broadcasts')) return json(200, { broadcasts: [] });
    return json(404, {});
  });
});

async function createBroadcast() {
  render(<WhatsAppBroadcastsPage />);
  // "New Broadcast" is disabled until the WhatsApp account list has loaded.
  const open = await screen.findByRole('button', { name: /new broadcast/i });
  await waitFor(() => expect(open).not.toBeDisabled());
  fireEvent.click(open);
  // The form renders once the WhatsApp account list has loaded.
  fireEvent.change(await screen.findByPlaceholderText('April promo blast'), { target: { value: 'Promo' } });
  fireEvent.change(screen.getByPlaceholderText(/\+14155552671/), { target: { value: '+14155552671' } });
  await waitFor(() => expect(screen.getByRole('button', { name: /send broadcast/i })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: /send broadcast/i }));
}

describe('WhatsApp broadcasts page: the create outcome is told honestly', () => {
  it('nothing queued (202, enqueued:false): an error banner saying nothing was sent, with the reason', async () => {
    createAnswer = { status: 202, body: { broadcast_id: 'b1', inserted: 1, skipped: 0, enqueued: false, enqueue_error: 'Rate limit exceeded' } };
    await createBroadcast();
    expect(await screen.findByText(/NOT queued - nothing was sent\. Rate limit exceeded/)).toBeInTheDocument();
  });

  it('partially queued (202, partial:true): an amber notice, not silence and not an error', async () => {
    createAnswer = { status: 202, body: { broadcast_id: 'b1', inserted: 30, skipped: 0, enqueued: true, partial: true, uncertain: false, batches: 2 } };
    await createBroadcast();
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('only partly queued: 2 batches will send');
  });

  it('NEGATIVE CONTROL: fully queued (201, enqueued:true) shows no banner', async () => {
    createAnswer = { status: 201, body: { broadcast_id: 'b1', inserted: 1, skipped: 0, enqueued: true, batches: 1 } };
    await createBroadcast();
    await waitFor(() => expect(screen.queryByPlaceholderText('April promo blast')).not.toBeInTheDocument()); // form closed
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing was sent/)).not.toBeInTheDocument();
  });
});
