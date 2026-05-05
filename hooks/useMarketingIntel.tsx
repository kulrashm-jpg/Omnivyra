import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import { fetchMarketingIntel } from '@/features/marketing-intel/data/fetchMarketingIntel';
import { SECTIONS, type SectionKey } from '@/features/marketing-intel/components/SectionCard';
import type { Snapshot } from '@/features/marketing-intel/types';

const TIME_RANGES = [7, 30, 90] as const;
type TimeRange = typeof TIME_RANGES[number];

const TIME_RANGE_KEY = 'omnivyra_micc_timerange';
const SECTIONS_KEY   = 'omnivyra_micc_sections';

const ALL_SECTION_KEYS = new Set<SectionKey>(SECTIONS.map((s) => s.key));

function loadTimeRange(): TimeRange {
  if (typeof window === 'undefined') return 30;
  const raw = localStorage.getItem(TIME_RANGE_KEY);
  const n = parseInt(raw ?? '', 10);
  return (TIME_RANGES as readonly number[]).includes(n) ? (n as TimeRange) : 30;
}

function loadVisibility(): Set<SectionKey> {
  if (typeof window === 'undefined') return new Set(ALL_SECTION_KEYS);
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return new Set(ALL_SECTION_KEYS);
    return new Set(JSON.parse(raw) as SectionKey[]);
  } catch { return new Set(ALL_SECTION_KEYS); }
}

function saveVisibility(v: Set<SectionKey>) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify([...v]));
}

export type MarketingIntelData = {
  // Snapshot state
  snapshot: Snapshot | null;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot | null>>;

  // Loading/error flags (legacy names preserved for view consumers)
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isLoading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  _ef1: boolean;
  _ef2: string | null;

  // Section visibility
  visible: Set<SectionKey>;
  setVisible: React.Dispatch<React.SetStateAction<Set<SectionKey>>>;
  isVisible: (k: SectionKey) => boolean;
  toggleSection: (k: SectionKey) => void;

  // Time range
  timeRange: TimeRange;
  setTimeRange: React.Dispatch<React.SetStateAction<TimeRange>>;
  handleTimeRange: (d: TimeRange) => void;

  // Configure panel toggle
  configOpen: boolean;
  setConfigOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Imperative fetch
  fetchSnapshot: (days?: TimeRange) => Promise<void>;

  // Context passthrough
  router: ReturnType<typeof useRouter>;
  selectedCompanyId: string | null | undefined;
  userRole: string | null | undefined;
};

export function useMarketingIntel(): MarketingIntelData {
  const router = useRouter();
  const { selectedCompanyId, userRole, isLoading: isContextLoading } = useCompanyContext();

  const [snapshot, setSnapshot]     = useState<Snapshot | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [visible, setVisible]       = useState<Set<SectionKey>>(new Set(ALL_SECTION_KEYS));
  const [timeRange, setTimeRange]   = useState<TimeRange>(30);

  // Hydrate persisted preferences
  useEffect(() => {
    setVisible(loadVisibility());
    setTimeRange(loadTimeRange());
  }, []);

  // Auth guard
  useEffect(() => {
    if (isContextLoading) return;
    const allowed = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'];
    if (userRole && !allowed.some((r) => userRole.toUpperCase().includes(r))) {
      router.replace('/dashboard');
    }
  }, [userRole, isContextLoading, router]);

  // Fetch
  const fetchSnapshot = useCallback(async (days: TimeRange = timeRange) => {
    if (!selectedCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchMarketingIntel(selectedCompanyId, days));
    } catch {
      setError('Could not load intelligence data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, timeRange]);

  useEffect(() => { fetchSnapshot(); }, [fetchSnapshot]);

  function handleTimeRange(d: TimeRange) {
    setTimeRange(d);
    localStorage.setItem(TIME_RANGE_KEY, String(d));
    fetchSnapshot(d);
  }

  function toggleSection(key: SectionKey) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveVisibility(next);
      return next;
    });
  }

  const isVisible = (k: SectionKey) => visible.has(k);

  const _ef1 = isContextLoading || (loading && !snapshot);
  const _ef2 = error;

  return {
    snapshot,
    setSnapshot,
    loading,
    setLoading,
    isLoading: isContextLoading,
    error,
    setError,
    _ef1,
    _ef2,
    visible,
    setVisible,
    isVisible,
    toggleSection,
    timeRange,
    setTimeRange,
    handleTimeRange,
    configOpen,
    setConfigOpen,
    fetchSnapshot,
    router,
    selectedCompanyId,
    userRole,
  };
}
