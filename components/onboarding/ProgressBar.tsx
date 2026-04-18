import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { OnboardingStep } from '../../hooks/useOnboarding';

const STEPS = [
  { num: 1 as const, label: 'Website' },
  { num: 2 as const, label: 'Business' },
  { num: 3 as const, label: 'First Result' },
];

export default function ProgressBar({ current }: { current: OnboardingStep }) {
  return (
    <div className="flex items-center justify-between w-full max-w-md mx-auto mb-8">
      {STEPS.map((step, idx) => {
        const isComplete = current > step.num;
        const isActive = current === step.num;
        const isLast = idx === STEPS.length - 1;

        return (
          <React.Fragment key={step.num}>
            {/* Step circle + label */}
            <div className="flex flex-col items-center gap-1.5 z-10">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                isComplete
                  ? 'bg-green-500 text-white'
                  : isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                    : 'bg-gray-200 text-gray-400'
              }`}>
                {isComplete ? <CheckCircle2 className="w-4 h-4" /> : step.num}
              </div>
              <span className={`text-[11px] font-medium transition-colors ${
                isActive ? 'text-blue-600' : isComplete ? 'text-green-600' : 'text-gray-400'
              }`}>
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div className="flex-1 mx-3 -mt-5">
                <div className="h-0.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-500"
                    style={{ width: isComplete ? '100%' : '0%' }}
                  />
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
