'use client';

/**
 * /home  — Command Hub
 *
 * Four entry-point cards for the main product areas.
 * Users can pin this page so it loads instead of /dashboard after every login.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';

const PIN_KEY = 'pin_home';

const HUB_CARDS = [
  {
    id:          'readiness',
    emoji:       '🎯',
    title:       'Content Readiness',
    description: 'Audit your brand voice, competitive gaps, and topic authority before you publish.',
    href:        '/content-readiness',
    gradient:    'from-violet-500 to-indigo-500',
    bg:          'bg-violet-50',
    border:      'border-violet-100',
    hover:       'hover:border-violet-300',
  },
  {
    id:          'blog',
    emoji:       '✍️',
    title:       'Create Content',
    description: 'Draft long-form articles, LinkedIn posts, and social copy — powered by AI.',
    href:        '/content/blog',
    gradient:    'from-[#0A66C2] to-[#3FA9F5]',
    bg:          'bg-blue-50',
    border:      'border-blue-100',
    hover:       'hover:border-blue-300',
  },
  {
    id:          'campaign',
    emoji:       '🚀',
    title:       'Run Campaign',
    description: 'Launch and monitor multi-channel campaigns from a single control panel.',
    href:        '/dashboard',
    gradient:    'from-emerald-500 to-teal-500',
    bg:          'bg-emerald-50',
    border:      'border-emerald-100',
    hover:       'hover:border-emerald-300',
  },
  {
    id:          'engage',
    emoji:       '💬',
    title:       'Engage & Grow',
    description: 'Reply to comments, track mentions, and build community — all in one place.',
    href:        '/engagement',
    gradient:    'from-orange-500 to-rose-500',
    bg:          'bg-orange-50',
    border:      'border-orange-100',
    hover:       'hover:border-orange-300',
  },
] as const;

export default function HomePage() {
  const router = useRouter();
  const [pinned, setPinned] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    // Auth guard
    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/login'); return; }
      const name = data.session.user.user_metadata?.full_name as string | undefined;
      if (name) setUserName(name.split(' ')[0]);
    });

    // Read pin preference
    setPinned(localStorage.getItem(PIN_KEY) === '1');
  }, [router]);

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    if (next) {
      localStorage.setItem(PIN_KEY, '1');
    } else {
      localStorage.removeItem(PIN_KEY);
    }
  }

  return (
    <>
      <Head>
        <title>Home | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">

        {/* Header */}
        <header className="border-b border-gray-100 bg-white/95 backdrop-blur-sm sticky top-0 z-10">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
            <Link href="/home">
              <img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" />
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors">
                Dashboard
              </Link>
              <button
                onClick={togglePin}
                title={pinned ? 'Unpin — go to Dashboard on login' : 'Pin — show this page on every login'}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  pinned
                    ? 'border-[#0A66C2] bg-[#0A66C2]/10 text-[#0A66C2]'
                    : 'border-gray-200 text-[#6B7C93] hover:border-[#0A66C2] hover:text-[#0A66C2]'
                }`}
              >
                <PinIcon pinned={pinned} />
                {pinned ? 'Pinned' : 'Pin as home'}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-6 py-12">
          <div className="mx-auto max-w-5xl">

            {/* Greeting */}
            <div className="mb-10 text-center">
              <h1 className="text-3xl font-bold tracking-tight text-[#0B1F33]">
                {userName ? `Welcome back, ${userName} 👋` : 'Welcome back 👋'}
              </h1>
              <p className="mt-2 text-[#6B7C93]">What would you like to work on today?</p>
            </div>

            {/* Cards grid */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {HUB_CARDS.map((card) => (
                <Link key={card.id} href={card.href}
                  className={`group relative flex flex-col gap-4 rounded-2xl border-2 ${card.border} ${card.bg} ${card.hover} p-6 transition-all duration-150 hover:shadow-md`}>
                  <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${card.gradient} text-2xl shadow-sm`}>
                    {card.emoji}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[#0B1F33]">{card.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-[#6B7C93]">{card.description}</p>
                  </div>
                  <div className="mt-auto flex items-center gap-1 text-sm font-medium text-[#0A66C2] opacity-0 transition-opacity group-hover:opacity-100">
                    Get started
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>

            {/* Pin hint */}
            {!pinned && (
              <p className="mt-8 text-center text-xs text-[#6B7C93]">
                <button onClick={togglePin} className="text-[#0A66C2] hover:underline">Pin this page</button>
                {' '}to come here instead of the dashboard after every login.
              </p>
            )}
            {pinned && (
              <p className="mt-8 text-center text-xs text-[#6B7C93]">
                This page will open on every login.{' '}
                <button onClick={togglePin} className="text-[#0A66C2] hover:underline">Go to dashboard instead</button>
              </p>
            )}

          </div>
        </main>
      </div>
    </>
  );
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return pinned ? (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z" />
    </svg>
  );
}
