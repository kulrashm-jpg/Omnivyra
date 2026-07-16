'use client';

/**
 * /help — lightweight customer Help Center.
 *
 * Single self-contained page (not a documentation platform): a concise FAQ for
 * founding customers plus the canonical support / sales / legal entry points.
 * Reuses the existing marketing branding and the shared landing Footer; links
 * out to existing pages (Pricing, Privacy, Terms, Contact Sales, Login,
 * Create Account) rather than duplicating their content.
 */

import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

const BLUE_FIELD = 'linear-gradient(150deg, #071D3A 0%, #0A3770 54%, #0A66C2 100%)';

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How do I get started?',
    a: (
      <>
        <Link href="/create-account" className="text-[#0A66C2] hover:underline">Create your account</Link>,
        {' '}verify your email, and you&apos;ll land in your workspace with 300 free credits to start — no card required.
      </>
    ),
  },
  {
    q: 'What are credits and how do they work?',
    a: <>New accounts start with 300 free credits. Credits are consumed by AI generations (content, reports, planning). Your current balance and usage are shown inside the app under Billing.</>,
  },
  {
    q: 'How much does Omnivyra cost?',
    a: <>See current plans and pricing on our <Link href="/pricing" className="text-[#0A66C2] hover:underline">Pricing</Link> page.</>,
  },
  {
    q: 'Where do I manage billing?',
    a: <>Manage your plan and view usage and balances inside the app after signing in. Plan details are on the <Link href="/pricing" className="text-[#0A66C2] hover:underline">Pricing</Link> page.</>,
  },
  {
    q: 'How do I reset my password?',
    a: <>On the <Link href="/login?mode=forgot" className="text-[#0A66C2] hover:underline">Log in</Link> page, choose &ldquo;Forgot password&rdquo; and we&apos;ll email you a reset link.</>,
  },
  {
    q: 'I didn’t receive my verification email.',
    a: <>After signing up we email a confirmation link — click it to verify your account and finish signing in. If it hasn&apos;t arrived, check your spam folder, or return to <Link href="/create-account" className="text-[#0A66C2] hover:underline">Create Account</Link> and try a different email.</>,
  },
  {
    q: 'Which platforms are supported?',
    a: <>Connect your social and content platforms from Settings → Integrations once you&apos;re signed in.</>,
  },
  {
    q: 'How do I contact support?',
    a: <>Email <a href="mailto:support@omnivyra.com" className="text-[#0A66C2] hover:underline">support@omnivyra.com</a>, or reach our team through <Link href="/contact-sales" className="text-[#0A66C2] hover:underline">Contact Sales</Link>.</>,
  },
];

export default function HelpPage() {
  return (
    <>
      <Head>
        <title>Help Center | Omnivyra</title>
        <meta name="description" content="Omnivyra Help Center — getting started, credits, billing, password reset, email verification, and how to contact support." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
            <Link href="/" aria-label="Omnivyra home"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/login" className="text-[#6B7C93] hover:text-[#0A66C2] transition-colors">Log in</Link>
              <Link href="/create-account" className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-4 py-2 font-semibold text-white transition hover:opacity-95">Create account</Link>
            </nav>
          </div>
        </header>

        <main className="flex-1">
          <section className="relative overflow-hidden px-6 py-14 text-center text-white" style={{ background: BLUE_FIELD }}>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Help Center</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-white/80">
              Quick answers for getting started and using Omnivyra. Can&apos;t find what you need?{' '}
              <a href="mailto:support@omnivyra.com" className="font-semibold text-white underline">Email support</a>.
            </p>
          </section>

          <div className="mx-auto w-full max-w-3xl px-6 py-12">
            <h2 className="mb-6 text-lg font-bold text-[#0B1F33]">Frequently asked questions</h2>
            <div className="space-y-3">
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group rounded-2xl border border-gray-200 bg-white px-5 py-4 open:shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-[#0B1F33]">
                    {q}
                    <span className="ml-4 text-[#0A66C2] transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-[#6B7C93]">{a}</p>
                </details>
              ))}
            </div>

            {/* Canonical support / sales / legal entry points — reuse existing pages. */}
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <h3 className="text-sm font-bold text-[#0B1F33]">Contact support</h3>
                <p className="mt-2 text-sm text-[#6B7C93]">
                  Email us at{' '}
                  <a href="mailto:support@omnivyra.com" className="font-semibold text-[#0A66C2] hover:underline">support@omnivyra.com</a>{' '}
                  and we&apos;ll help you get unblocked.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <h3 className="text-sm font-bold text-[#0B1F33]">Talk to our team</h3>
                <p className="mt-2 text-sm text-[#6B7C93]">
                  For plans, onboarding, or a walkthrough, use{' '}
                  <Link href="/contact-sales" className="font-semibold text-[#0A66C2] hover:underline">Contact Sales</Link>.
                </p>
              </div>
            </div>

            <p className="mt-8 text-center text-xs text-[#6B7C93]/70">
              <Link href="/pricing" className="hover:underline">Pricing</Link>
              {' · '}
              <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
              {' · '}
              <Link href="/terms" className="hover:underline">Terms of Service</Link>
            </p>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}
