/**
 * Step-by-step progress for "Generate marketing intelligence" on the company profile
 * (UI step 6.6; owner: whatever the AI is doing, show clear steps).
 *
 * Labels mirror /api/company-profile/generate-marketing-intelligence: load the profile
 * (getProfile), one AI drafting call (generateMarketingIntelligenceDraft →
 * runCompletionWithOperation), then the audit log + response. The draft comes back for
 * the user to review and save; nothing is saved automatically.
 * Uses the shared StepTracker (the BOLT-modelled progress component) in timed mode; the
 * last step holds until the request finishes and the parent unmounts this component.
 */
import React, { useState } from 'react';
import StepTracker, { type StepDef } from '../progress/StepTracker';

export const MARKETING_INTELLIGENCE_STAGES: readonly StepDef[] = Object.freeze([
  { key: 'mi-read-profile', label: 'Reading your company profile', etaSeconds: 4 },
  { key: 'mi-draft', label: 'Drafting marketing intelligence with AI', etaSeconds: 40 },
  { key: 'mi-prepare', label: 'Preparing your draft for review', etaSeconds: 6 },
]);

export default function MarketingIntelligenceProgress() {
  // Mounted only while generating, so mount time is the start time.
  const [startedAt] = useState(() => Date.now());
  return (
    <StepTracker
      stages={[...MARKETING_INTELLIGENCE_STAGES]}
      startedAt={startedAt}
      status="running"
      accent="indigo"
      title="Generating marketing intelligence"
      variant="card"
    />
  );
}
