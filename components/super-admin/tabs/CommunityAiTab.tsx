import React from 'react';
import { type CommunityAiMetrics, type CommunityAiPolicy } from '@/pages/super-admin.types';

interface CommunityAiTabProps {
  communityPolicy: CommunityAiPolicy | null;
  defaultPolicy: CommunityAiPolicy;
  communityMetrics: CommunityAiMetrics | null;
  communityPolicyUpdatedBy: string | null;
  isSavingPolicy: boolean;
  openPolicyConfirm: (key: keyof CommunityAiPolicy, label: string) => void;
}

export default function CommunityAiTab({
  communityPolicy,
  defaultPolicy,
  communityMetrics,
  communityPolicyUpdatedBy,
  isSavingPolicy,
  openPolicyConfirm,
}: CommunityAiTabProps) {
  return (
    <div className="space-y-6">
      {(communityPolicy?.execution_enabled ?? defaultPolicy.execution_enabled) === false && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
          <div className="flex items-start gap-2">
            <span>⚠️</span>
            <div>
              <p className="font-semibold text-yellow-800">Engagement Center Execution Paused</p>
              <p className="text-sm text-yellow-700">
                Engagement Center execution is currently paused at the platform level.
                All tenants and all Engagement Center actions (manual, scheduled, and automated) are affected.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
          <h3 className="text-lg font-semibold text-gray-900">Global Platform Policy</h3>
          <p className="text-sm text-gray-600 mt-1">This policy applies to ALL tenants and ALL Engagement Center actions.</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Enable Engagement Center Execution</p>
              <p className="text-xs text-gray-500">Global kill switch for all executions</p>
            </div>
            <button
              onClick={() => openPolicyConfirm('execution_enabled', 'Enable Engagement Center Execution')}
              disabled={isSavingPolicy}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                (communityPolicy?.execution_enabled ?? defaultPolicy.execution_enabled)
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              } disabled:opacity-50`}
            >
              {(communityPolicy?.execution_enabled ?? defaultPolicy.execution_enabled) ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Enable Auto-Rules</p>
              <p className="text-xs text-gray-500">Global switch for auto-rule execution</p>
            </div>
            <button
              onClick={() => openPolicyConfirm('auto_rules_enabled', 'Enable Auto-Rules')}
              disabled={isSavingPolicy}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                (communityPolicy?.auto_rules_enabled ?? defaultPolicy.auto_rules_enabled)
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              } disabled:opacity-50`}
            >
              {(communityPolicy?.auto_rules_enabled ?? defaultPolicy.auto_rules_enabled) ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Require Human Approval for All Actions</p>
              <p className="text-xs text-gray-500">Auto-execution will stop until approved</p>
            </div>
            <button
              onClick={() => openPolicyConfirm('require_human_approval', 'Require Human Approval for All Actions')}
              disabled={isSavingPolicy}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                (communityPolicy?.require_human_approval ?? defaultPolicy.require_human_approval)
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-gray-100 text-gray-800'
              } disabled:opacity-50`}
            >
              {(communityPolicy?.require_human_approval ?? defaultPolicy.require_human_approval) ? 'Required' : 'Not Required'}
            </button>
          </div>

          <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
            <div>Last updated: {communityPolicy?.updated_at ? new Date(communityPolicy.updated_at).toLocaleString() : '—'}</div>
            <div>Updated by: {communityPolicyUpdatedBy || communityPolicy?.updated_by || '—'}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
          <h3 className="text-lg font-semibold text-gray-900">Engagement Center (Platform-level)</h3>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-600">Total Actions Executed</p>
            <p className="text-2xl font-bold text-gray-900">{communityMetrics?.total_actions_executed ?? 0}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-600">Total Actions</p>
            <p className="text-2xl font-bold text-gray-900">{communityMetrics?.total_actions ?? 0}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-600">Playbooks</p>
            <p className="text-2xl font-bold text-gray-900">{communityMetrics?.playbooks_count ?? 0}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-600">Auto-Rules</p>
            <p className="text-2xl font-bold text-gray-900">{communityMetrics?.auto_rules_count ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
          <h3 className="text-lg font-semibold text-gray-900">Actions per Tenant</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tenant</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(communityMetrics?.actions_by_tenant || []).map((row) => (
                <tr key={row.tenant_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.tenant_id}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{row.total_actions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
