/** Page barrel — component relocated to components/command-center (Next bans export * in pages). */
import React from 'react';
import BoltCombinedStrategyMain from '../../components/command-center/BoltCombinedStrategyMain';
import CampaignWriteGate from '../../components/access/CampaignWriteGate';

/** F3: read-only roles get AccessRestricted (also covers /command-center/intelligent-mix-strategy). */
export default function BoltCombinedStrategyPage() {
  return (
    <CampaignWriteGate>
      <BoltCombinedStrategyMain />
    </CampaignWriteGate>
  );
}
