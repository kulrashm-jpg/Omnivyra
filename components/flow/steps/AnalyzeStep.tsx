/**
 * Step 1: Analyze — User has no data yet.
 * Single action: Enter website URL to get a free analysis.
 */
import React, { useState } from 'react';
import { BarChart3, ArrowRight, Globe, Sparkles } from 'lucide-react';

interface Props { onAction: () => void; }

export default function AnalyzeStep({ onAction }: Props) {
  const [url, setUrl] = useState('');

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Hero section */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-8 text-white text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold mb-2">Get your free content analysis</h2>
          <p className="text-sm text-blue-100 max-w-md mx-auto">
            We&apos;ll scan your website and give you a full report — competitor gaps,
            content opportunities, and a roadmap to grow.
          </p>
        </div>

        {/* Action area */}
        <div className="p-6">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yourwebsite.com"
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={onAction}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm inline-flex items-center gap-2 shrink-0"
            >
              Analyze <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Value preview */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: 'Competitor gaps', icon: '🎯' },
              { label: 'Content score', icon: '📊' },
              { label: 'Growth roadmap', icon: '🚀' },
            ].map((item) => (
              <div key={item.label} className="text-center p-3 bg-gray-50 rounded-lg">
                <span className="text-lg">{item.icon}</span>
                <p className="text-[11px] text-gray-600 mt-1 font-medium">{item.label}</p>
              </div>
            ))}
          </div>

          <p className="text-center text-[11px] text-gray-400 mt-3 flex items-center justify-center gap-1">
            <Sparkles className="w-3 h-3" /> Free — takes about 2 minutes
          </p>
        </div>
      </div>
    </div>
  );
}
