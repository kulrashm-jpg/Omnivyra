/**
 * @jest-environment jsdom
 *
 * Market Pulse credit notices (55's charging afb199ca9 + 650a0ac8b). A 402 on run start
 * and part-way runs must show plain language plus a top-up link, never a raw code.
 * Region outcomes are keyed on `code`, never on message text.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import {
  TOP_UP_HREF,
  parseRunStartError,
  describeRegionIssue,
  MarketPulseCreditNotice,
  MarketPulseRunWarnings,
  type CreditNotice,
} from '../../../components/recommendations/tabs/MarketPulseCreditNotices';

describe('parseRunStartError', () => {
  it('402 insufficient_credits → credit notice with the server message and numbers', () => {
    const r = parseRunStartError(402, {
      error: 'insufficient_credits', message: 'This scan needs more credits than you have.', required: 120, available: 40,
    });
    expect(r).toEqual({ kind: 'credits', code: 'insufficient_credits', message: 'This scan needs more credits than you have.', required: 120, available: 40 });
  });

  it.each(['insufficient_credits', 'no_credit_account', 'pricing_unavailable'])(
    '402 %s without a message → readable fallback, never the raw code',
    (code) => {
      const r = parseRunStartError(402, { error: code });
      expect(r.kind).toBe('credits');
      expect(r.message).not.toBe(code);
      expect(r.message).not.toMatch(/_/);
    },
  );

  it('non-credit errors keep a human message but hide snake_case codes', () => {
    expect(parseRunStartError(500, { error: 'Database is down' })).toEqual({ kind: 'error', message: 'Database is down' });
    expect(parseRunStartError(403, { error: 'MARKET_PULSE_ADMIN_REQUIRED', message: 'Market Pulse scan console is for company admins' }))
      .toEqual({ kind: 'error', message: 'Market Pulse scan console is for company admins' });
    expect(parseRunStartError(500, { error: 'some_internal_code' })).toEqual({ kind: 'error', message: 'Failed to start Market Pulse run' });
  });
});

describe('describeRegionIssue keys on code (55 copy)', () => {
  it('INSUFFICIENT_CREDITS offers top-up', () => {
    expect(describeRegionIssue({ region: 'EU', code: 'INSUFFICIENT_CREDITS', message: 'completed and charged: US' }))
      .toEqual({ text: 'Not run: not enough credits.', showTopUp: true });
  });
  it('CHARGED_NO_OUTPUT reassures, no top-up, no support ask', () => {
    const d = describeRegionIssue({ region: 'US', code: 'CHARGED_NO_OUTPUT', charged: true });
    expect(d.showTopUp).toBe(false);
    expect(d.text).toMatch(/flagged it for a refund or re-run; no action is needed/);
    expect(d.text).not.toMatch(/contact support/i);
  });
  it('ALREADY_RELEASED explains a new scan is needed', () => {
    expect(describeRegionIssue({ region: 'IN', code: 'ALREADY_RELEASED' }).text).toMatch(/Start a new scan/);
  });
  it('no code → generic, uncharged, and the message text is NOT used to decide', () => {
    const d = describeRegionIssue({ region: 'BR', message: 'insufficient_credits: looks like credits but has no code' });
    expect(d).toEqual({ text: 'This region couldn’t be analysed this time. It wasn’t charged.', showTopUp: false });
  });
});

describe('rendering', () => {
  it('credit notice shows the message, numbers and the top-up link to /company/billing', () => {
    const notice: CreditNotice = { kind: 'credits', code: 'insufficient_credits', message: 'Not enough credits.', required: 120, available: 40 };
    render(<MarketPulseCreditNotice notice={notice} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Not enough credits.');
    expect(screen.getByRole('alert')).toHaveTextContent('This scan needs 120 credits; you have 40.');
    expect(screen.getByRole('link', { name: 'Top up credits' })).toHaveAttribute('href', TOP_UP_HREF);
    expect(TOP_UP_HREF).toBe('/company/billing');
    expect(screen.queryByText(/insufficient_credits/)).not.toBeInTheDocument();
  });

  it('pricing_unavailable: no top-up link (topping up would not help)', () => {
    render(<MarketPulseCreditNotice notice={{ kind: 'credits', code: 'pricing_unavailable', message: 'Pricing is unavailable.' }} />);
    expect(screen.queryByRole('link', { name: 'Top up credits' })).not.toBeInTheDocument();
  });

  it('run warnings: only for completed_with_warnings, lists regions by code, top-up only when credits ran out', () => {
    const { rerender } = render(<MarketPulseRunWarnings status="completed" regionIssues={[]} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(
      <MarketPulseRunWarnings
        status="completed_with_warnings"
        regionIssues={[{ region: 'EU', code: 'INSUFFICIENT_CREDITS' }, { region: 'US', code: 'CHARGED_NO_OUTPUT', charged: true }]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('EU: Not run: not enough credits.');
    expect(screen.getByRole('status')).toHaveTextContent(/US: This region was charged/);
    expect(screen.getByRole('link', { name: 'Top up credits' })).toHaveAttribute('href', '/company/billing');
    rerender(<MarketPulseRunWarnings status="completed_with_warnings" regionIssues={[{ region: 'US', code: 'CHARGED_NO_OUTPUT' }]} />);
    expect(screen.queryByRole('link', { name: 'Top up credits' })).not.toBeInTheDocument();
  });

  it('run warnings without per-region detail still explains the partial result', () => {
    render(<MarketPulseRunWarnings status="completed_with_warnings" />);
    expect(screen.getByRole('status')).toHaveTextContent(/some regions didn’t complete/);
  });
});

describe('the V2 console uses the parser for run-start errors', () => {
  it('no raw err.error is thrown for a failed run start', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'components/recommendations/tabs/MarketPulseTabV2Controller.tsx'), 'utf8') as string;
    expect(src).toMatch(/parseRunStartError\(res\.status, err\)/);
    expect(src).not.toMatch(/throw new Error\(err\?\.error \|\| 'Failed to start Market Pulse run'\)/);
  });
});
