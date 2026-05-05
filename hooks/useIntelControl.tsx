import { useCallback, useEffect, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';
import {
  getSchedulerConfig,
  updateSchedulerConfig as apiUpdateSchedulerConfig,
  getSchedulerOverrides,
  createSchedulerOverride as apiCreateSchedulerOverride,
  deleteSchedulerOverride as apiDeleteSchedulerOverride,
  triggerSchedulerBoost as apiTriggerSchedulerBoost,
  getExecutionInsights,
} from '@/features/intelligence-control/data/intelControl.api';

import type {
  Tab,
  Msg,
  GlobalConfigRow,
  ResolvedJob,
  InsightsData,
} from '@/features/intelligence-control/types';

export function useIntelControl() {
  const ctx = useCompanyContext();
  const userRole = ctx.userRole;
  const companies = (ctx as { companies?: Array<{ company_id: string; name: string }> }).companies ?? [];

  const [tab, setTab] = useState<Tab>('global');

  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  const _ef1 = !isSuperAdmin;

  // ── Global Config tab ───────────────────────────────────────────────────────
  const [cfgConfigs, setCfgConfigs] = useState<GlobalConfigRow[]>([]);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgEdits, setCfgEdits]     = useState<Record<string, Partial<GlobalConfigRow>>>({});
  const [cfgSaving, setCfgSaving]   = useState<Set<string>>(new Set());
  const [cfgMsg, setCfgMsg]         = useState<Msg>(null);

  const loadSchedulerConfig = useCallback(async () => {
    setCfgLoading(true);
    try {
      const r = await getSchedulerConfig();
      if (r.ok) {
        const d = await r.json();
        setCfgConfigs(d.configs ?? []);
      }
    } finally { setCfgLoading(false); }
  }, []);

  useEffect(() => { if (isSuperAdmin) loadSchedulerConfig(); }, [isSuperAdmin, loadSchedulerConfig]);

  const setCfgEdit = useCallback((jobType: string, field: string, value: unknown) => {
    setCfgEdits(prev => ({
      ...prev,
      [jobType]: { ...(prev[jobType] ?? {}), [field]: value },
    }));
  }, []);

  const updateSchedulerConfig = useCallback(async (row: GlobalConfigRow) => {
    const patch = cfgEdits[row.job_type];
    if (!patch || Object.keys(patch).length === 0) return;
    setCfgSaving(s => new Set(s).add(row.job_type));
    try {
      const r = await apiUpdateSchedulerConfig({ job_type: row.job_type, ...patch });
      if (r.ok) {
        setCfgEdits(prev => { const n = { ...prev }; delete n[row.job_type]; return n; });
        setCfgMsg({ type: 'ok', text: `${row.label} updated.` });
        loadSchedulerConfig();
      } else {
        const d = await r.json();
        setCfgMsg({ type: 'err', text: d.error ?? 'Update failed' });
      }
    } finally {
      setCfgSaving(s => { const n = new Set(s); n.delete(row.job_type); return n; });
    }
  }, [cfgEdits, loadSchedulerConfig]);

  // ── Company Overrides tab ───────────────────────────────────────────────────
  const [ovrSearch, setOvrSearch]               = useState('');
  const [ovrSelectedId, setOvrSelectedId]       = useState('');
  const [ovrJobs, setOvrJobs]                   = useState<ResolvedJob[]>([]);
  const [ovrLoading, setOvrLoading]             = useState(false);
  const [ovrExpanded, setOvrExpanded]           = useState<Set<string>>(new Set());
  const [ovrEditOverride, setOvrEditOverride]   = useState<Record<string, Partial<ResolvedJob['override']>>>({});
  const [ovrSaving, setOvrSaving]               = useState<Set<string>>(new Set());
  const [ovrDeleting, setOvrDeleting]           = useState<Set<string>>(new Set());
  const [ovrMsg, setOvrMsg]                     = useState<Msg>(null);

  const loadOverrides = useCallback(async (cid: string) => {
    setOvrSelectedId(cid);
    setOvrLoading(true);
    try {
      const r = await getSchedulerOverrides(cid);
      if (r.ok) {
        const d = await r.json();
        setOvrJobs(d.jobs ?? []);
      }
    } finally { setOvrLoading(false); }
  }, []);

  const toggleOvrExpand = useCallback((jt: string) => {
    setOvrExpanded(prev => {
      const n = new Set(prev);
      if (n.has(jt)) n.delete(jt); else n.add(jt);
      return n;
    });
  }, []);

  const setOvrField = useCallback((jt: string, field: string, value: unknown) => {
    setOvrEditOverride(prev => ({
      ...prev,
      [jt]: { ...(prev[jt] ?? {}), [field]: value },
    }));
  }, []);

  const createOverride = useCallback(async (job: ResolvedJob) => {
    const patch = ovrEditOverride[job.job_type];
    if (!patch) return;
    setOvrSaving(s => new Set(s).add(job.job_type));
    try {
      const r = await apiCreateSchedulerOverride({ company_id: ovrSelectedId, job_type: job.job_type, ...patch });
      if (r.ok) {
        setOvrMsg({ type: 'ok', text: `Override saved for ${job.label}.` });
        setOvrEditOverride(prev => { const n = { ...prev }; delete n[job.job_type]; return n; });
        loadOverrides(ovrSelectedId);
      } else {
        const d = await r.json();
        setOvrMsg({ type: 'err', text: d.error ?? 'Save failed' });
      }
    } finally {
      setOvrSaving(s => { const n = new Set(s); n.delete(job.job_type); return n; });
    }
  }, [ovrEditOverride, ovrSelectedId, loadOverrides]);

  const deleteOverride = useCallback(async (job: ResolvedJob) => {
    if (!job.override) return;
    setOvrDeleting(s => new Set(s).add(job.job_type));
    try {
      const r = await apiDeleteSchedulerOverride({ company_id: ovrSelectedId, job_type: job.job_type });
      if (r.ok) {
        setOvrMsg({ type: 'ok', text: `Override removed — ${job.label} now uses global defaults.` });
        loadOverrides(ovrSelectedId);
      }
    } finally {
      setOvrDeleting(s => { const n = new Set(s); n.delete(job.job_type); return n; });
    }
  }, [ovrSelectedId, loadOverrides]);

  // ── Boost tab ───────────────────────────────────────────────────────────────
  const [bstSearch, setBstSearch]         = useState('');
  const [bstSelectedId, setBstSelectedId] = useState('');
  const [bstDuration, setBstDuration]     = useState(48);
  const [bstAction, setBstAction]         = useState<'apply' | 'remove'>('apply');
  const [bstLoading, setBstLoading]       = useState(false);
  const [bstMsg, setBstMsg]               = useState<Msg>(null);

  const triggerBoost = useCallback(async () => {
    if (!bstSelectedId) return;
    const selectedCompany = companies.find(c => c.company_id === bstSelectedId);
    setBstLoading(true);
    try {
      const r = await apiTriggerSchedulerBoost({ company_id: bstSelectedId, action: bstAction, duration_hours: bstDuration });
      const d = await r.json();
      if (r.ok) {
        setBstMsg({
          type: 'ok',
          text: bstAction === 'apply'
            ? `Boost applied for ${selectedCompany?.name}. All jobs will run at P1 priority for ${bstDuration}h.`
            : `Boost removed for ${selectedCompany?.name}. Jobs return to normal priority.`,
        });
      } else {
        setBstMsg({ type: 'err', text: d.error ?? 'Operation failed' });
      }
    } finally { setBstLoading(false); }
  }, [bstSelectedId, bstAction, bstDuration, companies]);

  // ── Insights tab ────────────────────────────────────────────────────────────
  const [insDays, setInsDays]       = useState(7);
  const [insData, setInsData]       = useState<InsightsData | null>(null);
  const [insLoading, setInsLoading] = useState(false);
  const [insError, setInsError]     = useState<string | null>(null);

  const loadInsights = useCallback(async (d: number) => {
    setInsLoading(true);
    setInsError(null);
    try {
      const r = await getExecutionInsights(d);
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? 'Load failed'); }
      setInsData(await r.json());
    } catch (e: unknown) {
      setInsError(e instanceof Error ? e.message : 'Unknown error');
    } finally { setInsLoading(false); }
  }, []);

  useEffect(() => { if (isSuperAdmin) loadInsights(insDays); }, [isSuperAdmin, loadInsights, insDays]);

  return {
    state: {
      tab,
      userRole,
      _ef1,
      companies,
      // Global Config tab
      cfgConfigs,
      cfgLoading,
      cfgEdits,
      cfgSaving,
      cfgMsg,
      // Overrides tab
      ovrSearch,
      ovrSelectedId,
      ovrJobs,
      ovrLoading,
      ovrExpanded,
      ovrEditOverride,
      ovrSaving,
      ovrDeleting,
      ovrMsg,
      // Boost tab
      bstSearch,
      bstSelectedId,
      bstDuration,
      bstAction,
      bstLoading,
      bstMsg,
      // Insights tab
      insDays,
      insData,
      insLoading,
      insError,
    },
    actions: {
      setTab,
      // Global Config
      loadSchedulerConfig,
      updateSchedulerConfig,
      setCfgEdit,
      setCfgMsg,
      // Overrides
      loadOverrides,
      createOverride,
      deleteOverride,
      setOvrSearch,
      setOvrSelectedId,
      toggleOvrExpand,
      setOvrField,
      setOvrMsg,
      // Boost
      triggerBoost,
      setBstSearch,
      setBstSelectedId,
      setBstDuration,
      setBstAction,
      setBstMsg,
      // Insights
      loadInsights,
      setInsDays,
    },
  };
}
