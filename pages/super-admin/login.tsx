import React, { useState } from 'react';
import { useRouter } from 'next/router';

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/super-admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Login failed');
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
        <h1 className="text-2xl font-bold text-gray-900">Super Admin Login</h1>
        <input
          className="border rounded-md px-3 py-2 w-full"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          className="border rounded-md px-3 py-2 w-full"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
