'use client';

import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';
import { getAuthToken } from '../utils/getAuthToken';
import { apiFetch } from '../lib/apiFetch';

type WelcomeState = 'loading' | 'ready' | 'error';

export default function WelcomePage() {
  const router = useRouter();
  const [state, setState] = useState<WelcomeState>('loading');
  const [targetRoute, setTargetRoute] = useState('/command-center');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const requestedNext = typeof router.query.next === 'string' ? router.query.next : '';
      if (requestedNext.startsWith('/')) {
        setTargetRoute(requestedNext);
        setState('ready');
        return;
      }

      const { data } = await getSupabaseBrowser().auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }

      const token = await getAuthToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const res = await apiFetch('/api/auth/post-login-route', {
          method: 'GET',
        });

        if (!res.ok) {
          throw new Error('We could not load your workspace route.');
        }

        const json = await res.json() as { route?: string };
        if (!active) return;
        setTargetRoute(json.route ?? '/command-center');
        setState('ready');
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'We could not load your workspace.');
        setState('error');
      }
    }

    bootstrap();
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <>
      <Head>
        <title>Welcome to Omnivyra</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
        <header className="border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-2xl items-center px-6">
            <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-2xl rounded-[32px] border border-[#D7E5F7] bg-white/95 p-10 shadow-[0_28px_80px_rgba(31,63,104,0.12)]">
            {state === 'loading' && (
              <div className="flex flex-col items-center gap-4 text-center">
                <svg className="h-9 w-9 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm text-[#6B7C93]">Preparing your workspace…</p>
              </div>
            )}

            {state === 'ready' && (
              <div className="space-y-8">
                <div className="space-y-4 text-center">
                  <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-3xl text-white shadow-lg">
                    O
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight text-[#0B1F33]">Welcome to Omnivyra</h1>
                  <p className="mx-auto max-w-xl text-sm leading-relaxed text-[#6B7C93]">
                    Your account is confirmed and your workspace is ready. Continue to the platform to manage your company access, onboard your team, and start working.
                  </p>
                </div>

                <div className="grid gap-4 rounded-3xl bg-[linear-gradient(135deg,#EBF3FD_0%,#F8FBFF_100%)] p-6 text-sm text-[#35506B] sm:grid-cols-3">
                  <div>
                    <p className="font-semibold text-[#0B1F33]">Platform access</p>
                    <p className="mt-1">Enter your workspace with the correct company context.</p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#0B1F33]">Company admin controls</p>
                    <p className="mt-1">The first company user is the admin until access is reassigned later.</p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#0B1F33]">Team creation</p>
                    <p className="mt-1">Internal users must be invited from the company module by an admin.</p>
                  </div>
                </div>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => router.replace(targetRoute)}
                    className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95"
                  >
                    Continue to platform
                  </button>
                </div>
              </div>
            )}

            {state === 'error' && (
              <div className="space-y-4 text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008Zm9-3.758a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-[#0B1F33]">Welcome page unavailable</h1>
                <p className="text-sm text-[#6B7C93]">{error}</p>
                <button
                  type="button"
                  onClick={() => router.replace('/command-center')}
                  className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-8 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95"
                >
                  Go to workspace
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
