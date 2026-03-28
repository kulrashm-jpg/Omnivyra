/**
 * Strategy Setup Panel
 * Context Mode selector (Full / Focused / None) + focus modules when Focused.
 * Target Audience, Message/CTA, and Strategic Themes have moved to CampaignContextBar.
 */

import { useCallback } from 'react';
import { usePlannerSession } from './plannerSessionStore';
import EngineContextPanel from '../recommendations/EngineContextPanel';
import UnifiedContextModeSelector, {
  type ContextMode,
  type FocusModule,
} from '../recommendations/engine-framework/UnifiedContextModeSelector';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

const TO_UNIFIED: Record<string, ContextMode> = {
  full_company_context: 'FULL',
  minimal: 'FOCUSED',
  none: 'NONE',
};
const TO_PLANNER: Record<'FULL' | 'FOCUSED' | 'NONE', 'full_company_context' | 'minimal' | 'none'> = {
  FULL: 'full_company_context',
  FOCUSED: 'minimal',
  NONE: 'none',
};

export interface StrategySetupPanelProps {
  companyId?: string | null;
  campaignId?: string | null;
  recommendation_context?: Record<string, unknown> | null;
  opportunity_context?: Record<string, unknown> | null;
  onOpportunityApplied?: () => void;
}

export function StrategySetupPanel({ companyId }: StrategySetupPanelProps) {
  const { state, setCampaignDesign } = usePlannerSession();

  const companyContextMode = state.campaign_design?.company_context_mode ?? 'full_company_context';
  const focusModules = (state.campaign_design?.focus_modules ?? []) as FocusModule[];
  const contextMode = TO_UNIFIED[companyContextMode] ?? 'FULL';

  const handleContextModeChange = useCallback(
    (mode: 'FULL' | 'FOCUSED' | 'NONE') => {
      setCampaignDesign({ company_context_mode: TO_PLANNER[mode], trend_context: null });
    },
    [setCampaignDesign]
  );

  const handleModulesChange = useCallback(
    (modules: FocusModule[]) => {
      setCampaignDesign({ focus_modules: modules });
    },
    [setCampaignDesign]
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">Context Mode</h3>
      <UnifiedContextModeSelector
        mode={contextMode}
        modules={focusModules}
        additionalDirection=""
        onModeChange={handleContextModeChange}
        onModulesChange={handleModulesChange}
        onAdditionalDirectionChange={() => {}}
        skipStorageSync
        showTrendOption={false}
      />
      {contextMode === 'FOCUSED' && companyId && (
        <EngineContextPanel
          companyId={companyId}
          fetchWithAuth={fetchWithAuth}
          contextMode="FOCUSED"
          focusedModules={focusModules}
          additionalDirection=""
        />
      )}
    </div>
  );
}
