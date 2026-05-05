import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight, ArrowLeft, Loader2, BarChart3, PenTool, CheckCircle2 } from 'lucide-react';

interface StepResultProps {
  companyName: string;
  industry: string;
  goal: string;
  isLoading: boolean;
  error: string | null;
  onGenerateReport: () => Promise<string | null>;
  onComplete: () => void;
  onBack: () => void;
  onNavigate: (route: string) => void;
}

// Sample content ideas based on goal
const CONTENT_IDEAS: Record<string, string[]> = {
  traffic: [
    'How to Rank #1 for Your Core Keywords — A Step-by-Step Guide',
    '10 Content Gaps Your Competitors Are Exploiting Right Now',
    'The SEO Checklist That Doubled Our Organic Traffic in 90 Days',
  ],
  leads: [
    'The Lead Magnet Framework That Converts at 40%+',
    'How to Turn Blog Readers into Qualified Leads',
    'Case Study: From 0 to 500 Leads/Month with Content Marketing',
  ],
  authority: [
    'Why Most Thought Leadership Content Fails (And How to Fix It)',
    'Building a Content Engine That Positions You as the Industry Expert',
    'The Authority Blueprint: From Unknown to Go-To Voice in 6 Months',
  ],
};

export default function StepResult({
  companyName,
  industry,
  goal,
  isLoading,
  error,
  onGenerateReport,
  onComplete,
  onBack,
  onNavigate,
}: StepResultProps) {
  const [reportTriggered, setReportTriggered] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const ideas = CONTENT_IDEAS[goal] || CONTENT_IDEAS.traffic;

  // Show success animation after a brief delay
  useEffect(() => {
    const timer = setTimeout(() => setShowSuccess(true), 300);
    return () => clearTimeout(timer);
  }, []);

  const handleGenerateReport = async () => {
    setReportTriggered(true);
    const reportId = await onGenerateReport();
    if (reportId) {
      onComplete();
      onNavigate('/reports');
    }
  };

  const handleCreateContent = () => {
    onComplete();
    onNavigate('/content/blog');
  };

  return (
    <div className={`transition-all duration-500 ${showSuccess ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      {/* Success header */}
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-7 h-7 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">
          Your first insight is ready
        </h2>
        <p className="text-sm text-gray-500">
          Based on {companyName}&apos;s profile in {industry}
        </p>
      </div>

      {/* Content ideas preview */}
      <div className="max-w-lg mx-auto mb-6">
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                Content ideas for you
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {ideas.map((idea, idx) => (
              <div key={idx} className="px-5 py-3 flex items-start gap-3">
                <span className="text-xs font-bold text-violet-500 bg-violet-50 w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <p className="text-sm text-gray-700 leading-snug">{idea}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Readiness preview (blurred teaser) */}
      <div className="max-w-lg mx-auto mb-6">
        <div className="relative bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 overflow-hidden">
          <div className="flex items-center gap-3 mb-3">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-bold text-gray-800">Content Readiness Score</span>
          </div>
          {/* Blurred preview */}
          <div className="relative">
            <div className="flex items-center gap-4 mb-2 blur-[3px] select-none pointer-events-none">
              <div className="text-4xl font-black text-blue-600">72</div>
              <div className="flex-1">
                <div className="h-3 bg-blue-200 rounded-full overflow-hidden">
                  <div className="h-full w-[72%] bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full" />
                </div>
                <p className="text-xs text-gray-500 mt-1">12 opportunities found across 5 categories</p>
              </div>
            </div>
            {/* Overlay CTA */}
            <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px] rounded-lg">
              <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-3 py-1.5 rounded-full border border-blue-200">
                Generate your real score
              </span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 text-center mb-4">{error}</p>
      )}

      {/* Action buttons */}
      <div className="max-w-lg mx-auto space-y-3">
        <button
          onClick={handleGenerateReport}
          disabled={isLoading || reportTriggered}
          className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Starting analysis...
            </>
          ) : (
            <>
              <BarChart3 className="w-4 h-4" />
              Generate Full Report (Free)
            </>
          )}
        </button>

        <button
          onClick={handleCreateContent}
          className="w-full px-4 py-3 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 font-semibold text-sm rounded-xl transition-all hover:shadow-sm inline-flex items-center justify-center gap-2"
        >
          <PenTool className="w-4 h-4 text-violet-500" />
          Start Creating Content
          <ArrowRight className="w-4 h-4 opacity-50" />
        </button>

        <div className="flex items-center justify-between pt-2">
          <button
            onClick={onBack}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <button
            onClick={onComplete}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}


