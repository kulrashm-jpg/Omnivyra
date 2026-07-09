/** useExecutiveMarketPulseController — prelude + state/handlers, verbatim. */
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  History,
  Eye,
  Flag,
  GitBranch,
  MessageSquare,
  Radio,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  UserCheck,
} from 'lucide-react';

type ViewType = 'executive' | 'operational' | 'workforce' | 'compliance' | 'funding';

type DigestItem = {
  id: string;
  digest_type?: string;
  item_type?: string;
  source_pressure_id?: string | null;
  source_impact_id?: string | null;
  source_consequence_id?: string | null;
  source_narrative_id?: string | null;
  summary?: string;
  why_this_matters?: string;
  affected_areas?: string[];
  severity?: number;
  confidence?: number;
  evolution_status?: string;
  supporting_evidence?: Record<string, unknown>;
  drilldown_payload?: Record<string, unknown>;
  priority_rank?: number;
  lifecycle_state?: string;
};

type WatchlistItem = {
  id?: string;
  watchlist_type: string;
  watchlist_value: string;
  priority_level?: string;
  muted?: boolean;
};

type CollaborationContext = {
  investigationThreads?: any[];
  investigationComments?: any[];
  acknowledgments?: any[];
  decisionMemory?: any[];
  annotations?: any[];
  intelligenceActionLinks?: any[];
  auditEvents?: any[];
  assignmentHistory?: any[];
  governance?: {
    staleThreadIds?: string[];
    activeThreadCount?: number;
  };
};

type AssignablePerson = {
  id: string;
  label: string;
  display_name?: string;
  email?: string;
  initials?: string;
  role?: string;
  department?: string;
  leadership?: boolean;
  active_investigation_count?: number;
  accountability_label?: string;
  assignment_eligible?: boolean;
};

type ProductionHardening = {
  comparativeIntelligence?: any[];
  opportunityIntelligence?: any[];
  benchmarkingReadiness?: any;
  benchmarkingCohorts?: any[];
  executiveOptimization?: {
    unresolvedCriticalInvestigations?: any[];
    heldEscalations?: any[];
    lowConfidenceNoise?: any[];
    groupedThemes?: any[];
    refinedDigest?: any;
    degradedContext?: any;
    governanceSafety?: any;
    attentionManagement?: any;
  };
  historicalTimeline?: any[];
  validationEvents?: any[];
  operationalHealth?: any;
  resilience?: any;
  pagination?: any;
};

type MarketPulseContextPayload = {
  executiveExperience?: {
    overview?: any;
    digestItems?: DigestItem[];
    lifecycle?: any[];
    escalations?: any[];
    workflowHooks?: any[];
    watchlists?: WatchlistItem[];
  } | null;
  collaborationContext?: CollaborationContext | null;
  productionHardening?: ProductionHardening | null;
};

type Props = {
  companyId: string;
  fetchWithAuth: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  routeMode?: boolean;
  externalSection?: string;
};

export const VIEWS: Array<{ id: ViewType; label: string }> = [
  { id: 'executive', label: 'Executive' },
  { id: 'operational', label: 'Operations' },
  { id: 'workforce', label: 'Workforce' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'funding', label: 'Funding' },
];

export const WATCHLIST_TYPES = [
  'competitor',
  'region',
  'technology',
  'regulation',
  'industry',
  'macro_theme',
  'workforce_trend',
  'funding_activity',
];

export const LIFECYCLE_STEPS = ['new', 'monitored', 'escalating', 'stabilized', 'resolved', 'muted'];

export function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function score(value: unknown): number {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

export function label(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Unknown';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function evidenceCount(item: DigestItem): number {
  const evidence = item.supporting_evidence ?? {};
  return Object.values(evidence).reduce<number>((sum, value) => sum + asArray(value).length, 0);
}

function entityRef(item: DigestItem) {
  if (item.item_type === 'pressure') return { entityType: 'pressure', entityId: item.source_pressure_id ?? item.id };
  if (item.item_type === 'impact') return { entityType: 'impact', entityId: item.source_impact_id ?? item.id };
  if (item.item_type === 'consequence') return { entityType: 'consequence', entityId: item.source_consequence_id ?? item.id };
  if (item.item_type === 'narrative') return { entityType: 'narrative', entityId: item.source_narrative_id ?? item.id };
  return { entityType: 'digest_item', entityId: item.id };
}

function severityTone(value: number): string {
  if (value >= 75) return 'border-red-200 bg-red-50 text-red-800';
  if (value >= 55) return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

function lifecycleTone(value?: string): string {
  if (value === 'escalating') return 'bg-red-100 text-red-700';
  if (value === 'stabilized' || value === 'resolved') return 'bg-emerald-100 text-emerald-700';
  if (value === 'muted') return 'bg-gray-200 text-gray-700';
  return 'bg-blue-100 text-blue-700';
}

export function DigestCard({
  item,
  active,
  onSelect,
}: {
  item: DigestItem;
  active: boolean;
  onSelect: () => void;
}) {
  const severity = score(item.severity);
  const confidence = score(item.confidence);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-4 text-left transition ${
        active ? 'border-gray-900 bg-white shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-1 text-xs font-medium ${lifecycleTone(item.lifecycle_state)}`}>
          {label(item.lifecycle_state)}
        </span>
        <span className={`rounded border px-2 py-1 text-xs font-medium ${severityTone(severity)}`}>
          Severity {severity}
        </span>
        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
          Confidence {confidence}
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold leading-6 text-gray-950">{item.summary || 'MarketPulse digest item'}</p>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-600">
        {item.why_this_matters || 'No executive framing available yet.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
        {(item.affected_areas ?? []).slice(0, 4).map((area) => (
          <span key={area} className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
            {label(area)}
          </span>
        ))}
        <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
          {evidenceCount(item)} evidence
        </span>
      </div>
    </button>
  );
}

export function LifecycleRail({ state }: { state?: string }) {
  const activeIndex = Math.max(0, LIFECYCLE_STEPS.indexOf(String(state ?? 'new')));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {LIFECYCLE_STEPS.map((step, index) => (
        <div
          key={step}
          className={`rounded-lg border px-3 py-2 text-xs font-medium ${
            index <= activeIndex ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-gray-50 text-gray-500'
          }`}
        >
          {label(step)}
        </div>
      ))}
    </div>
  );
}

export function MetricBar({ labelText, value }: { labelText: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>{labelText}</span>
        <span>{value}/100</span>
      </div>
      <div className="mt-1 h-2 rounded bg-gray-100">
        <div className="h-2 rounded bg-gray-900" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-100 ${className}`} />;
}

export function TooltipText({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500">?</span>
      <span className="pointer-events-none absolute right-0 top-6 z-10 hidden w-56 rounded-lg border border-gray-200 bg-white p-2 text-xs leading-5 text-gray-600 shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}

export function PersonPill({ person, fallback = 'Unassigned' }: { person?: AssignablePerson | null; fallback?: string }) {
  if (!person) {
    return <span className="rounded bg-white px-2 py-1 text-xs font-medium text-gray-500">{fallback}</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-semibold text-white">
        {person.initials || label(person.label).slice(0, 2)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-gray-900">{person.display_name || person.label}</span>
        <span className="block truncate text-gray-500">
          {label(person.department)}{person.leadership ? ' / Leadership' : ''}
        </span>
      </span>
    </span>
  );
}

export function useExecutiveMarketPulseController(props: Props) {
  const { companyId, fetchWithAuth, routeMode, externalSection } = props;
  const [activeView, setActiveView] = useState<ViewType>('executive');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [lifecycleFilter, setLifecycleFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [intentFilter, setIntentFilter] = useState('all');
  const [payload, setPayload] = useState<MarketPulseContextPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [people, setPeople] = useState<AssignablePerson[]>([]);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    drilldown: true,
    investigation: true,
    watchlist: false,
    memory: true,
  });
  const [watchlistForm, setWatchlistForm] = useState({ type: 'technology', value: '', priority: 'normal', muted: false });
  const [threadForm, setThreadForm] = useState({ title: '', priority: 'normal', assignedTo: '', assignedDepartment: '', assignmentNote: '' });
  const [comment, setComment] = useState('');
  const [decision, setDecision] = useState('');
  const [annotation, setAnnotation] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadContext = async (view: ViewType = activeView) => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetchWithAuth(`/api/market-pulse/context?companyId=${encodeURIComponent(companyId)}&viewType=${encodeURIComponent(view)}&limit=${routeMode ? 80 : 40}`);
      if (!response.ok) throw new Error('Failed to load MarketPulse context');
      const data = await response.json() as MarketPulseContextPayload;
      setPayload(data);
      const firstItem = data.executiveExperience?.digestItems?.[0];
      setSelectedId((current) => current ?? firstItem?.id ?? null);
    } catch (error) {
      console.error('[MarketPulse executive] load failed:', error);
      setPayload(null);
      setLoadError(error instanceof Error ? error.message : 'Failed to load MarketPulse context');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!companyId) return;
    void loadContext(activeView);
  }, [companyId, activeView]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const loadPeople = async () => {
      try {
        const response = await fetchWithAuth(`/api/market-pulse/people?companyId=${encodeURIComponent(companyId)}&search=${encodeURIComponent(peopleSearch)}`);
        if (!response.ok) throw new Error('Failed to load assignable people');
        const data = await response.json() as { people?: AssignablePerson[] };
        if (!cancelled) setPeople(data.people ?? []);
      } catch (error) {
        console.error('[MarketPulse executive] people load failed:', error);
        if (!cancelled) setPeople([]);
      }
    };
    void loadPeople();
    return () => {
      cancelled = true;
    };
  }, [companyId, peopleSearch]);

  const digestItems = useMemo(() => {
    const items = payload?.executiveExperience?.digestItems ?? [];
    return items
      .filter((item) => item.digest_type === activeView)
      .filter((item) => {
        const severity = score(item.severity);
        if (severityFilter === 'critical' && severity < 75) return false;
        if (severityFilter === 'elevated' && (severity < 55 || severity >= 75)) return false;
        if (severityFilter === 'low' && severity >= 55) return false;
        if (lifecycleFilter !== 'all' && item.lifecycle_state !== lifecycleFilter) return false;
        if (departmentFilter !== 'all' && !(item.affected_areas ?? []).some((area) => String(area).includes(departmentFilter))) return false;
        if (intentFilter === 'strategic' && !/(strategic|funding|revenue|expansion|market|customer)/i.test(`${item.summary} ${(item.affected_areas ?? []).join(' ')}`)) return false;
        if (intentFilter === 'operational' && !/(operation|delivery|workforce|compliance|technology|supply)/i.test(`${item.summary} ${(item.affected_areas ?? []).join(' ')}`)) return false;
        return true;
      })
      .sort((a, b) => score(b.priority_rank) - score(a.priority_rank));
  }, [payload, activeView, severityFilter, lifecycleFilter, departmentFilter, intentFilter]);

  const selectedItem = useMemo(() => {
    return digestItems.find((item) => item.id === selectedId) ?? digestItems[0] ?? null;
  }, [digestItems, selectedId]);

  const selectedRef = selectedItem ? entityRef(selectedItem) : null;
  const collaboration = payload?.collaborationContext ?? {};
  const selectedThreads = (collaboration.investigationThreads ?? []).filter(
    (thread) => selectedRef && thread.entity_type === selectedRef.entityType && thread.entity_id === selectedRef.entityId
  );
  const selectedDecisions = (collaboration.decisionMemory ?? []).filter(
    (row) => selectedRef && row.entity_type === selectedRef.entityType && row.entity_id === selectedRef.entityId
  );
  const selectedAnnotations = (collaboration.annotations ?? []).filter(
    (row) => selectedRef && row.entity_type === selectedRef.entityType && row.entity_id === selectedRef.entityId
  );
  const selectedComments = (collaboration.investigationComments ?? []).filter((row) =>
    selectedThreads.some((thread) => thread.id === row.thread_id)
  );
  const selectedAssignmentHistory = (collaboration.assignmentHistory ?? []).filter((row) =>
    selectedThreads.some((thread) => thread.id === row.thread_id)
  );
  const escalationEvents = payload?.executiveExperience?.escalations ?? [];
  const heldEscalations = escalationEvents.filter((event) => event.escalation_state === 'held').length;
  const groupedThemes = payload?.productionHardening?.executiveOptimization?.groupedThemes ?? [];
  const opportunities = payload?.productionHardening?.opportunityIntelligence ?? [];
  const comparative = payload?.productionHardening?.comparativeIntelligence?.[0] ?? null;
  const benchmarkingReadiness = payload?.productionHardening?.benchmarkingReadiness;
  const benchmarkingCohorts = payload?.productionHardening?.benchmarkingCohorts ?? [];
  const unresolvedCritical = payload?.productionHardening?.executiveOptimization?.unresolvedCriticalInvestigations ?? [];
  const refinedDigest = payload?.productionHardening?.executiveOptimization?.refinedDigest ?? {};
  const historicalTimeline = payload?.productionHardening?.historicalTimeline ?? [];
  const degradedContext = payload?.productionHardening?.executiveOptimization?.degradedContext;
  const governanceSafety = payload?.productionHardening?.executiveOptimization?.governanceSafety;
  const attentionManagement = payload?.productionHardening?.executiveOptimization?.attentionManagement;
  const operationalHealth = payload?.productionHardening?.operationalHealth;
  const resilience = payload?.productionHardening?.resilience;
  const personById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

  const overview = payload?.executiveExperience?.overview;
  const overviewPayload = overview?.overview_payload ?? {};
  const criticalCount = asArray(overview?.top_strategic_pressures).length + asArray(overview?.critical_narratives).length;
  const worseningCount = asArray(overview?.worsening_conditions).length;
  const stabilizingCount = asArray(overview?.stabilizing_conditions).length;

  const postCollaboration = async (body: Record<string, unknown>) => {
    setBusyAction(String(body.action ?? 'action'));
    try {
      const response = await fetchWithAuth('/api/market-pulse/collaboration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, ...body }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Collaboration action failed');
      }
      await loadContext();
    } catch (error) {
      console.error('[MarketPulse executive] collaboration action failed:', error);
    } finally {
      setBusyAction(null);
    }
  };

  const saveWatchlist = async () => {
    if (!watchlistForm.value.trim()) return;
    setBusyAction('watchlist');
    try {
      const response = await fetchWithAuth('/api/market-pulse/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          watchlistType: watchlistForm.type,
          watchlistValue: watchlistForm.value.trim(),
          priorityLevel: watchlistForm.priority,
          muted: watchlistForm.muted,
        }),
      });
      if (!response.ok) throw new Error('Failed to save watchlist item');
      setWatchlistForm((current) => ({ ...current, value: '' }));
      await loadContext();
    } catch (error) {
      console.error('[MarketPulse executive] watchlist save failed:', error);
    } finally {
      setBusyAction(null);
    }
  };

  const createInvestigation = async () => {
    if (!selectedRef || !selectedItem) return;
    await postCollaboration({
      action: 'create_thread',
      entityType: selectedRef.entityType,
      entityId: selectedRef.entityId,
      title: threadForm.title.trim() || selectedItem.summary || 'MarketPulse investigation',
      priority: threadForm.priority,
      assignedTo: threadForm.assignedTo.trim() || null,
      assignedDepartment: threadForm.assignedDepartment.trim() || null,
      assignmentNote: threadForm.assignmentNote.trim() || null,
    });
    setThreadForm({ title: '', priority: 'normal', assignedTo: '', assignedDepartment: '', assignmentNote: '' });
  };

  const updateThreadStatus = async (threadId: string, investigationStatus: string) => {
    await postCollaboration({
      action: 'update_thread',
      threadId,
      investigationStatus,
    });
  };

  const acknowledgeSelected = async (acknowledgmentType: string) => {
    if (!selectedRef) return;
    await postCollaboration({
      action: 'acknowledge',
      entityType: selectedRef.entityType,
      entityId: selectedRef.entityId,
      acknowledgmentType,
    });
  };

  const addComment = async () => {
    if (!selectedThreads[0] || !comment.trim()) return;
    await postCollaboration({
      action: 'comment',
      threadId: selectedThreads[0].id,
      comment: comment.trim(),
      evidencePayload: {
        digest_item_id: selectedItem?.id,
        selected_entity: selectedRef,
      },
    });
    setComment('');
  };

  const saveDecision = async () => {
    if (!selectedRef || !decision.trim()) return;
    await postCollaboration({
      action: 'decision_memory',
      entityType: selectedRef.entityType,
      entityId: selectedRef.entityId,
      decisionSummary: decision.trim(),
      outcomeStatus: 'proposed',
      contextSnapshot: {
        summary: selectedItem?.summary,
        severity: selectedItem?.severity,
        confidence: selectedItem?.confidence,
        drilldown: selectedItem?.drilldown_payload,
      },
    });
    setDecision('');
  };

  const saveAnnotation = async () => {
    if (!selectedRef || !annotation.trim()) return;
    await postCollaboration({
      action: 'annotate',
      entityType: selectedRef.entityType,
      entityId: selectedRef.entityId,
      annotationType: 'strategic_note',
      visibility: 'leadership',
      content: annotation.trim(),
    });
    setAnnotation('');
  };

  const SectionToggle = ({ id, title, icon: Icon }: { id: string; title: string; icon: any }) => (
    <button
      type="button"
      onClick={() => setExpandedSections((current) => ({ ...current, [id]: !current[id] }))}
      className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left"
    >
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-950">
        <Icon className="h-4 w-4 text-gray-500" />
        {title}
      </span>
      {expandedSections[id] ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
    </button>
  );

  return {
    companyId, fetchWithAuth, routeMode, externalSection,
    SectionToggle, acknowledgeSelected, activeView, addComment, annotation, attentionManagement, benchmarkingCohorts,
    benchmarkingReadiness, busyAction, collaboration, comment, comparative, createInvestigation, criticalCount, decision,
    degradedContext, departmentFilter, digestItems, escalationEvents, expandedSections, governanceSafety, groupedThemes,
    heldEscalations, historicalTimeline, intentFilter, lifecycleFilter, loadContext, loadError, loading, operationalHealth,
    opportunities, overview, overviewPayload, payload, people, peopleSearch, personById, postCollaboration, refinedDigest,
    resilience, saveAnnotation, saveDecision, saveWatchlist, selectedAnnotations, selectedAssignmentHistory, selectedComments,
    selectedDecisions, selectedId, selectedItem, selectedRef, selectedThreads, setActiveView, setAnnotation, setBusyAction,
    setComment, setDecision, setDepartmentFilter, setExpandedSections, setIntentFilter, setLifecycleFilter, setLoadError, setLoading,
    setPayload, setPeople, setPeopleSearch, setSelectedId, setSeverityFilter, setThreadForm, setWatchlistForm, severityFilter,
    stabilizingCount, threadForm, unresolvedCritical, updateThreadStatus, watchlistForm, worseningCount
  };
}
