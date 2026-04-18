/**
 * Step 4: Engage — User has a campaign, ready to monitor engagement.
 * Single action: Connect social accounts and start monitoring.
 */
import React from 'react';
import { MessageCircle, ArrowRight, CheckCircle2, Users } from 'lucide-react';

interface Props { onAction: () => void; }

export default function EngageStep({ onAction }: Props) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Achievement banner */}
        <div className="px-6 py-3 bg-green-50 border-b border-green-100 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-xs font-semibold text-green-700">Campaign active — content is being published</span>
        </div>

        {/* Content */}
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <MessageCircle className="w-7 h-7 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Monitor your community</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
            Track conversations, respond to comments, and capture leads from your campaigns.
          </p>

          <button
            onClick={onAction}
            className="px-8 py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm inline-flex items-center gap-2 mx-auto"
          >
            <Users className="w-4 h-4" />
            Open Engagement Hub
            <ArrowRight className="w-4 h-4" />
          </button>

          <p className="text-[11px] text-gray-400 mt-3">
            AI monitors and prioritizes conversations for you
          </p>
        </div>
      </div>
    </div>
  );
}
