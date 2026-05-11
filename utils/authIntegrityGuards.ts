type CallbackIdentityInput = {
  hasVerificationToken: boolean;
  accessToken: string | null | undefined;
  userId: string | null | undefined;
};

function devWarn(message: string, details?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') return;
  if (details) {
    console.warn(`[auth-integrity] ${message}`, details);
  } else {
    console.warn(`[auth-integrity] ${message}`);
  }
}

export function isAuthBootstrapPath(pathname: string): boolean {
  return pathname.startsWith('/auth/') || pathname === '/create-account';
}

export function assertCallbackIdentitySource(input: CallbackIdentityInput): void {
  if (!input.hasVerificationToken || !input.accessToken || !input.userId) {
    devWarn('callback_without_verified_identity_source', {
      hasVerificationToken: input.hasVerificationToken,
      hasAccessToken: Boolean(input.accessToken),
      hasUserId: Boolean(input.userId),
    });
  }
}

export function assertAuthBootstrapProbeSkipped(pathname: string, skipped: boolean): void {
  if (isAuthBootstrapPath(pathname) && !skipped) {
    devWarn('auth_bootstrap_path_ran_session_probe', { pathname });
  }
}
