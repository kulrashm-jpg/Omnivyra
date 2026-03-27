/**
 * BlogIntelligenceWizard
 *
 * Steps:
 *   1. platform  — select CMS / framework
 *   2. install   — blog URL input + copy-ready script + instructions
 *   3. verify    — exponential-backoff polling (5s → 10s → 20s, max 3 attempts)
 *   4. success   — confirmation + "coming soon" metrics
 *
 * On success:
 *   - Saves domain to /api/track/settings (enables origin validation)
 *   - Calls onSuccess() so dashboard persists "enabled" state
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, CheckCircle2, Loader2, Copy, Check, ArrowRight, ExternalLink,
  Zap, Globe, Code2, Layers, LayoutGrid, HelpCircle, AlertTriangle,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

type Step     = 'platform' | 'install' | 'verify' | 'success';
type Platform = 'wordpress' | 'joomla' | 'nextjs' | 'webflow' | 'other';

interface Props {
  accountId: string;
  onClose:   () => void;
  onSuccess: () => void;
}

// ── Platform metadata ──────────────────────────────────────────────────────

const PLATFORMS: Array<{ id: Platform; label: string; icon: React.ReactNode; desc: string }> = [
  { id: 'wordpress', label: 'WordPress',        icon: <Globe      className="h-5 w-5" />, desc: 'Appearance → Theme Editor' },
  { id: 'joomla',    label: 'Joomla',            icon: <Layers     className="h-5 w-5" />, desc: 'Template → index.php' },
  { id: 'nextjs',    label: 'React / Next.js',   icon: <Code2      className="h-5 w-5" />, desc: 'layout.tsx or _app.tsx' },
  { id: 'webflow',   label: 'Webflow / No-code', icon: <LayoutGrid className="h-5 w-5" />, desc: 'Project Settings → Custom Code' },
  { id: 'other',     label: 'Other',             icon: <HelpCircle className="h-5 w-5" />, desc: 'Any HTML-based site' },
];

const INSTRUCTIONS: Record<Platform, string[]> = {
  wordpress: [
    'Go to Appearance → Theme File Editor in your WordPress admin.',
    'Select header.php from the right-hand file list.',
    'Paste the script immediately before the closing </head> tag.',
    'Click "Update File" to save.',
  ],
  joomla: [
    'In Joomla admin, go to Extensions → Templates → Templates.',
    'Click your active template, then open index.php.',
    'Paste the script immediately before the closing </head> tag.',
    'Save and close.',
  ],
  nextjs: [
    'Open app/layout.tsx (App Router) or pages/_app.tsx (Pages Router).',
    'Import Script from next/script.',
    'Add <Script src="…" strategy="afterInteractive" /> inside the root layout.',
    'Or paste the raw script tag into your <head> using dangerouslySetInnerHTML.',
  ],
  webflow: [
    'Open your project in Webflow Designer.',
    'Click the gear icon → Project Settings → Custom Code tab.',
    'Paste the script in the "Head Code" area.',
    'Publish your site for changes to take effect.',
  ],
  other: [
    'Open your site\'s base HTML template or layout file.',
    'Paste the script immediately before the closing </head> tag.',
    'Deploy / save your changes.',
  ],
};

// Exponential backoff schedule (ms)
const BACKOFF_SCHEDULE = [5000, 10000, 20000]; // 3 attempts → max ~35s wait

// ── Sub-components ─────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2000);
      })}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

// ── Wizard ─────────────────────────────────────────────────────────────────

export default function BlogIntelligenceWizard({ accountId, onClose, onSuccess }: Props) {
  const [step,            setStep]           = useState<Step>('platform');
  const [platform,        setPlatform]       = useState<Platform | null>(null);
  const [blogUrl,         setBlogUrl]        = useState('');
  const [allowSubdomains, setAllowSubdomains] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified,  setVerified]  = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifyErr, setVerifyErr] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apiBase  = typeof window !== 'undefined' ? window.location.origin : 'https://www.omnivyra.com';
  const scriptTag = `<script src="https://cdn.omnivyra.com/tracker.js" data-account="${accountId}" data-api="${apiBase}"></script>`;

  // ── Cleanup on unmount ───────────────────────────────────────────────
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  // ── Exponential backoff polling ──────────────────────────────────────
  const startVerification = useCallback(() => {
    setVerifying(true);
    setVerifyErr(false);
    setVerifyMsg('Waiting for first tracking event…');

    let attemptIndex = 0;

    const attempt = async () => {
      try {
        const r = await fetch(`/api/track/verify?account_id=${encodeURIComponent(accountId)}`);
        const d = await r.json();
        if (d.active) {
          setVerified(true);
          setVerifying(false);
          setVerifyMsg(null);
          setTimeout(() => setStep('success'), 500);
          return;
        }
      } catch { /* network hiccup — continue */ }

      if (attemptIndex < BACKOFF_SCHEDULE.length - 1) {
        attemptIndex++;
        setVerifyMsg(`Still waiting… (attempt ${attemptIndex + 1}/${BACKOFF_SCHEDULE.length})`);
        timeoutRef.current = setTimeout(attempt, BACKOFF_SCHEDULE[attemptIndex]);
      } else {
        // Exhausted all attempts
        setVerifying(false);
        setVerifyErr(true);
        setVerifyMsg('No events received yet. Make sure the script is saved and visit a page on your blog.');
      }
    };

    // First check after 5s
    timeoutRef.current = setTimeout(attempt, BACKOFF_SCHEDULE[0]);
  }, [accountId]);

  const resetVerify = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVerifying(false);
    setVerified(false);
    setVerifyErr(false);
    setVerifyMsg(null);
  };

  // ── Save settings on success ─────────────────────────────────────────
  const handleSuccess = useCallback(async () => {
    if (blogUrl.trim()) {
      // Fire-and-forget — don't block UX on this
      fetch('/api/track/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: accountId, allowed_domain: blogUrl.trim(), allow_subdomains: allowSubdomains }),
      }).catch(() => {});
    }
    onSuccess();
  }, [accountId, blogUrl, onSuccess]);

  // ── Step renderers ───────────────────────────────────────────────────

  const renderPlatform = () => (
    <div>
      <h3 className="text-lg font-bold text-gray-900 mb-1">Where is your blog hosted?</h3>
      <p className="text-sm text-gray-500 mb-5">We'll show the exact installation steps.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { setPlatform(p.id); setStep('install'); }}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors group"
          >
            <span className="flex-shrink-0 h-9 w-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
              {p.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{p.label}</p>
              <p className="text-xs text-gray-500 truncate">{p.desc}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-indigo-400 transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );

  const renderInstall = () => (
    <div>
      <button type="button" onClick={() => setStep('platform')} className="mb-4 text-xs text-indigo-600 hover:underline">
        ← Change platform
      </button>

      <h3 className="text-lg font-bold text-gray-900 mb-1">Install the tracking script</h3>
      <p className="text-sm text-gray-500 mb-5">Your account ID is pre-filled — copy and paste as-is.</p>

      {/* Blog URL input (for domain validation) */}
      <div className="mb-5">
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Your blog URL <span className="font-normal text-gray-400">(optional — enables domain security)</span>
        </label>
        <input
          type="url"
          value={blogUrl}
          onChange={(e) => setBlogUrl(e.target.value)}
          placeholder="https://myblog.com"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent placeholder-gray-400"
        />
        {blogUrl.trim() && (
          <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allowSubdomains}
              onChange={(e) => setAllowSubdomains(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600"
            />
            <span className="text-xs text-gray-500">Allow tracking from subdomains (e.g. blog.myblog.com)</span>
          </label>
        )}
      </div>

      {/* Script block */}
      <div className="rounded-xl border border-gray-200 bg-gray-950 p-4 mb-2 overflow-x-auto">
        <code className="text-xs text-green-400 break-all whitespace-pre-wrap font-mono">{scriptTag}</code>
      </div>
      <div className="flex justify-end mb-6">
        <CopyButton text={scriptTag} label="Copy script" />
      </div>

      {/* Platform-specific instructions */}
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 mb-6">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">
          {PLATFORMS.find((p) => p.id === platform)?.label} — installation steps
        </p>
        <ol className="space-y-2.5">
          {platform && INSTRUCTIONS[platform].map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-700">
              <span className="mt-0.5 flex-shrink-0 h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <button
        type="button"
        onClick={() => { resetVerify(); setStep('verify'); }}
        className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
      >
        Script is installed — Verify now
      </button>
    </div>
  );

  const renderVerify = () => (
    <div className="text-center">
      <div className="mb-5 flex justify-center">
        {verified ? (
          <CheckCircle2 className="h-14 w-14 text-green-500" />
        ) : verifyErr ? (
          <AlertTriangle className="h-14 w-14 text-amber-400" />
        ) : verifying ? (
          <Loader2 className="h-14 w-14 text-indigo-500 animate-spin" />
        ) : (
          <div className="h-14 w-14 rounded-full bg-indigo-50 flex items-center justify-center">
            <Zap className="h-7 w-7 text-indigo-500" />
          </div>
        )}
      </div>

      <h3 className="text-lg font-bold text-gray-900 mb-1">
        {verified ? 'Tracking confirmed!' : verifyErr ? 'No signal yet' : 'Verify Installation'}
      </h3>

      <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
        {verifyMsg ?? 'Click "Verify" — we\'ll detect the first event from your blog automatically.'}
      </p>

      {/* Open blog hint */}
      {blogUrl && !verified && (
        <a
          href={blogUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mb-5 text-xs text-indigo-600 font-semibold hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open {blogUrl.replace(/^https?:\/\//, '')} in a new tab to trigger the first event
        </a>
      )}

      {!verifying && !verified && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={startVerification}
            className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            {verifyErr ? 'Try again' : 'Verify Installation'}
          </button>
          <button type="button" onClick={() => setStep('install')} className="text-xs text-gray-400 hover:text-gray-600">
            ← Back to instructions
          </button>
        </div>
      )}

      {verifying && (
        <p className="text-xs text-gray-400">
          Checking with exponential backoff — up to {BACKOFF_SCHEDULE.reduce((a, b) => a + b, 0) / 1000}s total wait
        </p>
      )}
    </div>
  );

  const renderSuccess = () => (
    <div className="text-center">
      <div className="mb-5 flex justify-center">
        <div className="h-16 w-16 rounded-full bg-green-50 flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-green-500" />
        </div>
      </div>

      <h3 className="text-xl font-bold text-gray-900 mb-1">Blog Intelligence Enabled!</h3>
      <p className="text-sm text-gray-500 mb-8 max-w-xs mx-auto">
        Tracking is live. Analytics and insights will appear on your dashboard as data accumulates.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-8 text-left">
        {[
          { label: 'Page views',          note: 'Tracked' },
          { label: 'Scroll depth',        note: 'Tracked' },
          { label: 'Engagement insights', note: 'Coming soon' },
          { label: 'Blog → Campaign',     note: 'Coming soon' },
        ].map(({ label, note }) => (
          <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
            <p className="text-xs font-semibold text-gray-800 mb-0.5">{label}</p>
            <p className="text-[10px] text-gray-400">{note}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSuccess}
        className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
      >
        Go to dashboard
      </button>
    </div>
  );

  // ── Progress bar ─────────────────────────────────────────────────────
  const STEPS: Step[] = ['platform', 'install', 'verify', 'success'];
  const stepIdx = STEPS.indexOf(step);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">

        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 pt-5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-indigo-600" />
              <span className="text-sm font-bold text-gray-900">Blog Intelligence Setup</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Progress bar */}
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-all ${i <= stepIdx ? 'bg-indigo-600' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>

        <div className="px-6 py-6">
          {step === 'platform' && renderPlatform()}
          {step === 'install'  && renderInstall()}
          {step === 'verify'   && renderVerify()}
          {step === 'success'  && renderSuccess()}
        </div>
      </div>
    </div>
  );
}
