import React from 'react';
import { BarChart2, Building2, Settings, Zap } from 'lucide-react';
import type { Tab } from './types';

export const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'global',    label: 'Global Config',       icon: <Settings   className="h-4 w-4" /> },
  { id: 'overrides', label: 'Company Overrides',   icon: <Building2  className="h-4 w-4" /> },
  { id: 'boost',     label: 'Account Boost',       icon: <Zap        className="h-4 w-4" /> },
  { id: 'insights',  label: 'Execution Insights',  icon: <BarChart2  className="h-4 w-4" /> },
];

export const SKIP_REASON_LABELS: Record<string, string> = {
  disabled:           'Disabled',
  budget_exceeded:    'Budget Exceeded',
  deferred:           'Deferred',
  job_type_not_found: 'Config Missing',
  unknown:            'Unknown',
};
