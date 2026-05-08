import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useCommandCenter } from '../hooks/useCommandCenter';
import { useCompanyContext } from '../components/CompanyContext';
import CommandCenterView from '../components/CommandCenterView';

// Maximum time the user is allowed to see a bare spinner without any useful
// signal before we fall through to an error/redirect path. Spinning longer
// than this is always a UX failure — either we should be done, or we should
// tell the user something.
const MAX_SPINNER_MS = 12_000;

export default function CommandCenterPage() {
  const router = useRouter();
  const d = useCommandCenter();
  const { authChecked, isAuthenticated, companiesResolved, companies, user, isLoading } = useCompanyContext();
  const [spinnerExpired, setSpinnerExpired] = useState(false);

  // Sole reason for the spinner: useCommandCenter returns _ef1=true whenever
  // user.userId is null OR we're still in the initial isLoading=true window.
  // Resolve every reachable terminal state below — never leave the user
  // staring at an indeterminate spinner.

  // 1) Auth checked AND user not authenticated → push to /login (the company
  //    context already cleared, but staying on /command-center has no value).
  useEffect(() => {
    if (authChecked && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authChecked, isAuthenticated, router]);

  // 2) Auth checked AND authenticated AND companies fetched but empty →
  //    user has no active company role. Send them through onboarding.
  //    (post-login-route normally catches this, but a deep-link to
  //    /command-center bypasses it; this is the safety net.)
  useEffect(() => {
    if (authChecked && isAuthenticated && companiesResolved && companies.length === 0) {
      router.replace('/onboarding/company');
    }
  }, [authChecked, isAuthenticated, companiesResolved, companies.length, router]);

  // 3) Bounded spinner. After MAX_SPINNER_MS without user.userId getting
  //    populated, surface an actionable error instead of spinning forever.
  useEffect(() => {
    if (user?.userId) {
      setSpinnerExpired(false);
      return;
    }
    const t = setTimeout(() => setSpinnerExpired(true), MAX_SPINNER_MS);
    return () => clearTimeout(t);
  }, [user?.userId, isLoading, companiesResolved]);

  if (d._ef1) {
    if (spinnerExpired) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center bg-slate-50 gap-4 px-6 text-center">
          <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">!</div>
          <div className="max-w-md text-slate-700">
            <p className="text-base font-medium">We&apos;re having trouble loading your workspace.</p>
            <p className="mt-1 text-sm text-slate-500">
              The server may still be starting up, or your session may have expired.
              Try reloading the page. If the problem continues, sign out and back in.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => router.replace('/login')}
              className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-100"
            >
              Sign in again
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }
  return <CommandCenterView d={d} />;
}
