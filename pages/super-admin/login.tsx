import React, { useState } from 'react';
import { useRouter } from 'next/router';

type LoginMode = 'super_admin' | 'content_architect';

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>('super_admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const isContentArchitect = mode === 'content_architect';
      const url = isContentArchitect
        ? '/api/super-admin/content-architect-login'
        : '/api/super-admin/login';
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Login failed');
      }
      if (isContentArchitect) {
        router.replace('/content-architect');
      } else {
        router.replace('/super-admin/dashboard');
      }
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
        <input
          className="border rounded-md px-3 py-2 w-full"
          placeholder="Username"
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
