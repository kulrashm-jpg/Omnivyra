/**
 * AuthErrorBanner — visible, non-fatal auth error surface.
 *
 * Renders when CompanyContext has captured a non-session-fatal auth error
 * (USER_INVITED, USER_NOT_FOUND, SCHEMA_MISMATCH, PROFILE_LOAD_FAILED, or
 * a raw uncoded 4xx/5xx). Replaces the previous behavior of silently
 * forcing a sign-out + redirect, which made every non-token failure look
 * like a login loop.
 *
 * Session-fatal codes (INVALID_SESSION, ACCOUNT_DELETED, ACCOUNT_DISABLED)
 * are handled by CompanyContext directly — they sign the user out and
 * never reach this component.
 */

import React from 'react';
import { useCompanyContext } from '../CompanyContext';
import { AUTH_ERROR_CODE, type AuthErrorCode } from '../../utils/authErrors';

interface CopyForCode {
  title: string;
  body:  string;
  cta:   string;
}

const COPY: Record<AuthErrorCode, CopyForCode> = {
  [AUTH_ERROR_CODE.USER_INVITED]: {
    title: 'Account awaiting activation',
    body:
      "Your account hasn't completed first-time activation yet. " +
      'Sign out and sign in again to finish setup.',
    cta:   'Retry',
  },
  [AUTH_ERROR_CODE.USER_NOT_FOUND]: {
    title: "We couldn't find your account",
    body:
      "Your session is valid, but we couldn't find your account profile. " +
      'This usually means the workspace is still finishing setup. Try again in a moment.',
    cta:   'Retry',
  },
  [AUTH_ERROR_CODE.SCHEMA_MISMATCH]: {
    title: 'Service temporarily unavailable',
    body:
      "The workspace is in the middle of an update and isn't ready to load yet. " +
      'Please try again in a moment.',
    cta:   'Retry',
  },
  [AUTH_ERROR_CODE.PROFILE_LOAD_FAILED]: {
    title: "We couldn't load your workspace",
    body:
      "We hit an error loading your workspace. Your session is still valid — " +
      'please try again.',
    cta:   'Retry',
  },
  // Session-fatal codes — should never be rendered here, but render
  // defensively in case the matrix changes.
  [AUTH_ERROR_CODE.INVALID_SESSION]: {
    title: 'Session expired',
    body:  'Please sign in again.',
    cta:   'Sign in',
  },
  [AUTH_ERROR_CODE.ACCOUNT_DELETED]: {
    title: 'Account removed',
    body:  'This account has been removed.',
    cta:   'Sign in',
  },
  [AUTH_ERROR_CODE.ACCOUNT_DISABLED]: {
    title: 'Account suspended',
    body:  'This account is currently suspended. Contact support if you think this is a mistake.',
    cta:   'Sign in',
  },
};

export const AuthErrorBanner: React.FC = () => {
  const { authError, retryAuthError } = useCompanyContext();
  if (!authError) return null;

  const copy = COPY[authError.code];
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div
      role="alert"
      data-auth-error-code={authError.code}
      className="mx-auto my-4 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 shadow-sm"
    >
      <div className="flex items-start gap-4">
        <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-semibold">
          !
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-amber-900">{copy.title}</h2>
          <p className="mt-1 text-sm text-amber-800">
            {authError.details ?? copy.body}
          </p>
          {isDev && (
            <p className="mt-2 text-xs text-amber-700/80 font-mono">
              code: {authError.code} · at: {new Date(authError.occurredAt).toLocaleTimeString()}
            </p>
          )}
          <button
            type="button"
            onClick={retryAuthError}
            className="mt-3 inline-flex items-center rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
          >
            {copy.cta}
          </button>
        </div>
      </div>
    </div>
  );
};
