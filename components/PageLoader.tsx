/**
 * PageLoader — the canonical full-page "we're working on it" tracker.
 *
 * Shown wherever an authenticated page is still settling (auth probe in
 * flight, company context loading, first data fetch). Replaces the old
 * `return null` blank screens and bare spinning circles so the user always
 * gets a *real*, moving progress signal — a climbing bar + branded spinner +
 * rotating status copy — instead of a dead white page.
 *
 * The percentage is intentionally indeterminate-but-climbing (nprogress
 * style): we rarely know the true completion ratio of an auth/context probe,
 * so we ease toward a ceiling (~92%) and never claim 100% until the page
 * actually mounts and replaces this component. That reads as honest forward
 * motion without lying about being "done".
 */
import React, { useEffect, useState } from 'react';

const DEFAULT_STATUSES = [
  'Verifying your session…',
  'Loading your workspace…',
  'Fetching your latest data…',
  'Almost there…',
];

export default function PageLoader({
  message,
  statuses = DEFAULT_STATUSES,
  fullScreen = true,
}: {
  /** Primary headline. Defaults to a generic workspace message. */
  message?: string;
  /** Rotating sub-status lines. Pass `[]` to hide the rotating line. */
  statuses?: string[];
  /** When false, fills the parent container instead of the viewport. */
  fullScreen?: boolean;
}) {
  const [progress, setProgress] = useState(8);
  const [statusIdx, setStatusIdx] = useState(0);

  // Climb toward a ceiling so the bar always feels alive. Bigger steps early,
  // smaller as we approach the cap — the classic "fast then settle" curve.
  useEffect(() => {
    const id = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) return prev;
        const step = prev < 45 ? 7 : prev < 75 ? 3.5 : 1.2;
        return Math.min(92, prev + step);
      });
    }, 220);
    return () => clearInterval(id);
  }, []);

  // Rotate the status copy so the user sees genuine activity, not a frozen
  // string. No-op when only one (or zero) statuses were provided.
  useEffect(() => {
    if (statuses.length <= 1) return;
    const id = setInterval(() => {
      setStatusIdx((prev) => (prev + 1) % statuses.length);
    }, 1900);
    return () => clearInterval(id);
  }, [statuses.length]);

  const currentStatus = statuses.length > 0 ? statuses[statusIdx % statuses.length] : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`${
        fullScreen ? 'min-h-screen' : 'min-h-[60vh] h-full'
      } w-full flex flex-col items-center justify-center gap-6 bg-gradient-to-br from-gray-50 via-white to-indigo-50/40 px-6`}
    >
      <div className="flex flex-col items-center gap-4 w-full max-w-sm">
        {/* Branded spinner */}
        <div className="relative h-12 w-12">
          <span className="absolute inset-0 rounded-full border-2 border-indigo-100" />
          <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-600 border-r-indigo-500 animate-spin" />
          <span className="absolute inset-0 flex items-center justify-center text-base">⚡</span>
        </div>

        <div className="text-center">
          <p className="text-sm font-semibold text-gray-800">
            {message ?? 'Loading your workspace…'}
          </p>
          {currentStatus && (
            <p key={currentStatus} className="mt-1 text-xs text-gray-400 animate-pulse">
              {currentStatus}
            </p>
          )}
        </div>

        {/* Climbing progress bar */}
        <div className="w-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-right text-[10px] font-medium tabular-nums text-gray-400">
            {Math.round(progress)}%
          </p>
        </div>
      </div>
    </div>
  );
}
