import React from 'react';
import { useRouter } from 'next/router';

/**
 * AccessRestricted
 *
 * Professional, reusable permission state shown when a signed-in user
 * reaches a work-area their role does not include (e.g. a Viewer opening
 * a content-creation or campaign page via deep link or the browser bar).
 *
 * It NEVER redirects to Login and NEVER surfaces raw authorization errors.
 * It explains the situation in plain language and offers a clear way back
 * to an area the user can use.
 */
export const AccessRestricted: React.FC<{
  /** Short name of the area, e.g. "content creation" or "campaigns". */
  area?: string;
  /** Where "back" navigates. Defaults to the command center. */
  backHref?: string;
  backLabel?: string;
}> = ({ area, backHref = '/command-center', backLabel = 'Back to Command Center' }) => {
  const router = useRouter();
  const areaSentence = area
    ? `${area.charAt(0).toUpperCase()}${area.slice(1)} is managed by your team's editors and administrators.`
    : 'This area is managed by your team’s editors and administrators.';
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-4 py-16">
      <div className="mx-auto max-w-lg rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm md:p-10">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <svg className="h-7 w-7 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a2.25 2.25 0 0 1 2.25 2.25v6a2.25 2.25 0 0 1-2.25 2.25H6.75a2.25 2.25 0 0 1-2.25-2.25v-6a2.25 2.25 0 0 1 2.25-2.25Z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">
          You don&apos;t have access to {area ?? 'this area'}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-600">
          Your account has view access on this workspace. {areaSentence} If you need access, contact your administrator.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => router.push(backHref)}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            {backLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccessRestricted;
