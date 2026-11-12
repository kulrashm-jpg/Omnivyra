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
let listed: Array<Record<string, unknown>> = [];
let resumeAnswer: { status: number; body: Record<string, unknown> };
const posted: string[] = [];
/** The Idempotency-Key each create POST carried (CLASS-2). */
const createKeys: Array<string | undefined> = [];

const json = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  listed = [];
  posted.length = 0;
  createKeys.length = 0;
  (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    if (init?.method === 'POST') posted.push(url);
    if (url === '/api/whatsapp/broadcasts' && init?.method === 'POST') createKeys.push(init.headers?.['Idempotency-Key']);
    if (url.includes('?action=enqueue')) return json(resumeAnswer.status, resumeAnswer.body);
    if (url.startsWith('/api/social-accounts/status')) {
      return json(200, { accounts: [{ platform_key: 'whatsapp', connected: true, expired: false, social_account_id: 'sa-1', account_name: 'WA' }] });
    }
    if (url.startsWith('/api/whatsapp/templates')) return json(200, { templates: [{ template_name: 'tpl', status: 'APPROVED' }] });
    if (url === '/api/whatsapp/broadcasts' && init?.method === 'POST') return json(createAnswer.status, createAnswer.body);
    if (url.startsWith('/api/whatsapp/broadcasts')) return json(200, { broadcasts: listed, total: listed.length });
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
    // Assertive (role=alert): the rest is never sent without the operator's Resume (05).
    const notice = await screen.findByText(/Only partly queued: 2 batches will send/);
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveAttribute('data-tone', 'warning');
    expect(notice).toHaveTextContent('until you Resume this broadcast');
  });

  it('NEGATIVE CONTROL: fully queued (201, enqueued:true) shows no banner', async () => {
    createAnswer = { status: 201, body: { broadcast_id: 'b1', inserted: 1, skipped: 0, enqueued: true, batches: 1 } };
    await createBroadcast();
    await waitFor(() => expect(screen.queryByPlaceholderText('April promo blast')).not.toBeInTheDocument()); // form closed
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing was sent/)).not.toBeInTheDocument();
  });
});

const row = (over: Record<string, unknown>) => ({
  id: 'b9', name: 'Spring', message_type: 'template', template_name: 'tpl', total_recipients: 10,
  sent_count: 4, delivered_count: 0, read_count: 0, failed_count: 0, open_count: 6,
  created_at: '2026-11-11T10:00:00.000Z', counts_refreshed_at: '2026-11-11T10:05:00.000Z', status: 'running', ...over,
});

describe('WhatsApp broadcasts page: stranded recipients always have an action', () => {
  it('a running broadcast with recipients not yet queued (a partial enqueue) offers Resume, which POSTs ?action=enqueue', async () => {
    listed = [row({ status: 'running', open_count: 6 })];
    resumeAnswer = { status: 200, body: { enqueued: true, run_id: 'r', batches: 1, recipients: 6 } };
    render(<WhatsAppBroadcastsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /resume/i }));
    await waitFor(() => expect(posted).toContain('/api/whatsapp/broadcasts/b9?action=enqueue'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('Resume refused while a batch is live (409): the reason the server gives is shown, as an error', async () => {
    listed = [row({ status: 'paused' })];
    resumeAnswer = { status: 409, body: { enqueued: false, code: 'BROADCAST_ALREADY_RUNNING', error: 'A batch of this broadcast is still queued or running.' } };
    render(<WhatsAppBroadcastsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /resume/i }));
    expect(await screen.findByText('A batch of this broadcast is still queued or running.')).toHaveAttribute('role', 'alert');
  });

  it('failed recipients on a COMPLETED broadcast offer Retry (the server never writes "failed")', async () => {
    listed = [row({ status: 'completed', failed_count: 2, open_count: 0 })];
    render(<WhatsAppBroadcastsPage />);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
  });

  it('NEGATIVE CONTROL: a running broadcast with nothing left and nothing failed offers neither', async () => {
    listed = [row({ status: 'running', open_count: 0, failed_count: 0 })];
    render(<WhatsAppBroadcastsPage />);
    expect(await screen.findByText('Spring')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe('CLASS-2: one Idempotency-Key per create, so a re-sent submit creates ONE broadcast', () => {
  it('a failed create re-sent with the SAME form carries the SAME key (the server answers it once)', async () => {
    createAnswer = { status: 500, body: { error: 'temporarily unavailable' } };
    await createBroadcast();
    await screen.findByText(/temporarily unavailable/);
    fireEvent.click(screen.getByRole('button', { name: /send broadcast/i }));
    await waitFor(() => expect(createKeys).toHaveLength(2));
    expect(createKeys[0]).toMatch(/^wa-broadcast-create-/);
    expect(createKeys[1]).toBe(createKeys[0]);
  });

  it('after a SUCCESS, creating the identical broadcast again on purpose is a NEW key', async () => {
    createAnswer = { status: 201, body: { broadcast_id: 'b1', inserted: 1, skipped: 0, enqueued: true, batches: 1 } };
    await createBroadcast();
    await waitFor(() => expect(screen.queryByPlaceholderText('April promo blast')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /new broadcast/i }));
    fireEvent.change(await screen.findByPlaceholderText('April promo blast'), { target: { value: 'Promo' } });
    fireEvent.change(screen.getByPlaceholderText(/\+14155552671/), { target: { value: '+14155552671' } });
    fireEvent.click(screen.getByRole('button', { name: /send broadcast/i }));
    await waitFor(() => expect(createKeys).toHaveLength(2));
    expect(createKeys[1]).toMatch(/^wa-broadcast-create-/);
    expect(createKeys[1]).not.toBe(createKeys[0]);
  });
});
