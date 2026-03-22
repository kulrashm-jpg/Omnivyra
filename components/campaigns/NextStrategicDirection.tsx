'use client';

/**
 * NextStrategicDirection
 *
 * Renders the full continuity engine output for a campaign:
 *   A. Data confidence + Decision confidence (separate signals)
 *   B. Counterfactual insight (only on underperformed)
 *   C. Effort vs Impact signal
 *   + Campaign journey timeline
 *   + Multi-campaign pattern memory (collapsed)
 *   + Momentum indicator
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp, TrendingDown, Target, RefreshCw, ArrowRight,
  BookOpen, Loader2, AlertCircle, ChevronDown, ChevronUp,
  Brain, CheckCircle2, Lightbulb, Zap, Activity,
  Sparkles, BarChart2, Minus,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConfidenceRating {
  level: 'high' | 'medium' | 'low';
  reason: string;
}

interface DecisionConfidence {
  level: 'high' | 'medium' | 'low';
  reason: string;
}

interface EvalResult {
  status: 'exceeded' | 'met' | 'underperformed';
  score: number;
  summary: string;
  confidence?: ConfidenceRating;
}

interface StabilitySignal {
  signal: 'stable' | 'sensitive' | 'volatile';
  message: string;
}

interface TradeOff {
  gained: string;
  sacrificed: string;
  summary: string;
}

interface AlternativePath {
  next_topic: string;
  suggested_goal_type: string;
  rationale: string;
}

interface Decision {
  action: 'continue' | 'optimize' | 'pivot';
  next_topic: string;
  reason: string;
  strategic_rationale: string;
  topic_strategy: 'deepen' | 'refine' | 'adjacent';
  suggested_goal_type: string;
  decision_confidence?: DecisionConfidence;
  stability?: StabilitySignal;
  trade_off?: TradeOff | null;
  alternative_path?: AlternativePath | null;
  counterfactual?: string | null;
}

interface SuggestedBlog {
  id: string;
  title: string;
  slug: string;
}

interface PatternSignal {
  type: 'topic_strength' | 'goal_affinity' | 'volatility' | 'momentum';
  pattern: string;
  recommendation: string;
  evidence_count: number;
  confidence: 'high' | 'medium' | 'low';
}

interface PatternMemory {
  patterns: PatternSignal[];
  dominant_topic_cluster: string | null;
  best_performing_goal: string | null;
  campaigns_analyzed: number;
  portfolio_avg_score: number;
}

interface JourneyStep {
  campaign_id: string;
  campaign_name: string;
  topic: string | null;
  goal_type: string | null;
  status: 'exceeded' | 'met' | 'underperformed' | null;
  score: number | null;
  stage: 'completed' | 'current' | 'suggested';
}

interface EffortSignal {
  effort_level: 'high' | 'medium' | 'low' | null;
  outcome_level: 'high' | 'medium' | 'low';
  signal: string | null;
  label: string;
  description: string;
}

interface ContinuityData {
  has_data: boolean;
  previous_result: EvalResult | null;
  decision: Decision | null;
  effort_signal?: EffortSignal | null;
  pattern_memory: PatternMemory;
  timeline: JourneyStep[];
  current_topic: string | null;
  suggested_blog: SuggestedBlog | null;
}

interface Props {
  campaignId: string;
  campaignName?: string;
  className?: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  exceeded: {
    label:  'Exceeded',
    icon:   TrendingUp,
    bar:    'bg-emerald-500',
    badge:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    ring:   'border-emerald-200',
    dot:    'bg-emerald-500',
  },
  met: {
    label:  'Met Goals',
    icon:   Target,
    bar:    'bg-blue-500',
    badge:  'bg-blue-50 text-blue-700 border-blue-200',
    ring:   'border-blue-200',
    dot:    'bg-blue-500',
  },
  underperformed: {
    label:  'Underperformed',
    icon:   AlertCircle,
    bar:    'bg-amber-500',
    badge:  'bg-amber-50 text-amber-700 border-amber-200',
    ring:   'border-amber-200',
    dot:    'bg-amber-500',
  },
};

const ACTION_CONFIG = {
  continue: { label: 'Continue & Expand', icon: TrendingUp,  colour: 'text-emerald-600', bg: 'bg-emerald-50' },
  optimize: { label: 'Optimise',          icon: RefreshCw,   colour: 'text-blue-600',    bg: 'bg-blue-50'    },
  pivot:    { label: 'Pivot Direction',   icon: ArrowRight,  colour: 'text-amber-600',   bg: 'bg-amber-50'   },
};

const STRATEGY_LABEL: Record<string, string> = {
  deepen: 'Go deeper', refine: 'Refine angle', adjacent: 'Adjacent topic',
};

const CONFIDENCE_CHIP = {
  high:   { colour: 'text-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-400' },
  medium: { colour: 'text-blue-600',    bg: 'bg-blue-50',    dot: 'bg-blue-400'    },
  low:    { colour: 'text-amber-600',   bg: 'bg-amber-50',   dot: 'bg-amber-400'   },
};

const EFFORT_SIGNAL_CONFIG: Record<string, { icon: React.FC<any>; colour: string; bg: string }> = {
  leverage:          { icon: Zap,         colour: 'text-emerald-600', bg: 'bg-emerald-50' },
  high_performance:  { icon: TrendingUp,  colour: 'text-emerald-700', bg: 'bg-emerald-50' },
  strong_return:     { icon: TrendingUp,  colour: 'text-blue-600',    bg: 'bg-blue-50'    },
  efficient_baseline:{ icon: Activity,    colour: 'text-blue-500',    bg: 'bg-blue-50'    },
  baseline:          { icon: Minus,       colour: 'text-gray-500',    bg: 'bg-gray-50'    },
  moderate_return:   { icon: BarChart2,   colour: 'text-amber-500',   bg: 'bg-amber-50'   },
  underpowered:      { icon: AlertCircle, colour: 'text-amber-600',   bg: 'bg-amber-50'   },
  inefficiency:      { icon: TrendingDown,colour: 'text-red-600',     bg: 'bg-red-50'     },
};

const PATTERN_TYPE_LABEL: Record<string, string> = {
  topic_strength: 'Topic strength',
  goal_affinity:  'Goal affinity',
  volatility:     'Volatility detected',
  momentum:       'Momentum',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

/** A confidence row: data confidence + decision confidence side-by-side */
function ConfidenceRow({
  dataConf,
  decConf,
}: {
  dataConf: ConfidenceRating;
  decConf: DecisionConfidence;
}) {
  const [open, setOpen] = useState(false);
  const dc = CONFIDENCE_CHIP[dataConf.level];
  const rc = CONFIDENCE_CHIP[decConf.level];

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 text-[10px] text-gray-400 hover:text-gray-600 transition-colors group"
      >
        <Sparkles className="h-3 w-3" />
        <span className={`font-semibold ${dc.colour}`}>Data: {dataConf.level}</span>
        <span className="text-gray-300">·</span>
        <span className={`font-semibold ${rc.colour}`}>Decision: {decConf.level}</span>
        {open ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-[11px] text-gray-500 leading-relaxed space-y-1.5">
          <div className="flex gap-1.5">
            <span className={`shrink-0 mt-0.5 h-2 w-2 rounded-full ${dc.dot}`} />
            <span><span className="font-semibold text-gray-700">Data confidence ({dataConf.level}):</span> {dataConf.reason}</span>
          </div>
          <div className="flex gap-1.5">
            <span className={`shrink-0 mt-0.5 h-2 w-2 rounded-full ${rc.dot}`} />
            <span><span className="font-semibold text-gray-700">Decision confidence ({decConf.level}):</span> {decConf.reason}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Decision stability badge */
function StabilityBadge({ stability }: { stability: StabilitySignal }) {
  const [open, setOpen] = useState(false);
  const cfg = {
    stable:    { colour: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100', dot: 'bg-emerald-400', label: 'Stable decision' },
    sensitive: { colour: 'text-blue-600',    bg: 'bg-blue-50 border-blue-100',       dot: 'bg-blue-400',    label: 'Monitor closely'   },
    volatile:  { colour: 'text-amber-600',   bg: 'bg-amber-50 border-amber-100',     dot: 'bg-amber-400',   label: 'Volatile signal'   },
  }[stability.signal];

  return (
    <div className={`mt-3 rounded-xl border px-3 py-2 ${cfg.bg}`}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-2"
      >
        <span className={`h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
        <span className={`flex-1 text-left text-[11px] font-semibold ${cfg.colour}`}>{cfg.label}</span>
        {open ? <ChevronUp className={`h-3 w-3 ${cfg.colour}`} /> : <ChevronDown className={`h-3 w-3 ${cfg.colour}`} />}
      </button>
      {open && (
        <p className={`mt-1.5 border-t pt-1.5 text-[11px] leading-relaxed ${cfg.colour} border-current/10`}>
          {stability.message}
        </p>
      )}
    </div>
  );
}

/** Strategic trade-off: what was gained vs sacrificed */
function TradeOffRow({ tradeOff }: { tradeOff: TradeOff }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-2 px-4 py-3"
      >
        <BarChart2 className="h-4 w-4 text-indigo-500 shrink-0" />
        <div className="flex-1 text-left">
          <span className="text-xs font-semibold text-indigo-700">Strategic trade-off</span>
          <div className="mt-0.5 flex items-center gap-2 text-[10px]">
            <span className="text-emerald-600 font-medium">↑ {tradeOff.gained}</span>
            <span className="text-gray-300">·</span>
            <span className="text-amber-600 font-medium">↓ {tradeOff.sacrificed}</span>
          </div>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-indigo-400" /> : <ChevronDown className="h-3.5 w-3.5 text-indigo-400" />}
      </button>
      {open && (
        <p className="border-t border-indigo-100 px-4 pb-4 pt-3 text-[11px] text-indigo-800 leading-relaxed">
          {tradeOff.summary}
        </p>
      )}
    </div>
  );
}

/** Alternative strategic path */
function AlternativePathCard({
  alt,
  currentGoal,
}: {
  alt: AlternativePath;
  currentGoal: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-2 px-4 py-3"
      >
        <ArrowRight className="h-4 w-4 text-gray-400 shrink-0" />
        <div className="flex-1 text-left min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">
            Alternative path
          </p>
          <p className="text-xs font-semibold text-gray-700 truncate">"{alt.next_topic}"</p>
        </div>
        {alt.suggested_goal_type !== currentGoal && (
          <span className="shrink-0 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-500">
            {alt.suggested_goal_type}
          </span>
        )}
        {open ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
      </button>
      {open && (
        <p className="border-t border-gray-200 px-4 pb-4 pt-3 text-[11px] text-gray-600 leading-relaxed">
          {alt.rationale}
        </p>
      )}
    </div>
  );
}

/** Only shown when status === underperformed */
function CounterfactualInsight({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-xl border border-orange-100 bg-orange-50/60">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-2 px-4 py-3"
      >
        <Lightbulb className="h-4 w-4 text-orange-500 shrink-0" />
        <span className="flex-1 text-left text-xs font-semibold text-orange-700">
          What would have worked better
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-orange-400" /> : <ChevronDown className="h-3.5 w-3.5 text-orange-400" />}
      </button>
      {open && (
        <p className="border-t border-orange-100 px-4 pb-4 pt-3 text-xs text-orange-800 leading-relaxed">
          {text}
        </p>
      )}
    </div>
  );
}

/** Effort vs Impact signal */
function EffortImpactRow({ signal }: { signal: EffortSignal }) {
  const cfg = signal.signal ? EFFORT_SIGNAL_CONFIG[signal.signal] ?? EFFORT_SIGNAL_CONFIG.baseline : EFFORT_SIGNAL_CONFIG.baseline;
  const Icon = cfg.icon;
  const [open, setOpen] = useState(false);

  return (
    <div className={`mt-4 rounded-xl border px-4 py-3 ${signal.signal === 'inefficiency' ? 'border-red-100 bg-red-50/50' : signal.signal === 'leverage' || signal.signal === 'high_performance' ? 'border-emerald-100 bg-emerald-50/50' : 'border-gray-100 bg-gray-50'}`}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-2"
      >
        <Icon className={`h-4 w-4 shrink-0 ${cfg.colour}`} />
        <span className={`flex-1 text-left text-xs font-semibold ${cfg.colour}`}>{signal.label}</span>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          {signal.effort_level && (
            <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">
              {signal.effort_level} effort
            </span>
          )}
          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">
            {signal.outcome_level} outcome
          </span>
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>
      {open && (
        <p className="mt-2 border-t border-gray-100 pt-2 text-[11px] text-gray-600 leading-relaxed">
          {signal.description}
        </p>
      )}
    </div>
  );
}

/** Campaign journey timeline */
function CampaignTimeline({ steps }: { steps: JourneyStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="mt-4 mx-5 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
        Campaign Journey
      </p>
      <ol className="flex flex-col gap-0">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          const statusCfg = step.status ? STATUS_CONFIG[step.status] : null;

          return (
            <li key={step.campaign_id + idx} className="relative flex gap-3">
              {!isLast && (
                <div className="absolute left-[9px] top-5 h-full w-px bg-gray-200" />
              )}
              <div className="relative z-10 shrink-0 mt-1">
                {step.stage === 'suggested' ? (
                  <div className="h-[18px] w-[18px] rounded-full border-2 border-dashed border-gray-300 bg-white flex items-center justify-center">
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                  </div>
                ) : step.stage === 'current' ? (
                  <div className="h-[18px] w-[18px] rounded-full border-2 border-[#0A66C2] bg-[#0A66C2] flex items-center justify-center">
                    <div className="h-2 w-2 rounded-full bg-white" />
                  </div>
                ) : statusCfg ? (
                  <div className={`h-[18px] w-[18px] rounded-full ${statusCfg.dot} flex items-center justify-center`}>
                    <CheckCircle2 className="h-3 w-3 text-white" />
                  </div>
                ) : (
                  <div className="h-[18px] w-[18px] rounded-full border-2 border-gray-200 bg-white" />
                )}
              </div>
              <div className={`pb-4 flex-1 min-w-0 ${isLast ? 'pb-0' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold leading-tight ${
                    step.stage === 'current'   ? 'text-[#0A66C2]' :
                    step.stage === 'suggested' ? 'text-gray-400 italic' : 'text-gray-700'
                  }`}>
                    {step.campaign_name}
                  </span>
                  {statusCfg && step.stage !== 'suggested' && (
                    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${statusCfg.badge}`}>
                      {statusCfg.label}
                    </span>
                  )}
                  {step.stage === 'current' && (
                    <span className="inline-flex items-center rounded-full border border-[#0A66C2]/20 bg-[#EBF4FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#0A66C2]">
                      Current
                    </span>
                  )}
                  {step.stage === 'suggested' && (
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
                      Next
                    </span>
                  )}
                </div>
                {(step.topic || step.goal_type) && (
                  <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                    {[step.topic, step.goal_type].filter(Boolean).join(' · ')}
                    {step.score != null ? ` · ${step.score}/100` : ''}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Momentum indicator extracted from pattern memory */
function MomentumIndicator({ patterns }: { patterns: PatternSignal[] }) {
  const momentum = patterns.find((p) => p.type === 'momentum');
  if (!momentum) return null;

  const isUp = momentum.pattern.includes('upward') || momentum.pattern.includes('trending up');
  const Icon = isUp ? TrendingUp : TrendingDown;
  const colour = isUp ? 'text-emerald-600' : 'text-amber-600';
  const bg = isUp ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100';

  return (
    <div className={`mx-5 mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 ${bg}`}>
      <Icon className={`h-4 w-4 shrink-0 ${colour}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] font-semibold ${colour}`}>{isUp ? 'Momentum building' : 'Momentum declining'}</p>
        <p className="text-[10px] text-gray-500 truncate">{momentum.pattern}</p>
      </div>
      <span className={`shrink-0 text-[10px] font-semibold ${colour}`}>{momentum.confidence}</span>
    </div>
  );
}

/** Pattern memory section — collapsed by default */
function PatternMemorySection({ memory }: { memory: PatternMemory }) {
  const [open, setOpen] = useState(false);
  const nonMomentum = memory.patterns.filter((p) => p.type !== 'momentum');
  if (memory.campaigns_analyzed === 0 || memory.patterns.length === 0) return null;

  return (
    <div className="mx-5 mt-4 rounded-xl border border-purple-100 bg-purple-50/40">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-500" />
          <span className="text-xs font-semibold text-purple-700">Portfolio Patterns</span>
          {nonMomentum.length > 0 && (
            <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600">
              {nonMomentum.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-purple-400">
            {memory.campaigns_analyzed} campaigns · avg {memory.portfolio_avg_score}/100
          </span>
          {open ? <ChevronUp className="h-3.5 w-3.5 text-purple-400" /> : <ChevronDown className="h-3.5 w-3.5 text-purple-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-purple-100 px-4 pb-4 pt-3 flex flex-col gap-3">
          {nonMomentum.map((p, i) => (
            <div key={i} className="rounded-lg bg-white border border-purple-100 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400">
                  {PATTERN_TYPE_LABEL[p.type] ?? p.type}
                </span>
                <span className={`ml-auto text-[10px] font-semibold ${
                  p.confidence === 'high' ? 'text-emerald-600' :
                  p.confidence === 'medium' ? 'text-blue-600' : 'text-amber-600'
                }`}>
                  {p.confidence} · {p.evidence_count} data pts
                </span>
              </div>
              <p className="text-xs text-gray-700 leading-relaxed">{p.pattern}</p>
              <p className="mt-1 text-[11px] text-gray-500 leading-relaxed">→ {p.recommendation}</p>
            </div>
          ))}

          {(memory.dominant_topic_cluster || memory.best_performing_goal) && (
            <div className="flex gap-2 flex-wrap">
              {memory.dominant_topic_cluster && (
                <div className="rounded-lg bg-white border border-purple-100 px-3 py-1.5 text-[11px] text-gray-600">
                  <span className="font-semibold text-purple-600">Top cluster:</span> {memory.dominant_topic_cluster}
                </div>
              )}
              {memory.best_performing_goal && (
                <div className="rounded-lg bg-white border border-purple-100 px-3 py-1.5 text-[11px] text-gray-600">
                  <span className="font-semibold text-purple-600">Best goal:</span> {memory.best_performing_goal}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NextStrategicDirection({ campaignId, campaignName, className = '' }: Props) {
  const [data, setData]         = useState<ContinuityData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/continuity`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: ContinuityData) => setData(d))
      .catch(() => setError('Could not load strategic direction.'))
      .finally(() => setLoading(false));
  }, [campaignId]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 py-6 text-sm text-gray-400 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading strategic direction…
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-600 ${className}`}>
        {error}
      </div>
    );
  }

  if (!data || !data.has_data || !data.decision || !data.previous_result) {
    return (
      <div className={`rounded-xl border border-gray-100 bg-gray-50 p-5 text-sm text-gray-500 ${className}`}>
        <p className="font-medium text-gray-700 mb-1">No performance data yet</p>
        <p>Record campaign metrics to get your next strategic direction.</p>
      </div>
    );
  }

  const { previous_result, decision, suggested_blog, current_topic, pattern_memory, timeline, effort_signal } = data;
  const statusCfg = STATUS_CONFIG[previous_result.status];
  const actionCfg = ACTION_CONFIG[decision.action];
  const StatusIcon = statusCfg.icon;
  const ActionIcon = actionCfg.icon;
  const scoreBarWidth = Math.min(100, Math.max(0, previous_result.score));

  return (
    <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${statusCfg.ring} ${className}`}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">
              Next Strategic Direction
            </p>
            {campaignName && (
              <p className="text-xs text-gray-500 truncate max-w-[260px]">{campaignName}</p>
            )}
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusCfg.badge}`}>
            <StatusIcon className="h-3 w-3" />
            {statusCfg.label}
          </span>
        </div>
      </div>

      {/* ── Score bar ─────────────────────────────────────────────────────── */}
      <div className="px-5 pt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500">Performance score</span>
          <span className="text-xs font-bold text-gray-800">{previous_result.score}/100</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-100">
          <div
            className={`h-1.5 rounded-full transition-all ${statusCfg.bar}`}
            style={{ width: `${scoreBarWidth}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">{previous_result.summary}</p>

        {/* ── Refinement A: Dual confidence row ─────────────────────────── */}
        {previous_result.confidence && decision.decision_confidence && (
          <ConfidenceRow
            dataConf={previous_result.confidence}
            decConf={decision.decision_confidence}
          />
        )}

        {/* ── Stability signal ──────────────────────────────────────────── */}
        {decision.stability && (
          <StabilityBadge stability={decision.stability} />
        )}
      </div>

      {/* ── Momentum indicator (from pattern memory) ───────────────────────── */}
      {pattern_memory?.patterns?.length > 0 && (
        <MomentumIndicator patterns={pattern_memory.patterns} />
      )}

      {/* ── Campaign journey timeline ─────────────────────────────────────── */}
      {timeline && timeline.length > 0 && (
        <CampaignTimeline steps={timeline} />
      )}

      <div className="my-4 mx-5 h-px bg-gray-100" />

      {/* ── Decision ──────────────────────────────────────────────────────── */}
      <div className="px-5 pb-4">
        <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold mb-3 ${actionCfg.bg} ${actionCfg.colour}`}>
          <ActionIcon className="h-3.5 w-3.5" />
          {actionCfg.label}
          {decision.topic_strategy && (
            <span className="ml-1 opacity-70">· {STRATEGY_LABEL[decision.topic_strategy]}</span>
          )}
        </div>

        <p className="text-sm font-medium text-gray-800 mb-1">{decision.reason}</p>

        {/* Next topic */}
        {decision.next_topic && decision.next_topic !== current_topic && (
          <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
              Suggested next topic
            </p>
            <p className="text-sm font-semibold text-gray-800">"{decision.next_topic}"</p>
          </div>
        )}

        {/* ── Refinement 3: Alternative path ────────────────────────────── */}
        {decision.alternative_path && (
          <AlternativePathCard
            alt={decision.alternative_path}
            currentGoal={decision.suggested_goal_type}
          />
        )}

        {/* ── Refinement 2: Strategic trade-off ─────────────────────────── */}
        {decision.trade_off && (
          <TradeOffRow tradeOff={decision.trade_off} />
        )}

        {/* Expanded strategic rationale */}
        {decision.strategic_rationale && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded((p) => !p)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Hide rationale' : 'Show rationale'}
            </button>
            {expanded && (
              <p className="mt-2 text-xs text-gray-500 leading-relaxed italic">
                {decision.strategic_rationale}
              </p>
            )}
          </div>
        )}

        {/* ── Refinement B: Counterfactual (underperformed only) ───────────── */}
        {decision.counterfactual && (
          <CounterfactualInsight text={decision.counterfactual} />
        )}

        {/* ── Refinement C: Effort vs Impact ──────────────────────────────── */}
        {effort_signal && (
          <EffortImpactRow signal={effort_signal} />
        )}

        {/* Suggested blog */}
        {suggested_blog && (
          <div className="mt-4 rounded-xl border border-[#0A66C2]/20 bg-[#F5F9FF] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A66C2] mb-1.5">
              Recommended reading
            </p>
            <Link href={`/blog/${suggested_blog.slug}`} className="flex items-start gap-2 group">
              <BookOpen className="h-4 w-4 text-[#0A66C2] mt-0.5 shrink-0" />
              <span className="text-sm font-medium text-[#0A66C2] group-hover:underline leading-snug">
                {suggested_blog.title}
              </span>
            </Link>
          </div>
        )}

        {/* CTA */}
        <div className="mt-4">
          <Link
            href={`/recommendations?initialTopic=${encodeURIComponent(decision.next_topic || '')}`}
            className="inline-flex items-center gap-2 rounded-full bg-[#0B1F33] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0A66C2] transition-colors"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Build next campaign
          </Link>
        </div>
      </div>

      {/* ── Portfolio pattern memory (collapsed) ──────────────────────────── */}
      {pattern_memory && <PatternMemorySection memory={pattern_memory} />}
      {pattern_memory && <div className="h-4" />}
    </div>
  );
}
