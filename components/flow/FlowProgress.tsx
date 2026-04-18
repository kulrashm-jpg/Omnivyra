/**
 * FlowProgress — Visual journey progress indicator.
 *
 * Shows the user where they are in the 5-step journey.
 * Minimal: icons + connecting line + labels.
 */
import React from 'react';
import { BarChart3, PenTool, Rocket, MessageCircle, CheckCircle2 } from 'lucide-react';
import type { UserJourneyState } from '../../hooks/useUserState';

const STEPS = [
  { state: 'no_data' as const, label: 'Analyze', icon: BarChart3 },
  { state: 'has_report' as const, label: 'Create', icon: PenTool },
  { state: 'has_content' as const, label: 'Launch', icon: Rocket },
  { state: 'has_campaign' as const, label: 'Engage', icon: MessageCircle },
  { state: 'has_engagement' as const, label: 'Active', icon: CheckCircle2 },
];

const STATE_ORDER: UserJourneyState[] = ['no_data', 'has_report', 'has_content', 'has_campaign', 'has_engagement'];

export default function FlowProgress({ currentState, stepNumber }: {
  currentState: UserJourneyState;
  stepNumber: number;
}) {
  const currentIdx = STATE_ORDER.indexOf(currentState);

  return (
    <div className="flex items-center justify-between max-w-2xl mx-auto">
      {STEPS.map((step, idx) => {
        const Icon = step.icon;
        const isDone = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isFuture = idx > currentIdx;

        return (
          <React.Fragment key={step.state}>
            {/* Step dot */}
            <div className="flex flex-col items-center gap-1.5">
              <div className={`
                w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300
                ${isDone ? 'bg-green-500 text-white' : ''}
                ${isCurrent ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' : ''}
                ${isFuture ? 'bg-gray-100 text-gray-400' : ''}
              `}>
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>
              <span className={`text-[10px] font-semibold transition-colors ${
                isDone ? 'text-green-600' : isCurrent ? 'text-indigo-600' : 'text-gray-400'
              }`}>
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 rounded-full transition-all duration-500 ${
                idx < currentIdx ? 'bg-green-400' : 'bg-gray-200'
              }`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
