import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sparkles, X, ChevronDown, ChevronUp,
  ArrowRight, CheckCircle2, Lightbulb, Target,
} from 'lucide-react';
import { useAssistant } from '../../hooks/useAssistant';
import type { Suggestion, Insight } from '../../hooks/useAssistant';

// ─────────────────────────────────────────────────────────────────────────────
// Suggestion card (inside assistant)
// ─────────────────────────────────────────────────────────────────────────────

function SuggestionItem({ suggestion, onDismiss }: { suggestion: Suggestion; onDismiss: (id: string) => void }) {
  const categoryIcon = {
    setup: Target,
    create: Sparkles,
    optimize: Lightbulb,
    engage: CheckCircle2,
  };
  const Icon = categoryIcon[suggestion.category] || Sparkles;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="w-3.5 h-3.5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-700 leading-snug">{suggestion.message}</p>
          <div className="flex items-center gap-2 mt-2">
            <Link
              href={suggestion.href}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {suggestion.action}
              <ArrowRight className="w-3 h-3" />
            </Link>
            {suggestion.dismissible && (
              <button
                onClick={() => onDismiss(suggestion.id)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Insight item
// ─────────────────────────────────────────────────────────────────────────────

function InsightItem({ insight, onDismiss }: { insight: Insight; onDismiss: (id: string) => void }) {
  const typeStyles = {
    opportunity: 'bg-amber-100 text-amber-600',
    tip: 'bg-violet-100 text-violet-600',
    milestone: 'bg-green-100 text-green-600',
  };

  return (
    <div className="flex items-start gap-2.5 py-2">
      <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${typeStyles[insight.type]}`}>
        {insight.type === 'milestone' ? <CheckCircle2 className="w-3 h-3" /> : <Lightbulb className="w-3 h-3" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-800">{insight.message}</p>
        {insight.detail && <p className="text-xs text-gray-500 mt-0.5">{insight.detail}</p>}
        {insight.action && insight.href && (
          <Link href={insight.href} className="text-xs text-blue-600 hover:text-blue-700 font-medium mt-1 inline-block">
            {insight.action}
          </Link>
        )}
      </div>
      <button onClick={() => onDismiss(insight.id)} className="text-gray-300 hover:text-gray-500 p-0.5 shrink-0">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main floating assistant
// ─────────────────────────────────────────────────────────────────────────────

export default function AssistantGuide({ suppressed = false }: { suppressed?: boolean }) {
  const { mode, collapsed, setCollapsed, greeting, suggestions, insights, dismiss } = useAssistant();
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Fade in after mount (avoid layout shift)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  // Don't render if nothing to show or user hid it
  if (suppressed) return null;
  if (hidden) return null;
  if (suggestions.length === 0 && insights.length === 0) return null;

  return (
    <div
      className={`fixed bottom-5 right-5 z-40 transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      {/* Collapsed state: just the button */}
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all group"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
            {suggestions.length > 0
              ? `${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''}`
              : 'Insights'}
          </span>
          <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
        </button>
      ) : (
        /* Expanded state: card with suggestions and insights */
        <div className="w-80 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm font-semibold">Assistant</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCollapsed(true)}
                  className="p-1 rounded-md hover:bg-white/20 transition-colors"
                  title="Minimize"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setHidden(true)}
                  className="p-1 rounded-md hover:bg-white/20 transition-colors"
                  title="Hide until next session"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <p className="text-xs text-blue-100 mt-1">{greeting}</p>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="px-3 py-3 space-y-2">
              {suggestions.map((s) => (
                <SuggestionItem key={s.id} suggestion={s} onDismiss={dismiss} />
              ))}
            </div>
          )}

          {/* Insights (if any, shown below suggestions) */}
          {insights.length > 0 && (
            <div className="px-3 pb-3 border-t border-gray-100 pt-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Insights</p>
              {insights.map((i) => (
                <InsightItem key={i.id} insight={i} onDismiss={dismiss} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
