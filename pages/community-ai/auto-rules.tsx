import React, { useEffect, useState } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';

type AutoRule = {
  id: string;
  rule_name: string;
  condition: Record<string, any>;
  action_type: string;
  max_risk_level: string;
  is_active: boolean;
  created_at?: string;
};

export default function CommunityAiAutoRules() {
  const { selectedCompanyId } = useCompanyContext();
  const tenantId = selectedCompanyId || '';
  const [rules, setRules] = useState<AutoRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [conditionJson, setConditionJson] = useState(
    JSON.stringify(
      { platform: 'linkedin', content_type: 'text', trend: 'up', engagement_below_goal: true },
      null,
      2
    )
  );
  const [actionType, setActionType] = useState('reply');
  const [maxRisk, setMaxRisk] = useState('low');

  const loadRules = async () => {
    if (!tenantId) {
      setRules([]);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth(
        `/api/community-ai/auto-rules?tenant_id=${encodeURIComponent(
          tenantId
        )}&organization_id=${encodeURIComponent(tenantId)}`
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load auto-rules');
      }
      const data = await response.json();
      setRules(data?.rules || []);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to load auto-rules');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, [tenantId]);

  const handleCreateRule = async () => {
    if (!tenantId) return;
    setErrorMessage(null);
    let parsedCondition: any = null;
    try {
      parsedCondition = JSON.parse(conditionJson);
    } catch {
      setErrorMessage('Condition JSON is invalid');
      return;
    }
    try {
      const response = await fetchWithAuth('/api/community-ai/auto-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          rule_name: ruleName,
          condition: parsedCondition,
          action_type: actionType,
          max_risk_level: maxRisk,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to create auto-rule');
      }
      setRuleName('');
      await loadRules();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to create auto-rule');
    }
  };

  const handleToggle = async (rule: AutoRule) => {
    if (!tenantId) return;
    try {
      const response = await fetchWithAuth('/api/community-ai/auto-rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          id: rule.id,
          is_active: !rule.is_active,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to update auto-rule');
      }
      await loadRules();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to update auto-rule');
    }
  };

  const handleDelete = async (ruleId: string) => {
    if (!tenantId) return;
    try {
      const response = await fetchWithAuth('/api/community-ai/auto-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          id: ruleId,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to delete auto-rule');
      }
      await loadRules();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to delete auto-rule');
    }
  };

  return (
    <CommunityAiLayout title="Auto-Rules">
      <SectionCard title="Create Auto-Rule">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">Rule Name</label>
            <input
              className="border rounded px-3 py-2 text-sm"
              value={ruleName}
              onChange={(event) => setRuleName(event.target.value)}
              placeholder="Auto-reply for trending posts"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">Action Type</label>
            <select
              className="border rounded px-3 py-2 text-sm"
              value={actionType}
              onChange={(event) => setActionType(event.target.value)}
            >
              <option value="like">Like</option>
              <option value="reply">Reply</option>
              <option value="share">Share</option>
              <option value="schedule">Schedule</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">Max Risk Level</label>
            <select
              className="border rounded px-3 py-2 text-sm"
              value={maxRisk}
              onChange={(event) => setMaxRisk(event.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
            </select>
          </div>
          <div className="flex flex-col gap-2 lg:col-span-2">
            <label className="text-xs text-gray-500">Condition (JSON)</label>
            <textarea
              className="border rounded px-3 py-2 text-sm h-32 font-mono"
              value={conditionJson}
              onChange={(event) => setConditionJson(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="w-full sm:w-auto px-3 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
            onClick={handleCreateRule}
            disabled={!ruleName.trim()}
          >
            Create Rule
          </button>
          {errorMessage ? <span className="text-xs text-red-600">{errorMessage}</span> : null}
        </div>
      </SectionCard>

      <SectionCard title="Active Rules">
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading rules...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-3">Rule Name</th>
                  <th className="py-2 pr-3">Condition</th>
                  <th className="py-2 pr-3">Action Type</th>
                  <th className="py-2 pr-3">Max Risk</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b">
                    <td className="py-2 pr-3">{rule.rule_name}</td>
                    <td className="py-2 pr-3 text-xs text-gray-600">
                      {JSON.stringify(rule.condition)}
                    </td>
                    <td className="py-2 pr-3">{rule.action_type}</td>
                    <td className="py-2 pr-3">{rule.max_risk_level}</td>
                    <td className="py-2 pr-3">
                      <button
                        className="px-2 py-1 text-xs rounded border border-gray-300"
                        onClick={() => handleToggle(rule)}
                      >
                        {rule.is_active ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        className="px-2 py-1 text-xs rounded border border-red-500 text-red-600"
                        onClick={() => handleDelete(rule.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-4 text-sm text-gray-500">
                      No auto-rules configured yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </CommunityAiLayout>
  );
}
