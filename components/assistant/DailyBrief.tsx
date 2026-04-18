import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, X, Sparkles } from 'lucide-react';
import { useAssistant } from '../../hooks/useAssistant';

// ─────────────────────────────────────────────────────────────────────────────
// DailyBrief — shown once per session at the top of dashboard/command center
//
// Shows 2-3 recommended actions for this session.
// Dismissible. Uses sessionStorage to show once per browser session.
// ─────────────────────────────────────────────────────────────────────────────

const BRIEF_DISMISSED_KEY = 'omnivyra_daily_brief_dismissed';

function isBriefDismissedThisSession(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(BRIEF_DISMISSED_KEY) === 'true';
}

function dismissBriefForSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(BRIEF_DISMISSED_KEY, 'true');
}

export default function DailyBrief() {
  const { greeting, dailyActions, mode } = useAssistant();
  const [dismissed, setDismissed] = useState(true); // start dismissed to prevent flash

  // Check on mount
  useEffect(() => {
    setDismissed(isBriefDismissedThisSession());
  }, []);

  if (dismissed || dailyActions.length === 0) return null;

  const handleDismiss = () => {
    dismissBriefForSession();
    setDismissed(true);
  };

  return (
    <div className="mb-6 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-gray-800">{greeting}</span>
        </div>
        <button
          onClick={handleDismiss}
          className="text-gray-400 hover:text-gray-600 p-1 transition-colors"
          title="Dismiss for this session"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Actions */}
      <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {dailyActions.map((action, idx) => (
          <Link
            key={action.href + idx}
            href={action.href}
            className="flex items-start gap-3 px-4 py-3 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all group"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 group-hover:text-blue-700 transition-colors">
                {action.label}
              </p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{action.description}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors shrink-0 mt-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}
