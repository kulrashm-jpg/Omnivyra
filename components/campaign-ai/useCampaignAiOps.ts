import { useEffect, useState } from 'react';
import type { AiHistoryEntry } from './types';

type CampaignAiOpsTab =
  | 'chat'
  | 'history'
  | 'audit'
  | 'execution'
  | 'content'
  | 'performance'
  | 'memory'
  | 'business'
  | 'platform';

type UseCampaignAiOpsParams = {
  activeTab: CampaignAiOpsTab;
  campaignId?: string;
  resolvedCompanyId: string;
  onError: (message: string) => void;
};

export function useCampaignAiOps({
  activeTab,
  campaignId,
  resolvedCompanyId,
  onError,
}: UseCampaignAiOpsParams) {
  const [aiHistory, setAiHistory] = useState<AiHistoryEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [auditReport, setAuditReport] = useState<any>(null);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [healthReport, setHealthReport] = useState<any>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [optimizeWeekNumber, setOptimizeWeekNumber] = useState<number>(1);
  const [optimizeReason, setOptimizeReason] = useState('');
  const [isOptimizingWeek, setIsOptimizingWeek] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<any>(null);
  const [executionPlan, setExecutionPlan] = useState<any>(null);
  const [isExecutionLoading, setIsExecutionLoading] = useState(false);
  const [executionWeekNumber, setExecutionWeekNumber] = useState<number>(1);
  const [schedulerPayload, setSchedulerPayload] = useState<any>(null);
  const [contentAssets, setContentAssets] = useState<any[]>([]);
  const [isContentLoading, setIsContentLoading] = useState(false);
  const [contentWeekNumber, setContentWeekNumber] = useState<number>(1);
  const [regenerateInstruction, setRegenerateInstruction] = useState('');

  const ensureCompanyId = (): boolean => {
    if (!resolvedCompanyId) {
      onError('Please select or create a campaign first.');
      return false;
    }
    return true;
  };

  const loadAiHistory = async (id: string) => {
    try {
      setIsHistoryLoading(true);
      const response = await fetch(`/api/campaigns/${id}/ai-history`);
      if (!response.ok) {
        throw new Error('Failed to load AI history');
      }
      const data = await response.json();
      setAiHistory(data.history || []);
    } catch (error) {
      console.error('Error loading AI history:', error);
      onError('Failed to load AI history. Please try again.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const loadAuditReport = async (id: string) => {
    try {
      setIsAuditLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/audit-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load audit report');
      }
      const data = await response.json();
      setAuditReport(data);
    } catch (error) {
      console.error('Error loading audit report:', error);
      setAuditReport(null);
    } finally {
      setIsAuditLoading(false);
    }
  };

  const loadHealthReport = async (id: string) => {
    try {
      setIsHealthLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/health-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load health report');
      }
      const data = await response.json();
      setHealthReport(data);
    } catch (error) {
      console.error('Error loading health report:', error);
      setHealthReport(null);
    } finally {
      setIsHealthLoading(false);
    }
  };

  const handleOptimizeWeek = async () => {
    if (!campaignId || !optimizeWeekNumber) return;
    setIsOptimizingWeek(true);
    try {
      const response = await fetch('/api/campaigns/optimize-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: optimizeWeekNumber,
          reason: optimizeReason,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to optimize week');
      }
      const data = await response.json();
      setOptimizeResult(data);
      if (data?.health_report) {
        setHealthReport(data.health_report);
      }
    } catch (error) {
      console.error('Error optimizing week:', error);
      onError('Failed to optimize week. Please try again.');
    } finally {
      setIsOptimizingWeek(false);
    }
  };

  const loadExecutionPlan = async (id: string, force = false) => {
    try {
      setIsExecutionLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/platform-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          weekNumber: executionWeekNumber,
          force,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load execution plan');
      }
      const data = await response.json();
      setExecutionPlan(data.plan || null);
      if (data.healthReport) {
        setHealthReport(data.healthReport);
      }
    } catch (error) {
      console.error('Error loading execution plan:', error);
      setExecutionPlan(null);
    } finally {
      setIsExecutionLoading(false);
    }
  };

  const handleApproveScheduling = async () => {
    if (!campaignId) return;
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/scheduler-payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId,
          weekNumber: executionWeekNumber,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to build scheduler payload');
      }
      const data = await response.json();
      setSchedulerPayload(data.payload || null);
      if (data.healthReport) {
        setHealthReport(data.healthReport);
      }
    } catch (error) {
      console.error('Error building scheduler payload:', error);
      onError('Failed to build scheduler payload. Please try again.');
    }
  };

  const loadContentAssets = async (id: string) => {
    try {
      setIsContentLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch(
        `/api/content/list?companyId=${encodeURIComponent(resolvedCompanyId)}&campaignId=${id}&weekNumber=${contentWeekNumber}`
      );
      if (!response.ok) {
        throw new Error('Failed to load content assets');
      }
      const data = await response.json();
      setContentAssets(data.assets || []);
      const planResponse = await fetch('/api/campaigns/platform-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          weekNumber: contentWeekNumber,
        }),
      });
      if (planResponse.ok) {
        const planData = await planResponse.json();
        setExecutionPlan(planData.plan || null);
        if (planData.healthReport) {
          setHealthReport(planData.healthReport);
        }
      }
    } catch (error) {
      console.error('Error loading content assets:', error);
      setContentAssets([]);
    } finally {
      setIsContentLoading(false);
    }
  };

  const handleGenerateContent = async (day: string) => {
    if (!campaignId) return;
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/generate-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId,
          weekNumber: contentWeekNumber,
          day,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to generate content');
      }
      await loadContentAssets(campaignId);
    } catch (error) {
      console.error('Error generating content:', error);
      onError('Failed to generate content.');
    }
  };

  const handleRegenerateContent = async (assetId: string) => {
    if (!regenerateInstruction) {
      onError('Please provide an instruction for regeneration.');
      return;
    }
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, assetId, instruction: regenerateInstruction }),
      });
      if (!response.ok) {
        throw new Error('Failed to regenerate content');
      }
      await loadContentAssets(campaignId || '');
    } catch (error) {
      console.error('Error regenerating content:', error);
      onError('Failed to regenerate content.');
    }
  };

  const handleApproveContent = async (assetId: string) => {
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, assetId }),
      });
      if (!response.ok) {
        throw new Error('Failed to approve content');
      }
      await loadContentAssets(campaignId || '');
    } catch (error) {
      console.error('Error approving content:', error);
      onError('Failed to approve content.');
    }
  };

  const handleRejectContent = async (assetId: string) => {
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, assetId, reason: 'Needs revisions' }),
      });
      if (!response.ok) {
        throw new Error('Failed to reject content');
      }
      await loadContentAssets(campaignId || '');
    } catch (error) {
      console.error('Error rejecting content:', error);
      onError('Failed to reject content.');
    }
  };

  useEffect(() => {
    if (activeTab === 'history' && campaignId) {
      loadAiHistory(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'audit' && campaignId) {
      loadAuditReport(campaignId);
      loadHealthReport(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'execution' && campaignId) {
      loadExecutionPlan(campaignId);
    }
  }, [activeTab, campaignId, executionWeekNumber]);

  useEffect(() => {
    if (activeTab === 'content' && campaignId) {
      loadContentAssets(campaignId);
    }
  }, [activeTab, campaignId, contentWeekNumber]);

  return {
    aiHistory,
    isHistoryLoading,
    auditReport,
    isAuditLoading,
    healthReport,
    isHealthLoading,
    optimizeWeekNumber,
    setOptimizeWeekNumber,
    optimizeReason,
    setOptimizeReason,
    isOptimizingWeek,
    optimizeResult,
    executionPlan,
    isExecutionLoading,
    executionWeekNumber,
    setExecutionWeekNumber,
    schedulerPayload,
    contentAssets,
    isContentLoading,
    contentWeekNumber,
    setContentWeekNumber,
    regenerateInstruction,
    setRegenerateInstruction,
    ensureCompanyId,
    setHealthReport,
    loadAiHistory,
    loadAuditReport,
    loadHealthReport,
    handleOptimizeWeek,
    loadExecutionPlan,
    handleApproveScheduling,
    loadContentAssets,
    handleGenerateContent,
    handleRegenerateContent,
    handleApproveContent,
    handleRejectContent,
  };
}
