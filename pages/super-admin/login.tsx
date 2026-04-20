import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';

type LoginMode = 'super_admin' | 'content_architect';

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>('super_admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const checkExistingSession = async () => {
      try {
        const { data } = await getSupabaseBrowser().auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) return;

        const response = await fetch('/api/super-admin/session', {
          method: 'GET',
          credentials: 'include',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = await response.json().catch(() => ({}));
        if (!cancelled && response.ok && payload?.isSuperAdmin) {
          router.replace('/super-admin/dashboard');
          return;
        }
      } finally {
        if (!cancelled) setIsCheckingSession(false);
      }
    };

    void checkExistingSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogin = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const isContentArchitect = mode === 'content_architect';
      if (isContentArchitect) {
        const response = await fetch('/api/super-admin/content-architect-login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Login failed');
        }
        router.replace('/content-architect');
        return;
      }

      const supabase = getSupabaseBrowser();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: username.trim().toLowerCase(),
        password,
      });

      if (signInError || !data.session?.access_token) {
        throw new Error(
          signInError?.message?.toLowerCase().includes('invalid login')
            ? 'Incorrect email or password.'
            : signInError?.message || 'Login failed'
        );
      }

      const sessionResponse = await fetch('/api/super-admin/session', {
        method: 'GET',
        credentials: 'include',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const sessionData = await sessionResponse.json().catch(() => ({}));

      if (!sessionResponse.ok || !sessionData?.isSuperAdmin) {
        await supabase.auth.signOut();
        throw new Error('This account is not assigned the SUPER_ADMIN role.');
      }

      router.replace('/super-admin/dashboard');
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return null;
  }

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
            ? 'Use your Omnivyra account email and password. Super Admin access now comes from your assigned SUPER_ADMIN role.'
            : 'Content Architect still uses the dedicated credential-based access path.'}
        </p>
        <input
          className="border rounded-md px-3 py-2 w-full"
          placeholder={mode === 'super_admin' ? 'Work email' : 'Username'}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={isSubmitting}
        />
        <input
          className="border rounded-md px-3 py-2 w-full"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isSubmitting}
        />
        <button
          onClick={handleLogin}
          disabled={isSubmitting || !username || !password}
          className="bg-gray-900 text-white rounded-md px-4 py-2 w-full disabled:opacity-50"
        >
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    </div>
  );
}
