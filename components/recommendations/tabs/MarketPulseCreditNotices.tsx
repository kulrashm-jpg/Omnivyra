/**
 * Market Pulse credit notices (55's charging, afb199ca9 + 650a0ac8b; 2026-11-13).
 *
 * - POST /api/market-pulse/run can return 402 before any job is created:
 *   { error: 'insufficient_credits' | 'no_credit_account' | 'pricing_unavailable',
 *     message, required?, available?, perRegion? }.
 *   The user sees the plain `message` (never the raw code) and a link to top up.
 * - A run that stops part-way ends as completed_with_warnings. Per-region outcomes carry
 *   a `code` (key on it, never on message text): INSUFFICIENT_CREDITS, CHARGED_NO_OUTPUT,
 *   ALREADY_RELEASED, or none (any other, uncharged failure).
 *
 * The top-up target is /company/billing, the same page the credit-alert and
 * consumption-warning emails link to (creditAlertService.ts, creditConsumptionWarningService.ts).
 */
import React from 'react';
import Link from 'next/link';

export const TOP_UP_HREF = '/company/billing';

const CREDIT_ERROR_CODES = new Set(['insufficient_credits', 'no_credit_account', 'pricing_unavailable']);

export type CreditNotice = {
  kind: 'credits';
  code: string;
  message: string;
  required?: number;
  available?: number;
};

export type RunStartError = CreditNotice | { kind: 'error'; message: string };

const FALLBACK_CREDIT_MESSAGE: Record<string, string> = {
  insufficient_credits: 'You don’t have enough credits to run this scan.',
  no_credit_account: 'Your company doesn’t have a credit account yet.',
  pricing_unavailable: 'Scan pricing is temporarily unavailable, so the scan wasn’t started. Please try again shortly.',
};

/** Map a failed POST /api/market-pulse/run response to what the user should see. */
export function parseRunStartError(status: number, body: unknown): RunStartError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof b.error === 'string' ? b.error : '';
  const message = typeof b.message === 'string' && b.message.trim() ? b.message.trim() : '';
  if (status === 402 || CREDIT_ERROR_CODES.has(code)) {
    return {
      kind: 'credits',
      code: code || 'insufficient_credits',
      message: message || FALLBACK_CREDIT_MESSAGE[code] || FALLBACK_CREDIT_MESSAGE.insufficient_credits,
      ...(typeof b.required === 'number' ? { required: b.required } : {}),
      ...(typeof b.available === 'number' ? { available: b.available } : {}),
    };
  }
  return { kind: 'error', message: message || (code && !/^[a-z_]+$/.test(code) ? code : '') || 'Failed to start Market Pulse run' };
}

export type RegionIssue = { region: string; code?: string | null; charged?: boolean; message?: string | null };

/** User-facing text per region outcome code (copy from 55). */
export function describeRegionIssue(issue: RegionIssue): { text: string; showTopUp: boolean } {
  switch (issue.code) {
    case 'INSUFFICIENT_CREDITS':
      return { text: 'Not run: not enough credits.', showTopUp: true };
    case 'CHARGED_NO_OUTPUT':
      return {
        text: 'This region was charged but its results weren’t saved. We’ve flagged it for a refund or re-run; no action is needed.',
        showTopUp: false,
      };
    case 'ALREADY_RELEASED':
      return { text: 'Not re-run: this region failed earlier and wasn’t charged. Start a new scan to try again.', showTopUp: false };
    default:
      return { text: 'This region couldn’t be analysed this time. It wasn’t charged.', showTopUp: false };
  }
}

function TopUpLink() {
  return (
    <Link href={TOP_UP_HREF} className="font-semibold text-indigo-700 underline">
      Top up credits
    </Link>
  );
}

export function MarketPulseCreditNotice({ notice }: { notice: CreditNotice | null }) {
  if (!notice) return null;
  const hasNumbers = typeof notice.required === 'number' || typeof notice.available === 'number';
  return (
    <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">{notice.message}</p>
      {hasNumbers && (
        <p className="mt-1 text-amber-800">
          {typeof notice.required === 'number' ? `This scan needs ${notice.required} credits` : ''}
          {typeof notice.required === 'number' && typeof notice.available === 'number' ? '; ' : ''}
          {typeof notice.available === 'number' ? `you have ${notice.available}.` : '.'}
        </p>
      )}
      {notice.code !== 'pricing_unavailable' && (
        <p className="mt-2">
          <TopUpLink />
        </p>
      )}
    </div>
  );
}

/** Banner for a run that stopped part-way (status completed_with_warnings). */
export function MarketPulseRunWarnings({
  status,
  regionIssues,
}: {
  status: string | null | undefined;
  regionIssues?: RegionIssue[] | null;
}) {
  if (String(status ?? '').toLowerCase() !== 'completed_with_warnings') return null;
  const issues = regionIssues ?? [];
  const anyTopUp = issues.some((i) => describeRegionIssue(i).showTopUp);
  return (
    <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">
        This scan finished with warnings: some regions didn’t complete. Results below cover the regions that did.
      </p>
      {issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {issues.map((issue) => (
            <li key={issue.region}>
              <span className="font-semibold">{issue.region}:</span> {describeRegionIssue(issue).text}
            </li>
          ))}
        </ul>
      )}
      {anyTopUp && (
        <p className="mt-2">
          <TopUpLink />
        </p>
      )}
    </div>
  );
}
