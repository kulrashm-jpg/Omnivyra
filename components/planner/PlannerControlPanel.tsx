/**
 * Planner Control Panel
 * Right-side panel with tabs: Strategy, Structure, Content.
 * AI Assistant moved to persistent bottom strip in campaign-planner. Collapses to drawer when < 1200px.
 */

import React, { useState, useEffect } from 'react';
import { LayoutGrid, FileText, Target, ChevronLeft, ChevronRight } from 'lucide-react';
import { StructureTab } from './tabs/StructureTab';
import { ContentTab } from './tabs/ContentTab';
import { StrategyTab } from './tabs/StrategyTab';

export type PlannerControlTabId = 'structure' | 'content' | 'strategy';

export interface PlannerControlPanelProps {
  companyId?: string | null;
  campaignId?: string | null;
  onGeneratePlan?: () => void;
  onOpportunityApplied?: () => void;
}

export function PlannerControlPanel({
  companyId,
  campaignId,
  onGeneratePlan,
  onOpportunityApplied,
}: PlannerControlPanelProps) {
  const [activeTab, setActiveTab] = useState<PlannerControlTabId>('strategy');
  const [isDrawer, setIsDrawer] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const check = () => {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1400;
      setIsDrawer(w < 1200);
      if (w >= 1200) setDrawerOpen(false);
    };
    check();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', check);
      return () => window.removeEventListener('resize', check);
    }
  }, []);

  const tabButtons = (
    <div className="flex gap-1 border-b border-gray-200 px-2 py-2">
      <button
        type="button"
        onClick={() => setActiveTab('strategy')}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          activeTab === 'strategy'
            ? 'bg-indigo-100 text-indigo-700'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        <Target className="h-4 w-4" />
        Strategy
      </button>
      <button
        type="button"
        onClick={() => setActiveTab('structure')}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          activeTab === 'structure'
            ? 'bg-indigo-100 text-indigo-700'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        <LayoutGrid className="h-4 w-4" />
        Structure
      </button>
      <button
        type="button"
        onClick={() => setActiveTab('content')}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          activeTab === 'content'
            ? 'bg-indigo-100 text-indigo-700'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        <FileText className="h-4 w-4" />
        Content
      </button>
    </div>
  );

  const tabContent = (
    <div className="flex-1 overflow-y-auto min-h-0">
      {activeTab === 'structure' && (
        <StructureTab companyId={companyId} onGenerate={onGeneratePlan} />
      )}
      {activeTab === 'content' && <ContentTab campaignId={campaignId} companyId={companyId} />}
      {activeTab === 'strategy' && (
        <StrategyTab
          companyId={companyId}
          campaignId={campaignId}
          onOpportunityApplied={onOpportunityApplied}
        />
      )}
    </div>
  );

  const fullPanel = (
    <div className="flex flex-col h-full">
      {tabButtons}
      {tabContent}
    </div>
  );

  if (isDrawer) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 px-2 py-4 bg-indigo-600 text-white rounded-l-lg shadow-lg hover:bg-indigo-700 transition-colors"
          title={drawerOpen ? 'Close panel' : 'Open planning panel'}
        >
          {drawerOpen ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronLeft className="h-5 w-5" />
          )}
        </button>
        {drawerOpen && (
          <div
            className="fixed inset-y-0 right-0 w-full max-w-sm bg-white border-l border-gray-200 shadow-xl z-30 flex flex-col"
            style={{ width: 'min(400px, 90vw)' }}
          >
            {fullPanel}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-0" style={{ width: '35%', minWidth: 320 }}>
      {fullPanel}
    </div>
  );
}
