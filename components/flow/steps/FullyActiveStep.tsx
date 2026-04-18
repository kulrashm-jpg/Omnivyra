/**
 * Step 5: Fully Active — User has completed the full journey.
 * Shows a celebration and quick actions to continue using the platform.
 */
import React from 'react';
import { CheckCircle2, BarChart3, PenTool, Rocket, ArrowRight } from 'lucide-react';

interface Props { onDashboard: () => void; }

export default function FullyActiveStep({ onDashboard }: Props) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-8 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">You&apos;re fully set up!</h2>
        <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
          Your platform is configured and running. Here&apos;s what you can do next:
        </p>

        <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto mb-6">
          {[
            { icon: BarChart3, label: 'View reports', color: 'text-blue-600 bg-blue-50 border-blue-200' },
            { icon: PenTool, label: 'Create content', color: 'text-violet-600 bg-violet-50 border-violet-200' },
            { icon: Rocket, label: 'Manage campaigns', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
          ].map((item) => (
            <div key={item.label} className={`p-3 rounded-xl border ${item.color} text-center`}>
              <item.icon className="w-5 h-5 mx-auto mb-1" />
              <p className="text-[11px] font-semibold">{item.label}</p>
            </div>
          ))}
        </div>

        <button
          onClick={onDashboard}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm inline-flex items-center gap-2"
        >
          Go to Dashboard <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
