'use client';

/**
 * /create-account
 *
 * Email + password signup. Supabase sends the confirmation email; the user
 * clicks the link, lands on /auth/callback, and the session is established.
 * Magic-link signup is deliberately not supported — magic link is login-only
 * for existing users.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';
import { validateEmailDomain } from '../lib/auth/domainValidation';
import { trackWebsiteEvent } from '../lib/websiteAnalytics';
import { logoutCurrentSession } from '../lib/security/sessionClient';
import { clearBrowserAuthState } from '../utils/authStorage';

export default function CreateAccountPage() {
  const router = useRouter();
  const { email: emailParam = '' } = router.query as Record<string, string>;

  const [email, setEmail]             = useState('');
  const [companyName, setCompanyName] = useState('');
  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [showPw, setShowPw]           = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [sent, setSent]               = useState(false);
  const [claimed, setClaimed]   = useState<{
    alreadyReferred: boolean;
    adminEmailMasked: string | null;
  } | null>(null);

  useEffect(() => {
    if (emailParam) setEmail(emailParam);
  }, [emailParam]);

  // Store referral code from ?ref= so onboarding can pick it up
  useEffect(() => {
    const ref = router.query.ref as string | undefined;
    if (ref) {
      try { localStorage.setItem('ref_code', ref); } catch { /* ignore */ }
    }
  }, [router.query.ref]);

  useEffect(() => {
    (async () => {
      try { await logoutCurrentSession(); } catch { /* ignore */ }
      try { await getSupabaseBrowser().auth.signOut(); } catch { /* ignore */ }
      clearBrowserAuthState({ preservePkce: false });
    })();
  }, []);

  function validateEmail(val: string): boolean {
    const check = validateEmailDomain(val);
    if (!check.valid) {
      setError((check as { valid: false; reason: string }).reason);
      return false;
    }
    return true;
  }

  function validatePassword(pw: string, cf: string): boolean {
    if (pw.length < 8 || pw.length > 20) {
      setError('Password must be 8–20 characters.');
      return false;
    }
    if (pw !== cf) {
      setError('Passwords do not match.');
      return false;
    }
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    const trimmedCompany = companyName.trim();
    if (!validateEmail(trimmed)) return;
    if (!trimmedCompany) {
      setError('Please enter your company name.');
      return;
    }
    if (trimmedCompany.length > 80) {
      setError('Company name is too long.');
      return;
    }
    if (!validatePassword(password, confirm)) return;

    setLoading(true);
    setError(null);

    // Backend pre-check: work-email + MX + existing-account + signup_intent.
    // Throws on duplicate; otherwise returns { proceed: true }. The company
    // name is persisted in signup_intents.intent_data so /auth/callback can
    // bootstrap the company + COMPANY_ADMIN role on first verify.
    try {
      const res  = await fetch('/api/auth/signup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: trimmed, companyName: trimmedCompany }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === 'RESUME_SIGNUP') {
          router.replace(`/login?email=${encodeURIComponent(trimmed)}&reason=resume_signup`);
          return;
        }
        if (json.code === 'ACCOUNT_EXISTS') {
          router.replace(`/login?email=${encodeURIComponent(trimmed)}&reason=account_exists`);
          return;
        }
        if (json.code === 'COMPANY_CLAIMED') {
          setClaimed({
            alreadyReferred: !!json.alreadyReferred,
            adminEmailMasked: json.adminEmailMasked ?? null,
          });
          setLoading(false);
          return;
        }
        setError(json.error ?? 'Signup failed');
        setLoading(false);
        return;
      }
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
      return;
    }

    // Supabase sends the confirmation email. User clicks → /auth/callback
    // exchanges the code and the session is established.
    const origin = window.location.origin;
    const { error: signUpError } = await getSupabaseBrowser().auth.signUp({
      email: trimmed,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });

    if (signUpError) {
      const msg = signUpError.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        router.replace(`/login?email=${encodeURIComponent(trimmed)}&reason=resume_signup`);
        return;
      }
      if (msg.includes('rate') || (signUpError as any).status === 429) {
        setError('Too many signup attempts. Please wait a few minutes and try again.');
      } else {
        setError(signUpError.message);
      }
      setLoading(false);
      return;
    }

    setLoading(false);
    trackWebsiteEvent('signup_completed', {
      signup_method: 'email_password',
      signup_surface: 'create_account',
    });
    setSent(true);
  }

  // ── Domain already claimed by another company admin ─────────────────────
  if (claimed) {
    return (
      <>
        <Head><title>Company already on Omnivyra | Omnivyra</title></Head>
        <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
          <header className="border-b border-gray-100 bg-white/95">
            <div className="mx-auto flex h-14 max-w-lg items-center px-6">
              <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            </div>
          </header>
          <main className="flex flex-1 items-center justify-center px-6 py-12">
            <div className="w-full max-w-md text-center animate-fadeIn">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-3xl">🏢</div>
              <h2 className="text-2xl font-bold text-[#0B1F33]">Your company is already on Omnivyra</h2>
              {claimed.alreadyReferred ? (
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                  Your administrator&apos;s contact details were already shared with you at{' '}
                  <strong className="text-[#0B1F33]">{email}</strong>. If you need help, email{' '}
                  <a href="mailto:support@omnivyra.com" className="font-medium text-[#0A66C2] hover:underline">
                    support@omnivyra.com
                  </a>.
                </p>
              ) : (
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                  {claimed.adminEmailMasked ? (
                    <>We&apos;ve emailed <strong className="text-[#0B1F33]">{email}</strong> with your administrator&apos;s contact details ({claimed.adminEmailMasked}). Please reach out to them to request access.</>
                  ) : (
                    <>We&apos;ve emailed <strong className="text-[#0B1F33]">{email}</strong> — please check your inbox for next steps.</>
                  )}
                </p>
              )}
              <div className="mt-8 flex flex-col items-center gap-3">
                <Link href="/login"
                  className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95">
                  Go to log in
                </Link>
                <button onClick={() => { setClaimed(null); setError(null); }}
                  className="text-sm text-[#6B7C93] hover:text-[#0A66C2]">
                  Try a different email
                </button>
              </div>
            </div>
          </main>
        </div>
        <style jsx>{`
          @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
          .animate-fadeIn { animation: fadeIn 0.22s ease both; }
        `}</style>
      </>
    );
  }

  // ── Sent confirmation ─────────────────────────────────────────────────────
  if (sent) {
    return (
      <>
        <Head><title>Check your inbox | Omnivyra</title></Head>
        <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
          <header className="border-b border-gray-100 bg-white/95">
            <div className="mx-auto flex h-14 max-w-lg items-center px-6">
              <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            </div>
          </header>
          <main className="flex flex-1 items-center justify-center px-6 py-12">
            <div className="w-full max-w-md text-center animate-fadeIn">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-3xl">📬</div>
              <h2 className="text-2xl font-bold text-[#0B1F33]">Confirm your email</h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                We sent a confirmation link to <strong className="text-[#0B1F33]">{email}</strong>.
                Click it to verify your account and finish signing in.
              </p>
              <button onClick={() => { setSent(false); setError(null); setPassword(''); setConfirm(''); }}
                className="mt-6 text-sm text-[#0A66C2] hover:underline">
                Try a different email
              </button>
            </div>
          </main>
        </div>
        <style jsx>{`
          @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
          .animate-fadeIn { animation: fadeIn 0.22s ease both; }
        `}</style>
      </>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Create Account | Omnivyra</title>
        <meta name="description" content="Create your free Omnivyra account." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
            <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            <Link href="/login" className="text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors">Log in</Link>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            <div className="mb-8 text-center">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-2xl shadow-lg">🎁</div>
              <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">Create your account</h1>
              <p className="mt-2 text-sm text-[#6B7C93]">Start with 300 free credits — no card required.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[#0B1F33] mb-1.5">Work email</label>
                <input
                  id="email" type="email" autoComplete="email" autoFocus required
                  value={email} onChange={e => { setEmail(e.target.value); setError(null); }}
                  placeholder="you@company.com"
                  className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                />
              </div>

              <div>
                <label htmlFor="companyName" className="block text-sm font-medium text-[#0B1F33] mb-1.5">Company name</label>
                <input
                  id="companyName" type="text" autoComplete="organization" required maxLength={80}
                  value={companyName} onChange={e => { setCompanyName(e.target.value); setError(null); }}
                  placeholder="Your company"
                  className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                />
                <p className="mt-1 text-xs text-[#6B7C93]">You&apos;ll be set up as the company admin. You can refine details after signing in.</p>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                  Password <span className="text-[#6B7C93] font-normal">(8–20 characters)</span>
                </label>
                <div className="relative">
                  <input
                    id="password" type={showPw ? 'text' : 'password'}
                    autoComplete="new-password" required minLength={8} maxLength={20}
                    value={password} onChange={e => { setPassword(e.target.value); setError(null); }}
                    placeholder="Choose a strong password"
                    className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 pr-10 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7C93] hover:text-[#0A66C2]">
                    {showPw ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirm" className="block text-sm font-medium text-[#0B1F33] mb-1.5">Confirm password</label>
                <input
                  id="confirm" type={showPw ? 'text' : 'password'}
                  autoComplete="new-password" required
                  value={confirm} onChange={e => { setConfirm(e.target.value); setError(null); }}
                  placeholder="Repeat your password"
                  className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                />
              </div>

              {error && <ErrorBox message={error} />}

              <button type="submit" disabled={loading}
                data-ga-primary-cta
                data-ga-label="Create account"
                data-ga-location="/create-account"
                className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? <Spinner label="Creating account…" /> : 'Create account'}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-[#6B7C93]">
              Already have an account?{' '}
              <Link href="/login" className="font-semibold text-[#0A66C2] hover:underline">Log in</Link>
            </p>
            <p className="mt-2 text-center text-xs text-[#6B7C93]/60">
              By continuing you agree to our{' '}
              <Link href="/terms" className="hover:underline">Terms</Link> and{' '}
              <Link href="/privacy" className="hover:underline">Privacy Policy</Link>.
            </p>

          </div>
        </main>
      </div>

      <style jsx>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.22s ease both; }
      `}</style>
    </>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{message}</p>;
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label}
    </span>
  );
}

function EyeIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>;
}
function EyeOffIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>;
}
