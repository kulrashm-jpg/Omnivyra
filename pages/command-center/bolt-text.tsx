/**
 * Command Center → BOLT (Text) Setup Page
 *
 * Collects Content Type, Campaign Duration, and Stop-At View inline,
 * then routes to /recommendations with BOLT (Text) preset query params.
 */

import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';

type ContentFormat = 'post' | 'blog' | 'short_story' | 'article' | 'newsletter';
type OutcomeView = 'week_plan' | 'daily_plan' | 'schedule';

const CONTENT_FORMATS: { value: ContentFormat; label: string; description: string }[] = [
  { value: 'post', label: 'Post', description: 'Short-form social content' },
  { value: 'blog', label: 'Blog', description: 'Long-form SEO articles' },
  { value: 'short_story', label: 'Short Story', description: 'Narrative-driven content' },
  { value: 'article', label: 'Article', description: 'Thought leadership pieces' },
  { value: 'newsletter', label: 'Newsletter', description: 'Email-first distribution' },
];

const DURATION_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1 Week' },
  { value: 2, label: '2 Weeks' },
  { value: 3, label: '3 Weeks' },
  { value: 4, label: '4 Weeks' },
];

const VIEW_OPTIONS: { value: OutcomeView; label: string; icon: string; hint: string }[] = [
  {
    value: 'week_plan',
    label: 'Week Plan',
    icon: '📋',
    hint: 'See a high-level weekly content blueprint',
  },
  {
    value: 'daily_plan',
    label: 'Daily Plan',
    icon: '📅',
    hint: 'Break the plan into day-by-day actions',
  },
  {
    value: 'schedule',
    label: 'Schedule',
    icon: '🗓️',
    hint: 'Auto-schedule posts to your calendar',
  },
];

export default function BoltTextSetupPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();

  // Pre-populate from strategy card selection (passed via query params)
  const presetFormat = typeof router.query.format === 'string' ? router.query.format as ContentFormat : null;
  const presetDuration = typeof router.query.duration === 'string' ? Number(router.query.duration) : null;
  const selectedTheme = typeof router.query.theme === 'string' ? router.query.theme : null;
  const selectedAngle = typeof router.query.angle === 'string' ? router.query.angle : null;
  const selectedPhases = typeof router.query.phases === 'string' ? router.query.phases.split(',').filter(Boolean) : [];
  const extraThemes = typeof router.query.extraThemes === 'string' ? router.query.extraThemes.split('|').filter(Boolean) : [];

  const [contentFormat, setContentFormat] = useState<ContentFormat>(presetFormat ?? 'post');
  const [duration, setDuration] = useState<number>(presetDuration && presetDuration > 0 ? presetDuration : 2);
  const [outcomeView, setOutcomeView] = useState<OutcomeView>('week_plan');

  React.useEffect(() => {
    if (authChecked && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, user?.userId, router]);

  if (!authChecked || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500" />
      </div>
    );
  }

  if (!user?.userId) return null;

  function handleLaunch() {
    const qs = new URLSearchParams({
      boltText: '1',
      format: contentFormat,
      duration: String(duration),
      outcomeView,
    });
    if (selectedTheme) qs.set('theme', selectedTheme);
    if (selectedAngle) qs.set('angle', selectedAngle);
    router.push(`/recommendations?${qs.toString()}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-yellow-50 py-8 px-3 sm:px-4 lg:px-6">
      <div className="max-w-2xl mx-auto">

        {/* Back button */}
        <button
          onClick={() => router.push(selectedTheme ? '/command-center/bolt-text-strategy' : '/command-center/campaigns')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-8 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          {selectedTheme ? 'Back to Strategy Builder' : 'Back to Campaign Modes'}
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-4xl">⚡</span>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">BOLT (Text)</h1>
              <p className="text-sm text-amber-700 font-medium">AI Automated Campaign</p>
            </div>
            <span className="ml-auto text-xs font-semibold px-3 py-1 rounded-full bg-yellow-100 text-yellow-800">
              AI Automated
            </span>
          </div>
          <p className="text-gray-500 text-sm mt-2">
            Set your preferences below. BOLT will generate a fully AI-written campaign — no media or creators needed.
          </p>
        </div>

        {/* Selected strategy card banner */}
        {selectedTheme && (
          <div className="mb-5 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
            <span className="text-2xl shrink-0">⚡</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
                {extraThemes.length > 0 ? `${extraThemes.length + 1} Strategies Selected (Combined)` : 'Selected BOLT Strategy'}
              </p>
              <div className="flex flex-wrap gap-2 mb-1">
                <span className="text-xs bg-white border border-amber-300 text-amber-900 px-2.5 py-1 rounded-full font-semibold">#1 {selectedTheme}</span>
                {extraThemes.map((t, i) => (
                  <span key={i} className="text-xs bg-white border border-amber-200 text-amber-800 px-2.5 py-1 rounded-full font-medium">#{i + 2} {t}</span>
                ))}
              </div>
              {selectedAngle && <p className="text-xs text-gray-500 line-clamp-2">{selectedAngle}</p>}
              {selectedPhases.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedPhases.map((p, i) => (
                    <span key={i} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{p}</span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => router.push('/command-center/bolt-text-strategy')}
              className="shrink-0 text-xs text-amber-600 hover:text-amber-800 underline underline-offset-2 font-medium"
            >
              Change
            </button>
          </div>
        )}

        {/* Setup card */}
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm divide-y divide-gray-100">

          {/* Content Type */}
          <div className="p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
              Content Type
            </h2>
            <p className="text-xs text-gray-400 mb-4">What kind of content should BOLT produce?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {CONTENT_FORMATS.map((fmt) => (
                <button
                  key={fmt.value}
                  type="button"
                  onClick={() => setContentFormat(fmt.value)}
                  className={`flex flex-col items-start text-left px-4 py-3 rounded-xl border-2 transition-all ${
                    contentFormat === fmt.value
                      ? 'border-amber-400 bg-amber-50 text-amber-900'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-amber-300 hover:bg-amber-50/40'
                  }`}
                >
                  <span className="text-sm font-semibold">{fmt.label}</span>
                  <span className="text-xs text-gray-400 mt-0.5">{fmt.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Campaign Duration */}
          <div className="p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
              Campaign Duration
            </h2>
            <p className="text-xs text-gray-400 mb-4">How many weeks should the campaign run?</p>
            <div className="flex gap-2.5">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDuration(opt.value)}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-xl border-2 transition-all ${
                    duration === opt.value
                      ? 'border-amber-400 bg-amber-500 text-white shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-amber-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* View / Stop At */}
          <div className="p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
              View
            </h2>
            <p className="text-xs text-gray-400 mb-4">Where should BOLT stop and show you the result?</p>
            <div className="flex flex-col gap-2.5">
              {VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setOutcomeView(opt.value)}
                  className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border-2 text-left transition-all ${
                    outcomeView === opt.value
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50/40'
                  }`}
                >
                  <span className="text-2xl">{opt.icon}</span>
                  <div className="flex-1">
                    <span className={`text-sm font-semibold block ${outcomeView === opt.value ? 'text-amber-900' : 'text-gray-800'}`}>
                      {opt.label}
                    </span>
                    <span className="text-xs text-gray-400">{opt.hint}</span>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    outcomeView === opt.value ? 'border-amber-500 bg-amber-500' : 'border-gray-300'
                  }`}>
                    {outcomeView === opt.value && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Summary + Launch */}
          <div className="p-6 bg-amber-50/60 rounded-b-2xl">
            <div className="flex items-center gap-3 mb-4 text-sm text-gray-600">
              <span className="font-medium text-gray-800">Summary:</span>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                {CONTENT_FORMATS.find((f) => f.value === contentFormat)?.label}
              </span>
              <span className="text-gray-400">·</span>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                {DURATION_OPTIONS.find((d) => d.value === duration)?.label}
              </span>
              <span className="text-gray-400">·</span>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                {VIEW_OPTIONS.find((v) => v.value === outcomeView)?.label}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLaunch}
              className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <span>⚡</span>
              Launch BOLT (Text)
              <span className="ml-1">→</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
