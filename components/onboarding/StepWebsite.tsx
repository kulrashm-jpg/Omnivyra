import React, { useState } from 'react';
import { Globe, ArrowRight, Loader2, Sparkles } from 'lucide-react';

interface StepWebsiteProps {
  initialUrl: string;
  isLoading: boolean;
  error: string | null;
  onAnalyze: (url: string) => Promise<boolean>;
  onNext: () => void;
  onTryInstant: () => void;
}

export default function StepWebsite({
  initialUrl,
  isLoading,
  error,
  onAnalyze,
  onNext,
  onTryInstant,
}: StepWebsiteProps) {
  const [url, setUrl] = useState(initialUrl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    const ok = await onAnalyze(url.trim());
    if (ok) onNext();
  };

  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
        <Globe className="w-7 h-7 text-blue-600" />
      </div>

      <h2 className="text-xl font-bold text-gray-900 mb-2">
        What&apos;s your website?
      </h2>
      <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
        We&apos;ll analyze your content and identify opportunities to grow your online presence.
      </p>

      <form onSubmit={handleSubmit} className="max-w-md mx-auto">
        <div className="relative mb-4">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="yourcompany.com"
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            autoFocus
            disabled={isLoading}
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 mb-3">{error}</p>
        )}

        <button
          type="submit"
          disabled={!url.trim() || isLoading}
          className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing your website...
            </>
          ) : (
            <>
              Analyze Website
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Skip / instant path */}
      <div className="mt-6 pt-5 border-t border-gray-100">
        <button
          onClick={onTryInstant}
          className="text-sm text-gray-400 hover:text-blue-600 transition-colors inline-flex items-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Try instantly without setup
        </button>
      </div>
    </div>
  );
}
