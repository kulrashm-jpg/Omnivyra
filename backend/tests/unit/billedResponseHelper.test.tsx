/**
 * @jest-environment jsdom
 *
 * THE canonical client mapping for billed AI responses + one Idempotency-Key per user
 * action (e9 ruling, 2026-11-13; 55's final shape b9de17f62 / f8eb7dd78).
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { classifyBilledResponse, billedOutcomeText, TOP_UP_HREF } from '../../../lib/billing/billedResponse';
import { createBilledActionKeyGate } from '../../../lib/idempotency';

describe('classifyBilledResponse: keyed on status + code only', () => {
  it('final 402 shape: readable `error`, code INSUFFICIENT_CREDITS, `balance`', () => {
    const o = classifyBilledResponse(402, { error: 'Insufficient credits to generate content', code: 'INSUFFICIENT_CREDITS', required: 5, balance: 2 }, 'x');
    expect(o).toEqual({ kind: 'credits', code: 'insufficient_credits', message: 'Insufficient credits to generate content', required: 5, available: 2 });
    expect(billedOutcomeText(o)).toBe('Insufficient credits to generate content (needs 5 credits; you have 2). Top up credits on the Billing page.');
  });

  it('NO_CREDIT_ACCOUNT and PRICING_UNAVAILABLE (no top-up for pricing)', () => {
    expect(classifyBilledResponse(402, { error: 'No credit account', code: 'NO_CREDIT_ACCOUNT' }, 'x')).toMatchObject({ kind: 'credits', code: 'no_credit_account' });
    const p = classifyBilledResponse(402, { error: 'Pricing unavailable', code: 'PRICING_UNAVAILABLE' }, 'x');
    expect(p).toMatchObject({ kind: 'credits', code: 'pricing_unavailable' });
    expect(billedOutcomeText(p)).not.toMatch(/Top up/);
  });

  it('older body shape still maps (snake_case reason in `error`, sentence in `message`, `available`)', () => {
    expect(classifyBilledResponse(402, { error: 'insufficient_credits', message: 'Not enough.', available: 1 }, 'x'))
      .toEqual({ kind: 'credits', code: 'insufficient_credits', message: 'Not enough.', available: 1 });
  });

  it('409 ALREADY_PROCESSED is success; ALREADY_RELEASED is retry', () => {
    expect(classifyBilledResponse(409, { error: 'dup', code: 'ALREADY_PROCESSED' }, 'x').kind).toBe('already_processed');
    expect(classifyBilledResponse(409, { error: 'released', code: 'ALREADY_RELEASED' }, 'x').kind).toBe('retry');
  });

  it('never shows a raw code; 403 org codes use a human detail or the fallback', () => {
    expect(classifyBilledResponse(403, { error: 'ORG_SCOPE_VIOLATION' }, 'Not allowed here.')).toEqual({ kind: 'error', message: 'Not allowed here.' });
    expect(classifyBilledResponse(403, { error: 'ORG_CONTROL_BLOCKED', detail: 'Your admin paused AI generation.' }, 'x'))
      .toEqual({ kind: 'error', message: 'Your admin paused AI generation.' });
    expect(classifyBilledResponse(200, {}, 'x')).toEqual({ kind: 'ok' });
  });

  it('message text never decides the outcome (a 500 mentioning credits is a plain error)', () => {
    expect(classifyBilledResponse(500, { error: 'insufficient credits somewhere' }, 'x').kind).toBe('error');
  });

  it('top-up target is /company/billing (same page as the credit-alert emails)', () => {
    expect(TOP_UP_HREF).toBe('/company/billing');
  });
});

describe('createBilledActionKeyGate: one key per user action', () => {
  it('a double-click (second begin while in flight) sends the SAME key', () => {
    const gate = createBilledActionKeyGate('t');
    const first = gate.begin('a');
    const second = gate.begin('a');
    expect(second.key).toBe(first.key);
    expect(second.headers).toEqual({ 'Idempotency-Key': first.key });
  });

  it('a deliberate second request (after the first ended) sends a NEW key', () => {
    const gate = createBilledActionKeyGate('t');
    const first = gate.begin('a').key;
    gate.end('a');
    expect(gate.begin('a').key).not.toBe(first);
  });

  it('independent items (scopes) never share a key', () => {
    const gate = createBilledActionKeyGate('t');
    expect(gate.begin('asset-1').key).not.toBe(gate.begin('asset-2').key);
  });
});

describe('a real billed caller: SuggestWithAIPanel', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });
  afterEach(() => { delete (global as any).fetch; });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SuggestWithAIPanel = require('../../../components/content/SuggestWithAIPanel').default;
  const keyOf = (i: number) => (fetchMock.mock.calls[i][1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
  const ok = { ok: true, status: 200, json: async () => ({ suggestion: { title: 'Idea', body: 'B' } }) };

  it('sends an Idempotency-Key, and a deliberate "Suggest another" sends a NEW one', async () => {
    fetchMock.mockResolvedValue(ok);
    render(<SuggestWithAIPanel companyId="co-1" contentType="post" onAccept={() => {}} />);
    fireEvent.click(screen.getByTestId('suggest-with-ai-trigger'));
    await waitFor(() => expect(screen.getByTestId('suggest-with-ai-another')).toBeEnabled());
    fireEvent.click(screen.getByTestId('suggest-with-ai-another'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(keyOf(0)).toMatch(/^content-suggest-/);
    expect(keyOf(1)).toMatch(/^content-suggest-/);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it('a 402 shows plain language with the top-up hint, never the raw code', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: 'Insufficient credits to generate content', code: 'INSUFFICIENT_CREDITS', required: 3, balance: 0 }) });
    render(<SuggestWithAIPanel companyId="co-1" contentType="post" onAccept={() => {}} />);
    fireEvent.click(screen.getByTestId('suggest-with-ai-trigger'));
    expect(await screen.findByText(/Insufficient credits to generate content \(needs 3 credits; you have 0\)\. Top up credits on the Billing page\./)).toBeInTheDocument();
    expect(screen.queryByText(/INSUFFICIENT_CREDITS/)).not.toBeInTheDocument();
  });
});

describe('every wired billed caller sends a per-action key and classifies errors', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8') as string;
  it.each([
    ['components/recommendations/tabs/MarketPulseTabV2Controller.tsx', 'mpRunKeys', 'runOp'],
    ['components/blog/AIBlogCardModal.tsx', 'blogChatKeys', 'chatOp'],
    ['components/campaign-ai/useCampaignAiOps.ts', 'regenerateKeys', 'regenOp'],
    ['hooks/useActivityWorkspaceRefinementOps.ts', 'refineKeys', 'refineOp'],
    ['components/content/SuggestWithAIPanel.tsx', 'suggestKeys', 'suggestOp'],
  ])('%s', (file, gate, op) => {
    const src = read(file);
    expect(src).toMatch(new RegExp(String.raw`const ${gate} = createBilledActionKeyGate\(`));
    expect(src).toMatch(new RegExp(String.raw`const ${op} = ${gate}\.begin\(`));
    expect(src).toMatch(new RegExp(String.raw`\.\.\.${op}\.headers`));
    expect(src).toMatch(new RegExp(String.raw`finally \{\s*${gate}\.end\(`));
    expect(src).toMatch(/classifyBilledResponse|parseRunStartError/);
  });
});
