import React, { useState, useEffect } from 'react';

type FetchWithAuth = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

type MissionContext = {
  company_name: string;
  mission_statement: string;
  core_problem_domains: string[];
  target_persona: string;
  transformation_outcome: string;
  disqualified_signals: string[];
  opportunity_intent: string;
  geography?: string;
};

type Profile = {
  name?: string;
  target_customer_segment?: string | null;
  key_messages?: string | null;
  campaign_focus?: string | null;
  geography?: string | null;
  geography_list?: string[];
};

type Props = {
  companyId: string | null;
  fetchWithAuth: FetchWithAuth;
};

export default function EngineContextPanel({ companyId, fetchWithAuth }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [missionContext, setMissionContext] = useState<MissionContext | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setMissionContext(null);
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchWithAuth(`/api/company-profile/mission-context?companyId=${encodeURIComponent(companyId)}&mode=FULL`),
      fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`),
    ])
      .then(async ([missionRes, profileRes]) => {
        if (cancelled) return;
        if (missionRes.ok) {
          const missionData = await missionRes.json();
          if (missionData?.mission_context) setMissionContext(missionData.mission_context);
        }
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (profileData?.profile) setProfile(profileData.profile);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, fetchWithAuth]);

  const geography =
    missionContext?.geography ||
    profile?.geography ||
    (profile?.geography_list?.length ? profile.geography_list.join(', ') : null);
  const hasContent = !!(
    missionContext?.mission_statement ||
    (missionContext?.core_problem_domains?.length ?? 0) > 0 ||
    missionContext?.opportunity_intent ||
    profile?.name ||
    profile?.target_customer_segment ||
    profile?.key_messages ||
    profile?.campaign_focus ||
    geography
  );

  return (
    <div className="border border-gray-200 rounded-lg bg-gray-50/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100"
      >
        <span>Why We Are Looking At These Trends</span>
        <span className="text-gray-500">{collapsed ? '▼' : '▲'}</span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-3 pt-0 text-sm text-gray-600 space-y-2">
          {loading && <p className="text-gray-500">Loading…</p>}
          {error && <p className="text-red-600">{error}</p>}
          {!loading && !error && !hasContent && (
            <p className="text-gray-500">No company profile or mission context loaded.</p>
          )}
          {!loading && !error && hasContent && (
            <>
              {missionContext?.mission_statement && (
                <div>
                  <span className="text-gray-500 font-medium">Mission:</span>
                  <p className="mt-0.5 text-gray-700">{missionContext.mission_statement}</p>
                </div>
              )}
              {missionContext?.core_problem_domains && missionContext.core_problem_domains.length > 0 && (
                <div>
                  <span className="text-gray-500 font-medium">Core Problem Domains:</span>
                  <ul className="mt-0.5 list-disc list-inside text-gray-700 space-y-0.5">
                    {missionContext.core_problem_domains.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {missionContext?.opportunity_intent && (
                <div>
                  <span className="text-gray-500 font-medium">Opportunity Intent:</span>
                  <p className="mt-0.5 text-gray-700">{missionContext.opportunity_intent}</p>
                </div>
              )}
              {!missionContext && profile && (
                <>
                  {profile.name && (
                    <div>
                      <span className="text-gray-500">Company:</span>{' '}
                      <span className="font-medium text-gray-900">{profile.name}</span>
                    </div>
                  )}
                  {profile.target_customer_segment && (
                    <div>
                      <span className="text-gray-500">Target customer segment:</span>{' '}
                      {profile.target_customer_segment}
                    </div>
                  )}
                  {profile.key_messages && (
                    <div>
                      <span className="text-gray-500">Key messages:</span> {profile.key_messages}
                    </div>
                  )}
                  {profile.campaign_focus && (
                    <div>
                      <span className="text-gray-500">Campaign focus:</span> {profile.campaign_focus}
                    </div>
                  )}
                </>
              )}
              {geography && (
                <div>
                  <span className="text-gray-500">Geography:</span> {geography}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
