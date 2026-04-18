/**
 * Step 2: Create — User has a report, ready to create content.
 * Single action: Generate first blog/content piece.
 */
import React from 'react';
import { PenTool, ArrowRight, CheckCircle2, FileText, Sparkles } from 'lucide-react';

interface Props { onAction: () => void; }

export default function CreateStep({ onAction }: Props) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Achievement banner */}
        <div className="px-6 py-3 bg-green-50 border-b border-green-100 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-xs font-semibold text-green-700">Report generated — insights are ready</span>
        </div>

        {/* Content */}
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto mb-4">
            <PenTool className="w-7 h-7 text-violet-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Create your first content</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
            Generate SEO-optimized blogs, articles, and social posts based on your report insights.
          </p>

          <button
            onClick={onAction}
            className="px-8 py-3 bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm inline-flex items-center gap-2 mx-auto"
          >
            <FileText className="w-4 h-4" />
            Start Writing
            <ArrowRight className="w-4 h-4" />
          </button>

          <p className="text-[11px] text-gray-400 mt-3 flex items-center justify-center gap-1">
            <Sparkles className="w-3 h-3" /> AI generates a draft in seconds
          </p>
        </div>
      </div>
    </div>
  );
}
