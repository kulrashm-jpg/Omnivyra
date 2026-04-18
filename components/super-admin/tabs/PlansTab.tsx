import React from 'react';
import { useRouter } from 'next/router';

interface Plan {
  id: string;
  plan_key: string;
  name: string;
  description?: string | null;
  monthly_price?: number | null;
}

interface PlansTabProps {
  pricingPlans: Plan[];
  plansLimits: Record<string, Record<string, number | null>>;
  plansDraftLimits: Record<string, Record<string, string>>;
  isSavingPlan: string | null;
  plansSaveError: string | null;
  plansSaveSuccess: string | null;
  plansSubTab: 'plans' | 'consumption';
  setPlansSubTab: (tab: 'plans' | 'consumption') => void;
  setPlanDraftLimit: (planId: string, resourceKey: string, value: string) => void;
  handleSavePlanLimits: (plan: Plan) => void;
}

export default function PlansTab({
  pricingPlans,
  plansDraftLimits,
  isSavingPlan,
  plansSaveError,
  plansSaveSuccess,
  plansSubTab,
  setPlansSubTab,
  setPlanDraftLimit,
  handleSavePlanLimits,
}: PlansTabProps) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      {/* Pricing & Plans sub-tabs */}
      <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([{ id: 'plans', label: 'Pricing & Plans' }, { id: 'consumption', label: 'Consumption' }] as const).map((sub) => (
          <button
            key={sub.id}
            onClick={() => setPlansSubTab(sub.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${plansSubTab === sub.id ? 'bg-white text-red-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {plansSubTab === 'plans' && <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
          <h3 className="text-lg font-semibold text-gray-900">Pricing & Plan Limits</h3>
          <p className="text-sm text-gray-600 mt-1">
            Right-size plan limits including max campaign duration (weeks). Changes apply to all orgs on that plan.
          </p>
        </div>
        <div className="p-6 space-y-4">
          {plansSaveError && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{plansSaveError}</div>
          )}
          {plansSaveSuccess && (
            <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">{plansSaveSuccess}</div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Plan</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">LLM Tokens</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Ext. API Calls</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Automation Exec.</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Max Duration (wks)</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pricingPlans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{plan.name}</span>
                      <span className="ml-2 text-gray-500">({plan.plan_key})</span>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        value={plansDraftLimits[plan.id]?.llm_tokens ?? ''}
                        onChange={(e) => setPlanDraftLimit(plan.id, 'llm_tokens', e.target.value)}
                        placeholder="—"
                        className="w-28 border border-gray-300 rounded px-2 py-1 text-gray-900"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        value={plansDraftLimits[plan.id]?.external_api_calls ?? ''}
                        onChange={(e) => setPlanDraftLimit(plan.id, 'external_api_calls', e.target.value)}
                        placeholder="—"
                        className="w-28 border border-gray-300 rounded px-2 py-1 text-gray-900"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        value={plansDraftLimits[plan.id]?.automation_executions ?? ''}
                        onChange={(e) => setPlanDraftLimit(plan.id, 'automation_executions', e.target.value)}
                        placeholder="—"
                        className="w-28 border border-gray-300 rounded px-2 py-1 text-gray-900"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={plansDraftLimits[plan.id]?.max_campaign_duration_weeks ?? ''}
                        onChange={(e) => setPlanDraftLimit(plan.id, 'max_campaign_duration_weeks', e.target.value)}
                        placeholder="4–12"
                        title="Max campaign duration in weeks (4–12)"
                        className="w-20 border border-gray-300 rounded px-2 py-1 text-gray-900"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleSavePlanLimits(plan)}
                        disabled={isSavingPlan === plan.id}
                        className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg disabled:opacity-50"
                      >
                        {isSavingPlan === plan.id ? 'Saving...' : 'Save'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pricingPlans.length === 0 && (
            <p className="text-sm text-gray-500 py-4">No plans found. Create plans via POST /api/super-admin/plans/create.</p>
          )}
        </div>
      </div>
      </>}

      {plansSubTab === 'consumption' && <>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <h3 className="text-lg font-semibold text-gray-900">Credit Consumption</h3>
            <p className="text-sm text-gray-600 mt-1">Monitor credit usage across organizations.</p>
          </div>
          <div className="p-6">
            <button
              onClick={() => router.push('/super-admin/consumption')}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium"
            >
              Open Consumption Dashboard
            </button>
          </div>
        </div>
      </>}
    </div>
  );
}
