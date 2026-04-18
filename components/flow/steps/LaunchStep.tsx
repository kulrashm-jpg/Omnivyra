/**
 * Step 3: Launch — User has content, ready to launch a campaign.
 * Single action: Create a campaign strategy with BOLT.
 */
import React from 'react';
import { Rocket, ArrowRight, CheckCircle2, Zap } from 'lucide-react';

interface Props { onAction: () => void; }

export default function LaunchStep({ onAction }: Props) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Achievement banner */}
        <div className="px-6 py-3 bg-green-50 border-b border-green-100 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-xs font-semibold text-green-700">Content created — ready to distribute</span>
        </div>

        {/* Content */}
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <Rocket className="w-7 h-7 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Launch your first campaign</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
            BOLT will create a multi-week strategy with daily content plans across your channels.
          </p>

          <button
            onClick={onAction}
            className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm inline-flex items-center gap-2 mx-auto"
          >
            <Zap className="w-4 h-4" />
            Build Campaign Strategy
            <ArrowRight className="w-4 h-4" />
          </button>

          <p className="text-[11px] text-gray-400 mt-3">
            No account connections needed — plan first, publish later
          </p>
        </div>
      </div>
    </div>
  );
}
