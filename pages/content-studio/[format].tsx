import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';

type ContentFormat = 'story' | 'whitepaper' | 'post';
type ContextMode = 'company' | 'focused' | 'none';

const FORMAT_META: Record<ContentFormat, {
  label: string;
  icon: string;
  description: string;
  recommendedLength: string;
  toneHint: string;
  defaultChannels: string[];
}> = {
  story: {
    label: 'Story',
    icon: '📖',
    description: 'Narrative-driven content to connect emotionally and improve engagement quality.',
    recommendedLength: '400-900 words',
    toneHint: 'Authentic, human, experiential',
    defaultChannels: ['LinkedIn', 'Instagram', 'Email'],
  },
  whitepaper: {
    label: 'Whitepaper',
    icon: '📄',
    description: 'Authority-led long-form piece to build trust, prove expertise, and support lead generation.',
    recommendedLength: '1500-3000 words',
    toneHint: 'Analytical, evidence-backed, strategic',
    defaultChannels: ['Website', 'Email', 'LinkedIn'],
  },
  post: {
    label: 'Post',
    icon: '📱',
    description: 'High-impact social post optimized for reach, engagement, and follower stickiness.',
    recommendedLength: '80-250 words',
    toneHint: 'Punchy, clear, platform-native',
    defaultChannels: ['LinkedIn', 'Twitter/X', 'Instagram', 'Facebook'],
  },
};

function parseFormat(value: string | string[] | undefined): ContentFormat {
  if (value === 'story' || value === 'whitepaper' || value === 'post') return value;
  return 'story';
}

function buildBrief(params: {
  format: ContentFormat;
  contextMode: ContextMode;
  companyName: string;
  companyContext: string;
  focusedObjective: string;
  audience: string;
  keyMessage: string;
  proofPoints: string;
  cta: string;
  brandVoice: string;
  engagementScore: number;
  authorityScore: number;
  stickinessScore: number;
  alignmentScore: number;
  channels: string;
  exclusions: string;
}): string {
  const meta = FORMAT_META[params.format];
  const contextBlock =
    params.contextMode === 'company'
      ? `Use company context: ${params.companyContext || 'Use known company profile, offerings, and positioning.'}`
      : params.contextMode === 'focused'
        ? `Use focused context objective: ${params.focusedObjective || 'Specific campaign objective will be provided.'}`
        : 'No external context. Create from first principles with broad relevance.';

  return [
    `CONTENT FORMAT: ${meta.label}`,
    `COMPANY: ${params.companyName || 'Current company'}`,
    `CONTEXT MODE: ${params.contextMode}`,
    contextBlock,
    '',
    'PRIMARY GOALS',
    `- Engagement target: ${params.engagementScore}/100`,
    `- Authority target: ${params.authorityScore}/100`,
    `- Stickiness target: ${params.stickinessScore}/100`,
    `- Brand alignment target: ${params.alignmentScore}/100`,
    '',
    'CORE INPUTS',
    `- Audience: ${params.audience || 'Define primary buyer/persona'}`,
    `- Key message: ${params.keyMessage || 'Define one clear message'}`,
    `- Proof points: ${params.proofPoints || 'Add evidence, examples, or data points'}`,
    `- Brand voice guidance: ${params.brandVoice || meta.toneHint}`,
    `- CTA: ${params.cta || 'Define one clear next action'}`,
    `- Target channels: ${params.channels || meta.defaultChannels.join(', ')}`,
    `- Exclusions / guardrails: ${params.exclusions || 'Avoid generic claims, off-brand tone, and unverifiable data.'}`,
    '',
    'QUALITY REQUIREMENTS',
    '- Strong opening hook in first 1-2 lines',
    '- Clear narrative flow with concrete examples',
    '- Distinctive point of view aligned with company positioning',
    '- Practical takeaway and clear CTA',
    '',
    `FORMAT GUIDANCE (${meta.label})`,
    `- Recommended length: ${meta.recommendedLength}`,
    `- Tone: ${meta.toneHint}`,
  ].join('\n');
}

export default function ContentStudioFormatPage() {
  const router = useRouter();
  const { user, authChecked, isLoading, selectedCompanyName, selectedCompanyId } = useCompanyContext();

  const format = parseFormat(router.query.format);
  const meta = FORMAT_META[format];

  const [contextMode, setContextMode] = useState<ContextMode>('company');
  const [companyContext, setCompanyContext] = useState('');
  const [focusedObjective, setFocusedObjective] = useState('');
  const [audience, setAudience] = useState('');
  const [keyMessage, setKeyMessage] = useState('');
  const [proofPoints, setProofPoints] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [cta, setCta] = useState('');
  const [channels, setChannels] = useState(meta.defaultChannels.join(', '));
  const [exclusions, setExclusions] = useState('');
  const [engagementScore, setEngagementScore] = useState(80);
  const [authorityScore, setAuthorityScore] = useState(75);
  const [stickinessScore, setStickinessScore] = useState(70);
  const [alignmentScore, setAlignmentScore] = useState(85);
  const [generatedBrief, setGeneratedBrief] = useState('');
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [intelligenceSignals, setIntelligenceSignals] = useState<string[]>([]);
  const [knowledgeSeries, setKnowledgeSeries] = useState<Array<{ node: string; description: string }>>([]);

  useEffect(() => {
    if (authChecked && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, user?.userId, router]);

  useEffect(() => {
    if (!authChecked || !user?.userId || !selectedCompanyId) return;

    const loadIntelligence = async () => {
      setIntelligenceLoading(true);
      setIntelligenceError(null);
      try {
        const [accountRes, companyIntelRes] = await Promise.all([
          fetch(`/api/account-context/analyze?companyId=${selectedCompanyId}`),
          fetch(`/api/companies/${selectedCompanyId}/intelligence?sections=market,competitors,patterns,portfolio`),
        ]);

        const nextSignals: string[] = [];

        if (accountRes.ok) {
          const accountData = await accountRes.json().catch(() => null) as Record<string, unknown> | null;
          const audience = (accountData?.target_audience || accountData?.audience || '') as string;
          const differentiator = (accountData?.differentiator || accountData?.positioning || '') as string;
          if (audience) nextSignals.push(`Audience signal: ${audience}`);
          if (differentiator) nextSignals.push(`Positioning signal: ${differentiator}`);
        }

        if (companyIntelRes.ok) {
          const intelData = await companyIntelRes.json().catch(() => null) as Record<string, unknown> | null;
          const market = intelData?.market_positioning as Record<string, unknown> | undefined;
          const patterns = intelData?.intelligence_patterns as Record<string, unknown> | undefined;
          const portfolio = intelData?.portfolio as Record<string, unknown> | undefined;

          if (market?.market_summary) nextSignals.push(`Market signal: ${String(market.market_summary)}`);
          if (market?.competitive_posture) nextSignals.push(`Competitive posture: ${String(market.competitive_posture)}`);
          if (patterns?.top_pattern) nextSignals.push(`Winning pattern: ${String(patterns.top_pattern)}`);
          if (portfolio?.best_performing_theme) nextSignals.push(`Best performing theme: ${String(portfolio.best_performing_theme)}`);
        }

        setIntelligenceSignals(nextSignals.slice(0, 6));
      } catch {
        setIntelligenceError('Unable to load intelligence guidance right now. You can continue manually.');
      } finally {
        setIntelligenceLoading(false);
      }
    };

    void loadIntelligence();
  }, [authChecked, user?.userId, selectedCompanyId]);

  const readiness = useMemo(() => {
    const checks = [
      audience.trim().length > 0,
      keyMessage.trim().length > 0,
      cta.trim().length > 0,
      contextMode !== 'focused' || focusedObjective.trim().length > 0,
      contextMode !== 'company' || companyContext.trim().length > 0,
    ];
    const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
    return { score, ready: score >= 80 };
  }, [audience, keyMessage, cta, contextMode, focusedObjective, companyContext]);

  if (!authChecked || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user?.userId) return null;

  const handleGenerateBrief = () => {
    const brief = buildBrief({
      format,
      contextMode,
      companyName: selectedCompanyName || 'Current Company',
      companyContext,
      focusedObjective,
      audience,
      keyMessage,
      proofPoints,
      cta,
      brandVoice,
      engagementScore,
      authorityScore,
      stickinessScore,
      alignmentScore,
      channels,
      exclusions,
    });
    setGeneratedBrief(brief);
  };

  const handleApplyIntelligence = () => {
    if (intelligenceSignals.length === 0) return;

    if (!companyContext && contextMode === 'company') {
      setCompanyContext(intelligenceSignals.join(' | '));
    }
    if (!keyMessage) {
      setKeyMessage(intelligenceSignals[0] || 'Build authority with differentiated insights.');
    }
    if (!proofPoints) {
      setProofPoints(intelligenceSignals.slice(1).join(' | '));
    }
    if (!brandVoice) {
      setBrandVoice('Confident, evidence-led, actionable, and aligned to brand POV.');
    }
  };

  const handleBuildKnowledgeSeries = () => {
    const base = keyMessage || focusedObjective || 'Core narrative for audience value and differentiation';
    const series = [
      { node: 'Problem Frame', description: `Define the real pain: ${base}` },
      { node: 'Myth Breaker', description: 'Challenge a common but ineffective assumption in the market.' },
      { node: 'Framework', description: 'Introduce your repeatable method or point of view.' },
      { node: 'Proof', description: 'Add data, case evidence, or tactical examples that validate claims.' },
      { node: 'Action Node', description: 'Drive a concrete next action with a clear CTA.' },
    ];
    setKnowledgeSeries(series);
  };

  const handleUseForCampaign = () => {
    const q = new URLSearchParams({
      mode: 'direct',
      source: 'content-studio',
      contentType: format,
      contextMode,
      objective: focusedObjective || keyMessage,
    });
    router.push(`/campaign-planner?${q.toString()}`);
  };

  const handleDirectSocial = () => {
    const q = new URLSearchParams({
      source: 'content-studio',
      contentType: format,
      contextMode,
      objective: focusedObjective || keyMessage,
    });
    router.push(`/multi-platform-scheduler?${q.toString()}`);
  };

  const handleCopyBrief = async () => {
    if (!generatedBrief) return;
    await navigator.clipboard.writeText(generatedBrief).catch(() => null);
  };

  return (
    <>
      <Head>
        <title>{meta.label} Studio | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-3 sm:px-4 lg:px-6">
        <div className="max-w-6xl mx-auto">
          <button
            onClick={() => router.push('/command-center/content')}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-7 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Create Content
          </button>

          <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <p className="text-4xl mb-2">{meta.icon}</p>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{meta.label} Studio</h1>
                <p className="text-gray-600 max-w-2xl">{meta.description}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 min-w-[240px]">
                <p className="text-xs text-blue-700 font-semibold uppercase tracking-wide mb-1">Brief readiness</p>
                <p className="text-2xl font-bold text-blue-800">{readiness.score}%</p>
                <p className="text-xs text-blue-700">{readiness.ready ? 'Good to generate output' : 'Add missing inputs for higher quality'}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-3">1) Choose Context Mode</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'company', label: 'Company Context', hint: 'Uses company profile, offerings, positioning' },
                    { id: 'focused', label: 'Focused Context', hint: 'Uses specific campaign goal or objective' },
                    { id: 'none', label: 'No Context', hint: 'Creates broad content from first principles' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setContextMode(opt.id as ContextMode)}
                      className={`text-left border rounded-xl p-3 transition-colors ${
                        contextMode === opt.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className="font-semibold text-sm text-gray-900">{opt.label}</p>
                      <p className="text-xs text-gray-500 mt-1">{opt.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              {contextMode === 'company' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Company Context Details</label>
                  <textarea
                    rows={3}
                    value={companyContext}
                    onChange={(e) => setCompanyContext(e.target.value)}
                    placeholder="Describe your company positioning, products/services, ICP, differentiators, and tone..."
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              )}

              {contextMode === 'focused' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Focused Objective</label>
                  <textarea
                    rows={2}
                    value={focusedObjective}
                    onChange={(e) => setFocusedObjective(e.target.value)}
                    placeholder="Example: Increase demo bookings for AI analytics by 20% in 45 days"
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Primary Audience</label>
                  <input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="CMOs at B2B SaaS companies"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Primary CTA</label>
                  <input
                    value={cta}
                    onChange={(e) => setCta(e.target.value)}
                    placeholder="Book a strategy call"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Key Message</label>
                <textarea
                  rows={2}
                  value={keyMessage}
                  onChange={(e) => setKeyMessage(e.target.value)}
                  placeholder="The one message this content must communicate"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Proof Points / Evidence</label>
                <textarea
                  rows={2}
                  value={proofPoints}
                  onChange={(e) => setProofPoints(e.target.value)}
                  placeholder="Customer results, data points, case examples, product proof"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Brand Voice Guidance</label>
                  <input
                    value={brandVoice}
                    onChange={(e) => setBrandVoice(e.target.value)}
                    placeholder={meta.toneHint}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Target Channels</label>
                  <input
                    value={channels}
                    onChange={(e) => setChannels(e.target.value)}
                    placeholder={meta.defaultChannels.join(', ')}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Exclusions / Guardrails</label>
                <input
                  value={exclusions}
                  onChange={(e) => setExclusions(e.target.value)}
                  placeholder="Avoid hard-sell tone, clickbait hooks, or unverified claims"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <h3 className="text-base font-bold text-gray-900 mb-2">2) Calibrate Content Outcomes</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: 'Engagement', val: engagementScore, setter: setEngagementScore },
                    { label: 'Authority', val: authorityScore, setter: setAuthorityScore },
                    { label: 'Stickiness', val: stickinessScore, setter: setStickinessScore },
                    { label: 'Brand Alignment', val: alignmentScore, setter: setAlignmentScore },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-700">{s.label}</span>
                        <span className="text-xs text-gray-500">{s.val}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={s.val}
                        onChange={(e) => s.setter(Number(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={handleGenerateBrief}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Generate Content Brief
                </button>
                <button
                  onClick={handleBuildKnowledgeSeries}
                  className="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Build Knowledge Graph Series
                </button>
                <button
                  onClick={handleCopyBrief}
                  disabled={!generatedBrief}
                  className="px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-lg border border-gray-300 transition-colors disabled:opacity-50"
                >
                  Copy Brief
                </button>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-base font-bold text-gray-900 mb-2">Intelligence Guidance</h3>
                {intelligenceLoading && <p className="text-sm text-gray-500">Loading company intelligence…</p>}
                {!intelligenceLoading && intelligenceError && <p className="text-sm text-amber-700">{intelligenceError}</p>}
                {!intelligenceLoading && !intelligenceError && intelligenceSignals.length === 0 && (
                  <p className="text-sm text-gray-500">No intelligence signals available yet for this company.</p>
                )}
                {!intelligenceLoading && intelligenceSignals.length > 0 && (
                  <ul className="space-y-2 text-sm text-gray-700 mb-3">
                    {intelligenceSignals.map((signal, idx) => (
                      <li key={idx}>• {signal}</li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={handleApplyIntelligence}
                  disabled={intelligenceSignals.length === 0}
                  className="w-full px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-semibold rounded-lg border border-blue-200 transition-colors disabled:opacity-50"
                >
                  Apply Intelligence to Brief Inputs
                </button>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-base font-bold text-gray-900 mb-2">3) Execute Output</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Once your brief is ready, choose where to execute this content.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={handleDirectSocial}
                    className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    Direct Post to Social Media
                  </button>
                  <button
                    onClick={handleUseForCampaign}
                    className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    Use in Campaign Engine
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  You can do both: publish directly for fast tests, then convert winners into campaigns.
                </p>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-base font-bold text-gray-900 mb-2">Quality Checklist</h3>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li>• Clear hook in first 2 lines</li>
                  <li>• Specific POV aligned to company positioning</li>
                  <li>• Evidence or examples included</li>
                  <li>• One clear CTA</li>
                  <li>• Channel-native formatting</li>
                  <li>• Reuse plan: post → series → campaign asset</li>
                </ul>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-yellow-900 mb-1">Format Guidance</h3>
                <p className="text-xs text-yellow-800">Recommended length: {meta.recommendedLength}</p>
                <p className="text-xs text-yellow-800 mt-1">Tone suggestion: {meta.toneHint}</p>
              </div>
            </div>
          </div>

          {generatedBrief && (
            <div className="mt-6 bg-white border border-gray-200 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-3">Generated Brief</h3>
              <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 rounded-lg border border-gray-200 p-4 overflow-auto">
                {generatedBrief}
              </pre>
            </div>
          )}

          {knowledgeSeries.length > 0 && (
            <div className="mt-6 bg-white border border-violet-200 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-violet-900 mb-3">Knowledge Graph Series Plan</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {knowledgeSeries.map((item) => (
                  <div key={item.node} className="bg-violet-50 border border-violet-200 rounded-xl p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-1">{item.node}</p>
                    <p className="text-xs text-violet-900">{item.description}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-violet-700 mt-3">Use this sequence as a reusable narrative backbone for story, whitepaper sections, and social post series.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
