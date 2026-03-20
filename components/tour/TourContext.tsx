import React, { createContext, useContext, useEffect, useState } from 'react';

export type TourStep = {
  id: string;
  /** data-tour-id of target element. null = centered modal (no spotlight). */
  target: string | null;
  title: string;
  description: string;
  /** Where to position the tooltip relative to the target. */
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** Primary CTA label in the tooltip. */
  primaryLabel?: string;
  /** If set, clicking primary CTA navigates here. */
  primaryUrl?: string;
  /** Pulse ring on the highlighted element. */
  pulse?: boolean;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: null,
    title: 'Welcome to Omnivyra!',
    description:
      "Let's get you set up in a few quick steps. We'll guide you through everything — you can restart this guide any time by clicking Start Help in the header.",
    position: 'center',
    primaryLabel: "Let's go →",
  },
  {
    id: 'company-profile',
    target: 'company-profile-card',
    title: 'Step 1 — Create your Company Profile',
    description:
      'This is your starting point. Click Open Profile to tell us about your company — name, website, industry, and goals. We use this to personalise every campaign.',
    position: 'bottom',
    primaryLabel: 'Open Profile',
    primaryUrl: '/company-profile',
    pulse: true,
  },
  {
    id: 'api-connections',
    target: 'api-connections-card',
    title: 'Step 2 — Connect your Platforms & APIs',
    description:
      'Connect the tools that power your campaigns:\n• Trend APIs — for topic & keyword suggestions\n• Social platforms — LinkedIn, Twitter, Facebook…\n• Communities — Reddit & forums for listening\n• Image APIs — add visuals to your posts',
    position: 'bottom',
    primaryLabel: 'Manage Connections',
    primaryUrl: '/social-platforms',
    pulse: true,
  },
  {
    id: 'recommendations',
    target: 'recommendations-card',
    title: 'Step 3 — Get AI-Powered Recommendations',
    description:
      'Before creating a campaign, view Recommendations. We generate strategic theme cards based on your industry and trending topics — a great starting point.',
    position: 'top',
    primaryLabel: 'View Recommendations',
    primaryUrl: '/recommendations',
    pulse: true,
  },
  {
    id: 'create-campaign',
    target: 'create-campaign-btn',
    title: 'Step 4 — Create your First Campaign',
    description:
      "Ready to build! Click Create Campaign to start. Choose text-based (Bolt) for a quick manual draft, or Run Campaign to let Omnivyra generate the full content pipeline automatically.",
    position: 'bottom',
    primaryLabel: 'Create Campaign',
    primaryUrl: '/campaign-planner?mode=direct',
    pulse: true,
  },
  {
    id: 'done',
    target: null,
    title: "You're all set!",
    description:
      "You now know the full Omnivyra flow. Whenever you need guidance again, click Start Help in the header and this tour will restart from the beginning. Happy campaigning!",
    position: 'center',
    primaryLabel: 'Go to dashboard',
  },
];

type TourContextValue = {
  isActive: boolean;
  currentStep: number;
  step: TourStep;
  totalSteps: number;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
};

const TourContext = createContext<TourContextValue | null>(null);

const STORAGE_KEY = 'omnivyra_tour_seen';

export const TourProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      // Auto-start for new users after a short delay for the page to settle
      const t = setTimeout(() => setIsActive(true), 1400);
      return () => clearTimeout(t);
    }
  }, []);

  const startTour = () => {
    setCurrentStep(0);
    setIsActive(true);
  };

  const nextStep = () => {
    if (currentStep >= TOUR_STEPS.length - 1) {
      setIsActive(false);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, '1');
      }
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const prevStep = () => {
    setCurrentStep((s) => Math.max(0, s - 1));
  };

  const skipTour = () => {
    setIsActive(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, '1');
    }
  };

  return (
    <TourContext.Provider
      value={{
        isActive,
        currentStep,
        step: TOUR_STEPS[currentStep],
        totalSteps: TOUR_STEPS.length,
        startTour,
        nextStep,
        prevStep,
        skipTour,
      }}
    >
      {children}
    </TourContext.Provider>
  );
};

export const useTour = (): TourContextValue => {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside TourProvider');
  return ctx;
};
