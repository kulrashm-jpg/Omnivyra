import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../utils/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/dashboard');
      }
    });
  }, [router]);

  const handleLogin = async () => {
    setError(null);
    setStatus(null);
    if (!email) {
      setError('Email is required.');
      return;
    }
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });
    if (authError) {
      setError(authError.message);
      return;
    }
    setStatus('Check your email for the login link.');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-lg shadow p-6 max-w-md w-full space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Login</h1>
        <p className="text-sm text-gray-600">Sign in with email OTP.</p>
        <input
          className="border rounded-md px-3 py-2 w-full"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          onClick={handleLogin}
          className="bg-indigo-600 text-white rounded-md px-4 py-2 w-full"
        >
          Send OTP
        </button>
        {status && <div className="text-sm text-green-600">{status}</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="text-sm text-gray-600">
          New here? <Link className="text-indigo-600" href="/signup">Create an account</Link>
        </div>
      </div>
    </div>
  );
}
