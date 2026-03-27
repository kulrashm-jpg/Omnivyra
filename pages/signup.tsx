import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/dashboard');
    });
  }, [router]);

  const handleSignup = async () => {
    setError(null);
    setStatus(null);
    if (!email) { setError('Email is required.'); return; }
    router.replace(`/create-account?email=${encodeURIComponent(email.trim().toLowerCase())}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-lg shadow p-6 max-w-md w-full space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Sign Up</h1>
        <p className="text-sm text-gray-600">Create your account with a sign-in link.</p>
        <input
          className="border rounded-md px-3 py-2 w-full"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          onClick={handleSignup}
          className="bg-indigo-600 text-white rounded-md px-4 py-2 w-full"
        >
          Send Sign-In Link
        </button>
        {status && <div className="text-sm text-green-600">{status}</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="text-sm text-gray-600">
          Already have an account? <Link className="text-indigo-600" href="/login">Login</Link>
        </div>
      </div>
    </div>
  );
}
