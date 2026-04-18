import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import type {
  GovernanceAnalytics,
  GovernanceEvent,
  GovernanceStatusState,
} from './types';

export function useGovernancePanel(params: {
  campaignId?: string;
  effectiveCompanyId: string;
  activeTab: 'overview' | 'performance' | 'governance';
  onBlueprintFlags?: (flags: { blueprintImmutable: boolean; blueprintFrozen: boolean }) => void;
}) {
  const [governanceStatus, setGovernanceStatus] = useState<GovernanceStatusState | null>(null);
  const [governanceEvents, setGovernanceEvents] = useState<GovernanceEvent[]>([]);
  const [governanceAnalytics, setGovernanceAnalytics] = useState<GovernanceAnalytics | null>(null);
  const [governanceLoading, setGovernanceLoading] = useState(false);
  const [governanceAuditStatus, setGovernanceAuditStatus] = useState<'OK' | 'WARNING' | 'CRITICAL' | null>(null);
  const [governanceLocked, setGovernanceLocked] = useState(false);
  const [governanceSnapshotAt, setGovernanceSnapshotAt] = useState<string | null>(null);
  const [governanceSnapshotCount, setGovernanceSnapshotCount] = useState(0);
  const [governanceLatestSnapshotId, setGovernanceLatestSnapshotId] = useState<string | null>(null);
  const [governanceLedgerIntegrity, setGovernanceLedgerIntegrity] = useState<'VALID' | 'CORRUPTED' | null>(null);
  const [governanceLoadGuardCounts, setGovernanceLoadGuardCounts] = useState({
    replayRateLimitedCount: 0,
    snapshotRestoreBlockedCount: 0,
    projectionRebuildBlockedCount: 0,
  });
  const [isAdmin, setIsAdmin] = useState(false);

  const hydrateDriftState = useCallback((driftData: any) => {
    setGovernanceAuditStatus(driftData.auditStatus ?? null);
    setGovernanceLocked(driftData.locked ?? false);
    setGovernanceSnapshotAt(driftData.lastSnapshotAt ?? null);
    setGovernanceSnapshotCount(driftData.snapshotCount ?? 0);
    setGovernanceLatestSnapshotId(driftData.lastSnapshotId ?? null);
    setGovernanceLedgerIntegrity(driftData.ledgerIntegrity ?? null);
    setGovernanceLoadGuardCounts({
      replayRateLimitedCount: driftData.replayRateLimitedCount ?? 0,
      snapshotRestoreBlockedCount: driftData.snapshotRestoreBlockedCount ?? 0,
      projectionRebuildBlockedCount: driftData.projectionRebuildBlockedCount ?? 0,
    });
  }, []);

  const loadGovernance = useCallback(async () => {
    if (!params.campaignId || !params.effectiveCompanyId) return;
    setGovernanceLoading(true);
    try {
      const [statusRes, eventsRes, analyticsRes, driftRes] = await Promise.all([
        fetchWithAuth(
          `/api/governance/campaign-status?campaignId=${encodeURIComponent(params.campaignId)}&companyId=${encodeURIComponent(params.effectiveCompanyId)}`,
        ),
        fetchWithAuth(
          `/api/governance/events?companyId=${encodeURIComponent(params.effectiveCompanyId)}&campaignId=${encodeURIComponent(params.campaignId)}`,
        ),
        fetchWithAuth(`/api/governance/campaign-analytics?campaignId=${encodeURIComponent(params.campaignId)}`),
        fetchWithAuth(`/api/governance/company-drift?companyId=${encodeURIComponent(params.effectiveCompanyId)}`),
      ]);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        params.onBlueprintFlags?.({
          blueprintImmutable: statusData.governance?.blueprintImmutable ?? false,
          blueprintFrozen: statusData.governance?.blueprintFrozen ?? false,
        });
        setGovernanceStatus({
          governance: statusData.governance,
          latestGovernanceEvent: statusData.latestGovernanceEvent,
          trade_off_options: statusData.trade_off_options,
        });
      }
      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        setGovernanceEvents(eventsData.events ?? []);
      }
      if (analyticsRes.ok) {
        const analyticsData = await analyticsRes.json();
        setGovernanceAnalytics(analyticsData);
      } else {
        setGovernanceAnalytics(null);
      }
      if (driftRes.ok) {
        const driftData = await driftRes.json();
        hydrateDriftState(driftData);
      } else {
        setGovernanceAuditStatus(null);
        setGovernanceLocked(false);
        setGovernanceSnapshotAt(null);
        setGovernanceSnapshotCount(0);
        setGovernanceLatestSnapshotId(null);
        setGovernanceLedgerIntegrity(null);
        setGovernanceLoadGuardCounts({
          replayRateLimitedCount: 0,
          snapshotRestoreBlockedCount: 0,
          projectionRebuildBlockedCount: 0,
        });
      }
    } catch (err) {
      console.error('Error loading governance:', err);
    } finally {
      setGovernanceLoading(false);
    }
  }, [hydrateDriftState, params.campaignId, params.effectiveCompanyId, params.onBlueprintFlags]);

  useEffect(() => {
    if (params.activeTab !== 'governance' || !params.campaignId || !params.effectiveCompanyId) return;
    loadGovernance();
  }, [params.activeTab, params.campaignId, params.effectiveCompanyId, loadGovernance]);

  useEffect(() => {
    if (!params.campaignId || !params.effectiveCompanyId) return;
    fetchWithAuth(`/api/governance/campaign-analytics?campaignId=${encodeURIComponent(params.campaignId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setGovernanceAnalytics(data);
      })
      .catch(() => {});
  }, [params.campaignId, params.effectiveCompanyId]);

  useEffect(() => {
    if (!params.campaignId || !params.effectiveCompanyId) return;
    fetchWithAuth(`/api/governance/company-drift?companyId=${encodeURIComponent(params.effectiveCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) hydrateDriftState(d);
      })
      .catch(() => {});
  }, [hydrateDriftState, params.campaignId, params.effectiveCompanyId]);

  useEffect(() => {
    if (!params.effectiveCompanyId) return;
    const loadAdminStatus = async () => {
      try {
        const response = await fetchWithAuth(
          `/api/admin/check-super-admin?companyId=${encodeURIComponent(params.effectiveCompanyId)}`,
        );
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch (error) {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, [params.effectiveCompanyId]);

  useEffect(() => {
    if (!params.campaignId || !params.effectiveCompanyId) return;
    fetchWithAuth(
      `/api/governance/campaign-status?campaignId=${encodeURIComponent(params.campaignId)}&companyId=${encodeURIComponent(params.effectiveCompanyId)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.governance) return;
        params.onBlueprintFlags?.({
          blueprintImmutable: data.governance.blueprintImmutable ?? false,
          blueprintFrozen: data.governance.blueprintFrozen ?? false,
        });
      })
      .catch(() => {});
  }, [params.campaignId, params.effectiveCompanyId, params.onBlueprintFlags]);

  return {
    governanceStatus,
    governanceEvents,
    governanceAnalytics,
    governanceLoading,
    governanceAuditStatus,
    governanceLocked,
    governanceSnapshotAt,
    governanceSnapshotCount,
    governanceLatestSnapshotId,
    governanceLedgerIntegrity,
    governanceLoadGuardCounts,
    isAdmin,
    loadGovernance,
  };
}
