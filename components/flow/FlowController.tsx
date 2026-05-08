/**
 * FlowController — State-driven UI controller.
 *
 * Reads useUserState and renders the appropriate step.
 * Each step is a focused, single-action view.
 *
 * This is the ONLY component that decides what the user sees.
 * No other component should duplicate this logic.
 */
import React from 'react';
import { useRouter } from 'next/router';
import type { UserJourneyState, UserStateInfo } from '../../hooks/useUserState';
import AnalyzeStep from './steps/AnalyzeStep';
import CreateStep from './steps/CreateStep';
import LaunchStep from './steps/LaunchStep';
import EngageStep from './steps/EngageStep';
import FullyActiveStep from './steps/FullyActiveStep';
import FlowProgress from './FlowProgress';

interface FlowControllerProps {
  userState: UserStateInfo;
  displayName: string;
  companyName: string;
}

export default function FlowController({ userState, displayName, companyName }: FlowControllerProps) {
  const router = useRouter();

  if (userState.loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const navigate = (route: string) => router.push(route);

  const renderStep = (): React.ReactNode => {
    switch (userState.state) {
      case 'no_data':
        return <AnalyzeStep onAction={() => navigate('/reports')} />;
      case 'has_report':
        return <CreateStep onAction={() => navigate('/blogs/create')} />;
      case 'has_content':
        return <LaunchStep onAction={() => navigate('/command-center/bolt-text')} />;
      case 'has_campaign':
        return <EngageStep onAction={() => navigate('/community-ai/actions')} />;
      case 'has_engagement':
        return <FullyActiveStep onDashboard={() => navigate('/')} />;
      default:
        return <AnalyzeStep onAction={() => navigate('/reports')} />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Progress bar — always visible, shows where user is in the journey */}
      <FlowProgress
        currentState={userState.state}
        stepNumber={userState.stepNumber}
      />

      {/* Active step */}
      {renderStep()}
    </div>
  );
}
