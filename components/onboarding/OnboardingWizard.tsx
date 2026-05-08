import React from 'react';
import { X } from 'lucide-react';
import ProgressBar from './ProgressBar';
import StepWebsite from './StepWebsite';
import StepBusiness from './StepBusiness';
import StepResult from './StepResult';
import type { useOnboarding } from '../../hooks/useOnboarding';

type OnboardingHook = ReturnType<typeof useOnboarding>;

interface OnboardingWizardProps {
  ob: OnboardingHook;
  onNavigate: (route: string) => void;
}

export default function OnboardingWizard({ ob, onNavigate }: OnboardingWizardProps) {
  const {
    state,
    isLoading,
    error,
    nextStep,
    prevStep,
    completeOnboarding,
    dismissOnboarding,
    setError,
    analyzeWebsite,
    saveBusinessContext,
    generateReport,
  } = ob;

  const handleTryInstant = () => {
    completeOnboarding();
    onNavigate('/blogs/create');
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header with close */}
      <div className="flex items-center justify-between px-6 pt-5 pb-0">
        <div />
        <button
          onClick={dismissOnboarding}
          className="text-gray-300 hover:text-gray-500 transition-colors p-1"
          title="Skip setup"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="px-6 py-6 sm:px-10 sm:py-8">
        <ProgressBar current={state.currentStep} />

        {state.currentStep === 1 && (
          <StepWebsite
            initialUrl={state.data.websiteUrl}
            isLoading={isLoading}
            error={error}
            onAnalyze={async (url) => {
              setError(null);
              return analyzeWebsite(url);
            }}
            onNext={nextStep}
            onTryInstant={handleTryInstant}
          />
        )}

        {state.currentStep === 2 && (
          <StepBusiness
            initialName={state.data.companyName}
            initialIndustry={state.data.industry}
            initialGoal={state.data.goal}
            isLoading={isLoading}
            error={error}
            onSave={async (name, industry, goal) => {
              setError(null);
              return saveBusinessContext(name, industry, goal);
            }}
            onNext={nextStep}
            onBack={prevStep}
          />
        )}

        {state.currentStep === 3 && (
          <StepResult
            companyName={state.data.companyName || 'Your company'}
            industry={state.data.industry || 'your industry'}
            goal={state.data.goal || 'traffic'}
            isLoading={isLoading}
            error={error}
            onGenerateReport={generateReport}
            onComplete={completeOnboarding}
            onBack={prevStep}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </div>
  );
}
