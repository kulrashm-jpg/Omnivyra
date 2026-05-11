import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';

type LoginMode = 'super_admin' | 'content_architect';

/**
 * Phase A.1 — Super-admin login is now canonical Supabase Auth.
 *
 * Previously: form submitted to /api/super-admin/login which compared
 * the inputs against SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD env vars
 * and minted a bridge cookie (+ optionally a canonical session if
 * SUPER_ADMIN_PRIMARY_USER_ID was wired up).
 *
 * Now: super_admin mode runs the same `signInWithPassword` + `/api/auth/
 * sync-supabase-user` flow as /login. Authorization for the dashboard /
 * APIs tab continues to come from `user_company_roles.role='SUPER_ADMIN'`
 * via `requireCapability` — no env-var identity check, no bridge
 * elevation, no step-up bypass.
 *
 * Content Architect mode is left untouched (separate credential path).
 *
 * The legacy /api/super-admin/login backend endpoint is intentionally
 * NOT removed in this change — it remains usable for any tooling that
 * still calls it. Removal is a separate cleanup task once a usage audit
 * confirms no remaining consumers.
 */
export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>('super_admin');
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      // ── Content Architect mode — legacy credential endpoint, untouched ────
      if (mode === 'content_architect') {
        const response = await fetch('/api/super-admin/content-architect-login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: emailOrUsername, password }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Login failed');
        router.replace('/content-architect');
        return;
      }

      // ── Super Admin mode — canonical Supabase Auth path ───────────────────
      const supabase = getSupabaseBrowser();
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email:    emailOrUsername.trim().toLowerCase(),
        password,
      });
      if (signInErr) {
        throw new Error(
          signInErr.message.toLowerCase().includes('invalid login')
            ? 'Incorrect email or password.'
            : signInErr.message,
        );
      }
      if (!data.session) {
        throw new Error('Sign-in did not return a session.');
      }

      // Run the canonical sync flow so public.users + auth_sessions get
      // touched the same way as a regular /login. This is what mints the
      // omnivyra_session cookie via ensureSessionForUser.
      const syncRes = await fetch('/api/auth/sync-supabase-user', {
        method:  'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (syncRes.status === 403) {
        await supabase.auth.signOut();
        throw new Error('Account is no longer active.');
      }
      if (!syncRes.ok) {
        throw new Error(`Sync failed (HTTP ${syncRes.status}).`);
      }

      // MFA branch — same shape as /login. If the SUPER_ADMIN has
      // already enrolled a verified factor, sync returns
      // mfa_required=true and the canonical session is NOT yet minted;
      // the user must finish the challenge on /auth/mfa first.
      const syncJson = await syncRes.clone().json().catch(() => ({})) as {
        mfa_required?: true;
        factors?: ReadonlyArray<'totp' | 'webauthn'>;
      };
      if (syncJson.mfa_required === true) {
        const factorParam = (syncJson.factors ?? []).join(',');
        const next = encodeURIComponent('/super-admin/dashboard');
        router.replace(factorParam
          ? `/auth/mfa?factors=${encodeURIComponent(factorParam)}&next=${next}`
          : `/auth/mfa?next=${next}`);
        return;
      }

      router.replace('/super-admin/dashboard');
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-lg shadow p-6 max-w-md w-full space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Admin Login</h1>
        <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          <button
            type="button"
            onClick={() => setMode('super_admin')}
            className={`flex-1 py-2 text-sm font-medium rounded-md ${
              mode === 'super_admin'
                ? 'bg-white text-gray-900 shadow'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Super Admin
          </button>
          <button
            type="button"
            onClick={() => setMode('content_architect')}
            className={`flex-1 py-2 text-sm font-medium rounded-md ${
              mode === 'content_architect'
                ? 'bg-white text-gray-900 shadow'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Content Architect
          </button>
        </div>
        <p className="text-sm text-gray-600">
          {mode === 'super_admin'
            ? 'Sign in with your Omnivyra account email and password. Authorization comes from the SUPER_ADMIN role.'
            : 'Content Architect still uses the dedicated credential-based access path.'}
        </p>
        <input
          className="border rounded-md px-3 py-2 w-full"
          placeholder={mode === 'super_admin' ? 'Email' : 'Username'}
          type={mode === 'super_admin' ? 'email' : 'text'}
          autoComplete={mode === 'super_admin' ? 'email' : 'username'}
          value={emailOrUsername}
          onChange={(e) => setEmailOrUsername(e.target.value)}
          disabled={isSubmitting}
        />
        <input
          className="border rounded-md px-3 py-2 w-full"
          placeholder="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isSubmitting}
        />
        <button
          onClick={handleLogin}
          disabled={isSubmitting || !emailOrUsername || !password}
          className="bg-gray-900 text-white rounded-md px-4 py-2 w-full disabled:opacity-50"
        >
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    </div>
  );
}
