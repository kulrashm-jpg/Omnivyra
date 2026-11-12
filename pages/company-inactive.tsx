/**
 * Shown after sign-in when every company the user belongs to is INACTIVE (deactivated / suspended) - e1 2026-11-12.
 *
 * Membership-based authorization now denies a company whose companies.status is not 'active' (companyRoleGate),
 * so without this page such a user would land in the workspace and meet a 403 on every call. Instead
 * /api/auth/post-login-route sends them here: they stay signed in, see a clear message, and can sign out. A user
 * who also belongs to an ACTIVE company is never routed here - they land in that company as usual.
 * Reactivation is done by Omnivyra (platform administration); there is no self-serve path.
 */
import { useState } from 'react';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';
import { clearBrowserAuthState } from '../utils/authStorage';

export default function CompanyInactivePage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try { await getSupabaseBrowser().auth.signOut(); } catch { /* ignore */ }
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch { /* ignore */ }
    clearBrowserAuthState({ preservePkce: false });
    router.replace('/login');
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div role="alert" data-testid="company-inactive" className="max-w-md w-full rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">This company is inactive</h1>
        <p className="mt-2 text-sm text-gray-700">
          Your account is signed in, but the company workspace you belong to is not active right now, so it can&apos;t be
          opened. If you think this is a mistake, contact your company administrator or Omnivyra support.
        </p>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="mt-4 inline-flex items-center rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </main>
  );
}
