'use client';

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

const BLUE_FIELD = 'linear-gradient(150deg, #071D3A 0%, #0A3770 54%, #0A66C2 100%)';

type RoleId = 'founder' | 'marketing' | 'growth' | 'creator' | 'agency' | 'solo';
type StepId = 'challenge' | 'visibility' | 'intelligence' | 'outcomes' | 'actions';
type SignalState = 'good' | 'watch' | 'build';

type StepContent = {
  title: string;
  summary: string;
  pain: string;
  connects: string[];
  changes: string[];
  metrics: { value: string; label: string }[];
  recommendations: string[];
};

type Role = {
  id: RoleId;
  label: string;
  badge: string;
  identity: string;
  headline: string;
  subhead: string;
  dashboardTitle: string;
  dashboardStatus: string;
  signals: { label: string; value: string; state: SignalState }[];
  cta: string;
  steps: Record<StepId, StepContent>;
};

const STEPS: { id: StepId; label: string }[] = [
  { id: 'challenge', label: 'Operational Challenges' },
  { id: 'visibility', label: 'Missing Visibility' },
  { id: 'intelligence', label: 'Operational Intelligence' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'actions', label: 'Recommended Actions' },
];

const ROLES: Role[] = [
  {
    id: 'founder',
    label: 'Founder / CXO',
    badge: 'Popular for SMB leaders',
    identity: 'Oversight / priorities / confidence',
    headline: 'See where marketing needs leadership attention.',
    subhead: 'For founders and CXOs who need control without managing every post, report, and campaign task.',
    dashboardTitle: 'Executive marketing brief',
    dashboardStatus: '3 priorities surfaced',
    signals: [
      { label: 'Campaign execution', value: 'On track', state: 'good' },
      { label: 'Authority gap', value: 'High', state: 'watch' },
      { label: 'Competitor movement', value: 'Rising', state: 'build' },
    ],
    cta: 'Get Visibility Snapshot',
    steps: {
      challenge: {
        title: 'Marketing is happening, but leadership sees fragments.',
        summary: 'Updates arrive through calls, decks, screenshots, and opinions.',
        pain: 'You cannot quickly tell what is working, what is stuck, and where spend may be leaking.',
        connects: ['Campaign progress', 'Content activity', 'Market Pulse', 'Visibility signals'],
        changes: ['Less status chasing', 'Clearer spend conversations', 'Sharper weekly priorities'],
        metrics: [
          { value: '5 min', label: 'leadership review' },
          { value: '3', label: 'priority risks' },
          { value: '1', label: 'operating view' },
        ],
        recommendations: ['Review authority gaps', 'Ask team for campaign proof', 'Delay spend until content gaps are fixed'],
      },
      visibility: {
        title: 'You need the business view, not tool-by-tool detail.',
        summary: 'Omnivyra shows what deserves attention across marketing operations.',
        pain: 'The missing piece is not more data. It is a leadership lens on execution, risk, and next decisions.',
        connects: ['Execution status', 'Competitive pressure', 'Digital authority', 'Approval needs'],
        changes: ['Know what to approve', 'Know what to challenge', 'Know what to pause'],
        metrics: [
          { value: 'Live', label: 'activity context' },
          { value: 'Less', label: 'follow-up noise' },
          { value: 'More', label: 'decision confidence' },
        ],
        recommendations: ['Check stalled initiatives', 'Review competitor movement', 'Prioritize authority-building work'],
      },
      intelligence: {
        title: 'Active Intelligence turns activity into executive clarity.',
        summary: 'Signals are generated from the operations running in and around Omnivyra.',
        pain: 'Dashboards show numbers. Omnivyra explains which operational signals matter to leadership.',
        connects: ['Reports', 'Campaigns', 'Content workflows', 'Market context'],
        changes: ['Risks become visible', 'Priorities become clearer', 'Strategy reviews become faster'],
        metrics: [
          { value: '4', label: 'systems connected' },
          { value: 'Next', label: 'action visible' },
          { value: 'AI-era', label: 'visibility lens' },
        ],
        recommendations: ['Strengthen comparison pages', 'Track authority movement', 'Ask for next-best-action brief'],
      },
      outcomes: {
        title: 'The outcome is control without micromanagement.',
        summary: 'You understand marketing direction and can intervene only where it matters.',
        pain: 'Without a shared operating view, leadership either over-manages or stays too far away.',
        connects: ['Oversight', 'Accountability', 'Priority setting', 'Business confidence'],
        changes: ['Better strategic focus', 'Cleaner accountability', 'More confident marketing investment'],
        metrics: [
          { value: 'Clear', label: 'what is moving' },
          { value: 'Visible', label: 'what is blocked' },
          { value: 'Focused', label: 'what happens next' },
        ],
        recommendations: ['Run weekly visibility review', 'Approve top campaign priority', 'Track one authority metric'],
      },
      actions: {
        title: 'Start with visibility, then scale the operating layer.',
        summary: 'Use the snapshot to understand public authority, then test workflows with free credits.',
        pain: 'The first step should be low-friction and truthful.',
        connects: ['Digital Authority Snapshot', 'Company profile', 'Free credits', 'Operational workflows'],
        changes: ['Fast entry point', 'No credit card friction', 'Clear path into deeper intelligence'],
        metrics: [
          { value: '0', label: 'credit card required' },
          { value: '1', label: 'company profile' },
          { value: 'Free', label: 'starting layer' },
        ],
        recommendations: ['Create account', 'Complete company profile', 'Request Digital Authority Snapshot'],
      },
    },
  },
  {
    id: 'marketing',
    label: 'Marketing Lead',
    badge: 'Execution workflow',
    identity: 'Coordination / campaigns / next-best-actions',
    headline: 'Coordinate campaigns, content, and visibility in one flow.',
    subhead: 'For marketing leads who need execution clarity before the next campaign review.',
    dashboardTitle: 'Campaign operating view',
    dashboardStatus: 'Execution in motion',
    signals: [
      { label: 'Launch campaign', value: 'Ready', state: 'good' },
      { label: 'AEO content', value: 'Needs brief', state: 'build' },
      { label: 'Report narrative', value: 'Drafting', state: 'good' },
    ],
    cta: 'Explore Your Workflow',
    steps: {
      challenge: {
        title: 'Stop coordinating execution through disconnected systems.',
        summary: 'Campaigns, reporting, visibility, engagement, and content planning rarely move together operationally.',
        pain: 'You spend too much energy connecting work that should already be connected.',
        connects: ['Campaign builder', 'Content creation', 'Publishing', 'Reporting context'],
        changes: ['Less coordination drag', 'Faster campaign handoff', 'Clearer team priorities'],
        metrics: [
          { value: '4', label: 'workflows aligned' },
          { value: 'Next', label: 'priority visible' },
          { value: '1', label: 'team view' },
        ],
        recommendations: ['Create campaign skeleton', 'Brief missing content', 'Review weekly execution risks'],
      },
      visibility: {
        title: 'Execution needs visibility context.',
        summary: 'Campaign planning improves when SEO, AEO, GEO, authority, and engagement signals are visible.',
        pain: 'A campaign can launch on time and still miss the discoverability layer that makes it work.',
        connects: ['SEO/AEO/GEO readiness', 'Content depth', 'Engagement', 'Channel movement'],
        changes: ['Better campaign briefs', 'Visibility-aware content', 'Stronger stakeholder updates'],
        metrics: [
          { value: 'SEO', label: 'search context' },
          { value: 'AEO', label: 'answer context' },
          { value: 'GEO', label: 'AI context' },
        ],
        recommendations: ['Add answer-ready sections', 'Map content gaps', 'Tie publishing to visibility objective'],
      },
      intelligence: {
        title: 'Recommendations become useful because they know the work.',
        summary: 'Omnivyra reads execution context before suggesting what to change.',
        pain: 'Generic AI suggestions ignore timing, capacity, campaign stage, and existing assets.',
        connects: ['Briefs', 'Assets', 'Schedules', 'Performance signals'],
        changes: ['Practical recommendations', 'Cleaner prioritization', 'Fewer disconnected tasks'],
        metrics: [
          { value: 'Live', label: 'execution context' },
          { value: '3', label: 'recommended moves' },
          { value: 'Less', label: 'guesswork' },
        ],
        recommendations: ['Refresh weak asset', 'Move campaign timing', 'Create authority support content'],
      },
      outcomes: {
        title: 'Marketing reviews become operational, not defensive.',
        summary: 'You can explain what happened, what changed, and what the team is doing next.',
        pain: 'Reporting is painful when execution context is scattered.',
        connects: ['Performance story', 'Campaign status', 'Content movement', 'Next actions'],
        changes: ['Cleaner reviews', 'Faster course correction', 'More trust in the plan'],
        metrics: [
          { value: '2 min', label: 'review prep view' },
          { value: 'Auto', label: 'performance narrative' },
          { value: 'Clear', label: 'next action' },
        ],
        recommendations: ['Prepare campaign narrative', 'Flag underperforming content', 'Show next sprint plan'],
      },
      actions: {
        title: 'Use free credits to test the working layer.',
        summary: 'Build, create, schedule, and inspect how Omnivyra supports daily execution.',
        pain: 'Marketing teams need to feel the workflow, not just read about it.',
        connects: ['Free credits', 'Campaign workflow', 'Content workflow', 'Recommendations'],
        changes: ['Hands-on testing', 'Lower adoption friction', 'Faster internal buy-in'],
        metrics: [
          { value: 'Free', label: 'credits to test' },
          { value: 'No', label: 'card required' },
          { value: 'Fast', label: 'workflow trial' },
        ],
        recommendations: ['Claim credits', 'Create a campaign draft', 'Generate first content asset'],
      },
    },
  },
  {
    id: 'growth',
    label: 'Growth Team',
    badge: 'Opportunity detection',
    identity: 'Signals / gaps / competitive movement',
    headline: 'Find discoverability gaps before competitors turn them into advantage.',
    subhead: 'For growth teams connecting visibility, content depth, market movement, and experiments.',
    dashboardTitle: 'Growth opportunity map',
    dashboardStatus: 'Gap detected',
    signals: [
      { label: 'AI answer presence', value: 'Weak', state: 'watch' },
      { label: 'Entity clarity', value: 'Improving', state: 'build' },
      { label: 'Competitor pressure', value: 'High', state: 'watch' },
    ],
    cta: 'Get Visibility Snapshot',
    steps: {
      challenge: {
        title: 'Growth opportunities disappear when discoverability signals stay fragmented.',
        summary: 'Most growth teams track channels separately without understanding operational visibility patterns.',
        pain: 'You see movement, but not always the opportunity behind it.',
        connects: ['Visibility signals', 'Competitor movement', 'Content depth', 'Market Pulse'],
        changes: ['Earlier gap detection', 'Sharper growth bets', 'Faster prioritization'],
        metrics: [
          { value: 'AI', label: 'visibility gaps' },
          { value: '3', label: 'growth signals' },
          { value: 'Now', label: 'priority timing' },
        ],
        recommendations: ['Inspect AI answer presence', 'Compare competitor authority', 'Prioritize content gaps'],
      },
      visibility: {
        title: 'SEO alone no longer explains discoverability.',
        summary: 'Search, answer engines, generative systems, and authority signals now overlap.',
        pain: 'Teams miss growth when they optimize only for old visibility models.',
        connects: ['SEO readiness', 'AEO readiness', 'GEO readiness', 'AI visibility'],
        changes: ['Broader visibility model', 'Better content investment', 'Clearer opportunity sequence'],
        metrics: [
          { value: 'SEO', label: 'search' },
          { value: 'AEO', label: 'answers' },
          { value: 'GEO', label: 'generative' },
        ],
        recommendations: ['Measure readiness', 'Fix entity gaps', 'Create answer-ready content'],
      },
      intelligence: {
        title: 'Operational context turns signals into growth priorities.',
        summary: 'Omnivyra connects what the market is doing with what your team can execute.',
        pain: 'Insights are useless when they do not become a prioritized operating plan.',
        connects: ['Market Pulse', 'Campaign planning', 'Content workflow', 'Authority signals'],
        changes: ['Better opportunity ranking', 'More realistic experiments', 'Clearer next-best-actions'],
        metrics: [
          { value: 'Ranked', label: 'opportunities' },
          { value: 'Live', label: 'market context' },
          { value: 'Next', label: 'growth move' },
        ],
        recommendations: ['Build comparison asset', 'Strengthen proof pages', 'Monitor competitor shift'],
      },
      outcomes: {
        title: 'Growth work becomes less reactive.',
        summary: 'You know which gaps matter and which moves can compound.',
        pain: 'Without operational intelligence, teams chase every signal with the same urgency.',
        connects: ['Opportunity scoring', 'Execution capacity', 'Visibility movement', 'Performance context'],
        changes: ['Sharper bets', 'Less wasted experimentation', 'More compounding visibility'],
        metrics: [
          { value: 'Less', label: 'signal chasing' },
          { value: 'More', label: 'strategic focus' },
          { value: 'Clear', label: 'growth path' },
        ],
        recommendations: ['Select top opportunity', 'Assign content owner', 'Review movement monthly'],
      },
      actions: {
        title: 'Start by measuring the public visibility layer.',
        summary: 'The snapshot gives growth teams a baseline before deeper connected reports.',
        pain: 'You cannot prioritize what you have not measured.',
        connects: ['Snapshot', 'Authority baseline', 'Competitor view', 'Readiness gaps'],
        changes: ['Faster baseline', 'Clearer first fix', 'Better growth roadmap'],
        metrics: [
          { value: 'Free', label: 'baseline layer' },
          { value: 'Public', label: 'signals first' },
          { value: 'Next', label: 'fix sequence' },
        ],
        recommendations: ['Request snapshot', 'Review top gaps', 'Plan visibility sprint'],
      },
    },
  },
  {
    id: 'creator',
    label: 'Content Strategist',
    badge: 'Content intelligence',
    identity: 'Content / authority / AI visibility',
    headline: 'Content should be guided by discoverability intelligence.',
    subhead: 'Most content systems operate without understanding AI visibility, authority gaps, or topic positioning.',
    dashboardTitle: 'Content authority map',
    dashboardStatus: 'Authority building',
    signals: [
      { label: 'Education posts', value: 'Strong', state: 'good' },
      { label: 'AI visibility', value: 'Needs structure', state: 'build' },
      { label: 'Platform focus', value: 'LinkedIn', state: 'good' },
    ],
    cta: 'Explore Your Workflow',
    steps: {
      challenge: {
        title: 'Content should be guided by discoverability intelligence.',
        summary: 'Most content systems operate without understanding AI visibility, authority gaps, or topic positioning.',
        pain: 'You plan content without enough confidence in authority direction, topic positioning, or discoverability impact.',
        connects: ['Content themes', 'Platform presence', 'Engagement', 'Authority signals'],
        changes: ['Less random posting', 'Clearer theme focus', 'Better authority building'],
        metrics: [
          { value: '4', label: 'themes ranked' },
          { value: '1', label: 'platform focus' },
          { value: 'AI', label: 'visibility lens' },
        ],
        recommendations: ['Rank content themes', 'Repeat authority formats', 'Fix thin profile signals'],
      },
      visibility: {
        title: 'Creators need discoverability beyond platform likes.',
        summary: 'Authority depends on entity clarity, content depth, platform presence, and AI interpretation.',
        pain: 'Platform metrics do not show whether your brand is understandable to search and AI systems.',
        connects: ['Entity clarity', 'Content depth', 'AI visibility', 'Public authority'],
        changes: ['Smarter content direction', 'Better positioning', 'More durable visibility'],
        metrics: [
          { value: 'Entity', label: 'clarity' },
          { value: 'Depth', label: 'content signal' },
          { value: 'Trust', label: 'authority cue' },
        ],
        recommendations: ['Clarify topical pillars', 'Add proof assets', 'Structure profile and content summaries'],
      },
      intelligence: {
        title: 'Omnivyra connects creation with visibility impact.',
        summary: 'Content ideas, creative assets, and publishing signals feed the next recommendation.',
        pain: 'Generic content advice ignores what your audience and authority signals are already saying.',
        connects: ['Text content', 'Creator-led visuals', 'Publishing', 'Engagement signals'],
        changes: ['More relevant ideas', 'Better asset planning', 'Clearer content experiments'],
        metrics: [
          { value: 'Next', label: 'content move' },
          { value: 'Smart', label: 'format choice' },
          { value: 'Clear', label: 'theme path' },
        ],
        recommendations: ['Create proof-led post', 'Turn best idea into banner', 'Publish answer-ready explainer'],
      },
      outcomes: {
        title: 'The payoff is creative control with strategic direction.',
        summary: 'You know what to create and how it supports authority.',
        pain: 'Without direction, content becomes busy work.',
        connects: ['Creative output', 'Brand authority', 'Platform focus', 'Discoverability'],
        changes: ['Better consistency', 'More intentional publishing', 'Clearer creator-to-brand path'],
        metrics: [
          { value: 'Less', label: 'content drift' },
          { value: 'More', label: 'authority focus' },
          { value: 'Ready', label: 'brand story' },
        ],
        recommendations: ['Build weekly theme plan', 'Create repeatable formats', 'Track authority movement'],
      },
      actions: {
        title: 'Use credits to test content creation and direction.',
        summary: 'Try the workflow with content ideas, creative assets, and platform focus.',
        pain: 'Creators need to feel whether the platform improves output quality quickly.',
        connects: ['Free credits', 'Content creation', 'Visual assets', 'Publishing direction'],
        changes: ['Fast experimentation', 'No card needed', 'Clearer creative workflow'],
        metrics: [
          { value: 'Free', label: 'credits' },
          { value: 'Fast', label: 'first asset' },
          { value: 'Next', label: 'content plan' },
        ],
        recommendations: ['Claim credits', 'Create first content asset', 'Review topic recommendations'],
      },
    },
  },
  {
    id: 'agency',
    label: 'Agency',
    badge: 'Client workflow',
    identity: 'Client proof / reporting / differentiated strategy',
    headline: 'Turn client work into a stronger intelligence narrative.',
    subhead: 'For agencies that need to explain strategy, prove progress, and recommend the next move with confidence.',
    dashboardTitle: 'Client intelligence brief',
    dashboardStatus: 'Ready for review',
    signals: [
      { label: 'Visibility snapshot', value: 'Prepared', state: 'good' },
      { label: 'Competitor pressure', value: 'Rising', state: 'watch' },
      { label: 'Next sprint', value: 'Prioritized', state: 'build' },
    ],
    cta: 'Get Visibility Snapshot',
    steps: {
      challenge: {
        title: 'Client reporting becomes more strategic when operational context is connected.',
        summary: 'Agencies often explain isolated metrics instead of operational visibility movement.',
        pain: 'The agency may be doing strong work, but the proof is scattered across reports and tools.',
        connects: ['Client snapshots', 'Campaign activity', 'Content work', 'Market context'],
        changes: ['Stronger client trust', 'Better review meetings', 'Clearer next sprint'],
        metrics: [
          { value: 'Proof', label: 'behind strategy' },
          { value: 'Next', label: 'sprint clarity' },
          { value: 'Client', label: 'ready view' },
        ],
        recommendations: ['Prepare visibility narrative', 'Show competitor pressure', 'Prioritize client next actions'],
      },
      visibility: {
        title: 'Clients need to see where discoverability is weak.',
        summary: 'The snapshot turns SEO, AEO, GEO, AI visibility, and authority into a clearer conversation.',
        pain: 'Without a baseline, recommendations can feel subjective.',
        connects: ['Digital authority', 'AI visibility', 'Content gaps', 'Competitive positioning'],
        changes: ['Better client education', 'More credible recommendations', 'Cleaner strategic positioning'],
        metrics: [
          { value: 'SEO', label: 'readiness' },
          { value: 'AEO', label: 'answers' },
          { value: 'GEO', label: 'generative' },
        ],
        recommendations: ['Run client snapshot', 'Explain top gaps', 'Map fixes to next retainer sprint'],
      },
      intelligence: {
        title: 'Operational intelligence makes agency advice harder to dismiss.',
        summary: 'Recommendations are tied to client visibility, campaign work, content depth, and market movement.',
        pain: 'Client trust drops when reporting does not connect execution with strategy.',
        connects: ['Reports', 'Execution', 'Market Pulse', 'Recommendations'],
        changes: ['Sharper strategy', 'Better proof', 'More differentiated delivery'],
        metrics: [
          { value: 'Live', label: 'client context' },
          { value: 'Ranked', label: 'priorities' },
          { value: 'Clear', label: 'next move' },
        ],
        recommendations: ['Create client action brief', 'Show market movement', 'Tie content work to authority gap'],
      },
      outcomes: {
        title: 'The outcome is a more trusted client relationship.',
        summary: 'Clients see the logic behind the work, not just the output.',
        pain: 'Agencies lose value when clients cannot connect activity to growth direction.',
        connects: ['Strategic proof', 'Operational reporting', 'Client education', 'Next-best-actions'],
        changes: ['Better retention conversations', 'Higher perceived expertise', 'Clearer expansion path'],
        metrics: [
          { value: 'More', label: 'client trust' },
          { value: 'Less', label: 'report friction' },
          { value: 'Better', label: 'strategic proof' },
        ],
        recommendations: ['Standardize client snapshot', 'Use action briefs', 'Track movement by sprint'],
      },
      actions: {
        title: 'Start with a client visibility baseline.',
        summary: 'Use the snapshot as an entry point into deeper client intelligence.',
        pain: 'Agencies need a fast, credible way to start the strategic conversation.',
        connects: ['Snapshot', 'Client profile', 'Authority report', 'Next sprint plan'],
        changes: ['Faster client diagnosis', 'Cleaner onboarding', 'More strategic entry point'],
        metrics: [
          { value: 'Free', label: 'first layer' },
          { value: 'Fast', label: 'client baseline' },
          { value: 'Next', label: 'sprint plan' },
        ],
        recommendations: ['Create account', 'Add client profile', 'Request snapshot'],
      },
    },
  },
  {
    id: 'solo',
    label: 'Solo Operator',
    badge: 'Small team fit',
    identity: 'Focus / capacity / practical execution',
    headline: 'Know what marketing work to do when time is limited.',
    subhead: 'For lean teams that need marketing to move without hiring a full marketing department.',
    dashboardTitle: 'Lean action plan',
    dashboardStatus: 'Ready to execute',
    signals: [
      { label: 'This week', value: '3 tasks', state: 'good' },
      { label: 'Content asset', value: 'Draft', state: 'build' },
      { label: 'Channel focus', value: 'LinkedIn', state: 'good' },
    ],
    cta: 'Explore Your Workflow',
    steps: {
      challenge: {
        title: 'Marketing becomes easier when operational clarity replaces guesswork.',
        summary: 'Solo teams struggle to manage visibility, publishing, discoverability, and execution together.',
        pain: 'Without a practical plan, marketing becomes inconsistent and reactive.',
        connects: ['Weekly tasks', 'Content creation', 'Campaign basics', 'Performance signals'],
        changes: ['Less overwhelm', 'More focus', 'Consistent progress'],
        metrics: [
          { value: '30 min', label: 'weekly focus' },
          { value: '3', label: 'next tasks' },
          { value: '1', label: 'channel focus' },
        ],
        recommendations: ['Pick one channel', 'Create one asset', 'Review one signal'],
      },
      visibility: {
        title: 'Small teams need a simple view of what matters.',
        summary: 'You need to know where you are visible, what is weak, and what can wait.',
        pain: 'Too many recommendations create more confusion than action.',
        connects: ['Visibility baseline', 'Content gaps', 'Channel focus', 'Authority signals'],
        changes: ['Clear first move', 'Less wasted effort', 'Better use of limited time'],
        metrics: [
          { value: '1', label: 'focus area' },
          { value: 'Clear', label: 'what can wait' },
          { value: 'Next', label: 'best action' },
        ],
        recommendations: ['Request snapshot', 'Fix top gap first', 'Delay low-impact channels'],
      },
      intelligence: {
        title: 'Guidance should fit your capacity.',
        summary: 'Omnivyra turns intelligence into actions a small team can actually execute.',
        pain: 'Enterprise-style plans do not help when the team is one or two people.',
        connects: ['Capacity', 'Priorities', 'Content creation', 'Execution plan'],
        changes: ['Realistic weekly plan', 'Better focus', 'Progress without headcount'],
        metrics: [
          { value: 'Lean', label: 'workflow' },
          { value: 'Practical', label: 'recommendations' },
          { value: 'Fast', label: 'execution' },
        ],
        recommendations: ['Create weekly plan', 'Generate content draft', 'Schedule one campaign touchpoint'],
      },
      outcomes: {
        title: 'The payoff is momentum without complexity.',
        summary: 'You know what to do next and why it matters.',
        pain: 'Marketing stalls when every action requires a new decision.',
        connects: ['Focus', 'Execution', 'Reporting', 'Confidence'],
        changes: ['More consistency', 'Fewer abandoned plans', 'Clearer growth habit'],
        metrics: [
          { value: 'More', label: 'momentum' },
          { value: 'Less', label: 'decision fatigue' },
          { value: 'Better', label: 'marketing rhythm' },
        ],
        recommendations: ['Use weekly action list', 'Repeat best format', 'Review progress monthly'],
      },
      actions: {
        title: 'Use free credits to test the workflow.',
        summary: 'Start small: one plan, one asset, one next action.',
        pain: 'Adoption should feel easy for lean teams.',
        connects: ['Free credits', 'Content asset', 'Action plan', 'Snapshot'],
        changes: ['Low-friction trial', 'Practical first win', 'No credit card barrier'],
        metrics: [
          { value: 'Free', label: 'credits' },
          { value: '1', label: 'first asset' },
          { value: 'No', label: 'card required' },
        ],
        recommendations: ['Claim credits', 'Create first asset', 'Request snapshot when profile is ready'],
      },
    },
  },
];

const TRANSFORMATIONS = [
  ['Disconnected tools', 'Connected operational intelligence'],
  ['Reactive decisions', 'Guided priorities'],
  ['Fragmented discoverability', 'Unified visibility intelligence'],
  ['Reporting chaos', 'Operational clarity'],
];

const TESTIMONIALS = [
  {
    quote: 'Omnivyra gives leadership a clear view of what marketing is doing without turning every review into a reporting exercise.',
    name: 'Founder',
    role: 'B2B services company',
  },
  {
    quote: 'The value is not another dashboard. It is knowing which campaign, content, or visibility gap deserves attention now.',
    name: 'Marketing Lead',
    role: 'Growth-stage team',
  },
  {
    quote: 'For client work, the snapshot and operating context make recommendations feel much more strategic.',
    name: 'Agency Strategist',
    role: 'Digital agency',
  },
];

const stateStyles: Record<SignalState, string> = {
  good: 'border-[#9BD6FF] bg-[#E8F7FF] text-[#075FAE]',
  watch: 'border-[#CBE2F7] bg-white text-[#0A3A7A]',
  build: 'border-[#0A66C2] bg-[#0A66C2] text-white',
};

const roleAtmospheres: Record<RoleId, string> = {
  founder:
    'radial-gradient(circle at 18% 18%, rgba(10,102,194,0.13), transparent 28%), radial-gradient(circle at 86% 44%, rgba(7,29,58,0.07), transparent 32%), rgba(238,247,255,0.92)',
  marketing:
    'radial-gradient(circle at 28% 22%, rgba(63,169,245,0.14), transparent 28%), radial-gradient(circle at 82% 54%, rgba(10,102,194,0.08), transparent 34%), rgba(238,247,255,0.92)',
  growth:
    'radial-gradient(circle at 22% 24%, rgba(10,102,194,0.11), transparent 30%), radial-gradient(circle at 82% 42%, rgba(70,180,255,0.13), transparent 32%), rgba(238,247,255,0.92)',
  creator:
    'radial-gradient(circle at 24% 18%, rgba(63,169,245,0.12), transparent 28%), radial-gradient(circle at 76% 52%, rgba(169,218,255,0.18), transparent 36%), rgba(238,247,255,0.92)',
  agency:
    'radial-gradient(circle at 18% 26%, rgba(8,46,99,0.10), transparent 30%), radial-gradient(circle at 84% 40%, rgba(10,102,194,0.13), transparent 34%), rgba(238,247,255,0.92)',
  solo:
    'radial-gradient(circle at 24% 22%, rgba(63,169,245,0.10), transparent 28%), radial-gradient(circle at 82% 56%, rgba(10,102,194,0.09), transparent 34%), rgba(238,247,255,0.92)',
};

function OperationalAtmosphere() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 opacity-45" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_16%,rgba(10,102,194,0.045),transparent_25%),radial-gradient(circle_at_84%_72%,rgba(63,169,245,0.05),transparent_30%)]" />
      <svg className="h-full w-full" viewBox="0 0 1400 1000" preserveAspectRatio="none">
        <path
          d="M80 210 C 280 120, 430 260, 620 220 S 920 140, 1260 270"
          fill="none"
          stroke="rgba(10,102,194,0.055)"
          strokeWidth="1.4"
          strokeDasharray="3 20"
          className="solution-signal-drift"
        />
        <path
          d="M120 790 C 330 640, 520 760, 720 660 S 1010 560, 1300 720"
          fill="none"
          stroke="rgba(63,169,245,0.05)"
          strokeWidth="1.4"
          className="solution-signal-breathe"
        />
      </svg>
    </div>
  );
}

function SignalMemory({ dark = false }: { dark?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className={dark ? 'absolute inset-0 omnivyra-dark-grid opacity-35' : 'absolute inset-0 omnivyra-light-grid opacity-70'} />
      <svg className="absolute inset-0 h-full w-full opacity-70" viewBox="0 0 1200 620" preserveAspectRatio="none">
        <path
          d="M70 160 C 240 95, 360 205, 520 172 S 790 95, 1110 235"
          fill="none"
          stroke={dark ? 'rgba(169,218,255,0.11)' : 'rgba(10,102,194,0.07)'}
          strokeWidth="1"
          strokeDasharray="3 22"
          className="solution-signal-drift"
        />
        <path
          d="M120 505 C 285 405, 455 545, 630 456 S 880 372, 1120 494"
          fill="none"
          stroke={dark ? 'rgba(255,255,255,0.06)' : 'rgba(63,169,245,0.055)'}
          strokeWidth="1"
          className="solution-signal-breathe"
        />
      </svg>
    </div>
  );
}

function PrimaryCtas() {
  return (
    <div className="flex flex-col justify-center gap-3 sm:flex-row">
      <Link
        href="/create-account"
        className="inline-flex min-h-[50px] items-center justify-center rounded-full bg-white px-7 py-3 text-[15px] font-black text-[#0A66C2] shadow-[0_14px_34px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(0,0,0,0.22)]"
      >
        Get Visibility Snapshot
      </Link>
      <Link
        href="/get-free-credits"
        className="inline-flex min-h-[50px] items-center justify-center rounded-full border border-white/30 bg-white/10 px-7 py-3 text-[15px] font-black text-white backdrop-blur transition hover:bg-white/20"
      >
        Explore Your Workflow
      </Link>
    </div>
  );
}

function CinematicFooter() {
  const columns = [
    { heading: 'Product', links: [{ label: 'Features', href: '/features' }, { label: 'Solutions', href: '/solutions' }, { label: 'Pricing', href: '/pricing' }] },
    { heading: 'Company', links: [{ label: 'About', href: '/about' }, { label: 'Blog', href: '/blog' }] },
    { heading: 'Legal', links: [{ label: 'Privacy Policy', href: '/privacy' }, { label: 'Terms of Service', href: '/terms' }, { label: 'Data Deletion Instructions', href: '/data-deletion' }] },
  ];

  return (
    <footer className="relative z-10 overflow-hidden bg-[#F7FBFF] px-6 pb-10 pt-16 lg:px-8">
      <SignalMemory />
      <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-[80%] -translate-x-1/2 bg-gradient-to-b from-[#0A66C2]/[0.055] to-transparent blur-2xl" />
      <div className="relative mx-auto max-w-[1180px] pt-8">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C9DDF3]/65 to-transparent" />
        <div className="mt-10 grid gap-12 lg:grid-cols-[1.22fr_1fr] lg:items-start">
          <div>
            <Link href="/" aria-label="Omnivyra home" className="inline-flex">
              <img src="/logo.png" alt="Omnivyra" className="h-12 w-auto object-contain" />
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-7 text-[#5D6F83]">
              Connected intelligence for AI-era visibility and marketing operations.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3">
            {columns.map((column) => (
              <div key={column.heading}>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#071D3A]">{column.heading}</p>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-[#5D6F83] transition hover:text-[#0A66C2]">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 h-px w-full bg-gradient-to-r from-transparent via-[#D8E3F0]/60 to-transparent" />
        <div className="mt-7 flex flex-col gap-3 text-xs text-[#6B7C93] sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Omnivyra. All rights reserved.</p>
          <p>Marketing Decision Intelligence Platform</p>
        </div>
      </div>
    </footer>
  );
}

function RoleSelector({
  activeRole,
  onSelect,
}: {
  activeRole: Role;
  onSelect: (role: Role) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-[24px] border border-[#CBE2F7] bg-white/[0.86] p-3 shadow-[0_14px_42px_rgba(8,68,138,0.07)] backdrop-blur">
      <SignalMemory />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative px-2">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#0A66C2]">How do you operate marketing?</p>
          <p className="mt-1 text-sm text-[#496179]">Choose how fragmented operations affect your role.</p>
        </div>
        <select
          value={activeRole.id}
          onChange={(event) => {
            const selected = ROLES.find((role) => role.id === event.target.value);
            if (selected) onSelect(selected);
          }}
          className="rounded-2xl border border-[#CBE2F7] bg-[#F7FBFF] px-4 py-3 text-sm font-bold text-[#071D3A] outline-none transition focus:border-[#0A66C2] lg:hidden"
          aria-label="Select marketing role"
        >
          {ROLES.map((role) => (
            <option key={role.id} value={role.id}>{role.label}</option>
          ))}
        </select>
      </div>

      <div className="relative mt-3 hidden grid-cols-6 gap-2 lg:grid">
        {ROLES.map((role) => {
          const active = role.id === activeRole.id;
          return (
            <button
              key={role.id}
              type="button"
              onClick={() => onSelect(role)}
              className={`group rounded-2xl border px-3 py-3 text-left transition duration-300 ${
                active
                  ? 'border-[#0A66C2] bg-[#0A66C2] text-white shadow-[0_16px_34px_rgba(10,102,194,0.24)]'
                  : 'border-[#D7E8F8] bg-[#F7FBFF]/85 text-[#071D3A] hover:-translate-y-0.5 hover:border-[#9BD6FF] hover:bg-white'
              }`}
            >
              <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${
                active ? 'bg-white/15 text-[#D6F0FF]' : 'bg-white text-[#0A66C2]'
              }`}>
                {role.badge}
              </span>
              <span className="mt-2 block text-sm font-black leading-5">{role.label}</span>
              <span className={`mt-1 block text-[11px] leading-4 ${active ? 'text-[#D6F0FF]' : 'text-[#5C748C]'}`}>{role.identity}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProgressNavigator({
  activeStep,
  setActiveStep,
  activeRole,
}: {
  activeStep: number;
  setActiveStep: (step: number) => void;
  activeRole: Role;
}) {
  return (
    <nav className="relative overflow-hidden rounded-[28px] border border-[#CBE2F7] bg-white/[0.90] p-5 shadow-[0_18px_56px_rgba(8,68,138,0.08)] backdrop-blur">
      <SignalMemory />
      <div className="relative">
      <div className="flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-[#0A66C2]">Operational journey</p>
        <span className="rounded-full bg-[#F0F8FF] px-3 py-1 text-xs font-black text-[#0A66C2]">
          {activeStep + 1} of {STEPS.length}
        </span>
      </div>

      <div className="relative mt-5 space-y-1">
        <div className="pointer-events-none absolute bottom-4 left-[23px] top-4 w-px bg-gradient-to-b from-[#0A66C2]/10 via-[#0A66C2]/30 to-[#0A66C2]/10" />
        {STEPS.map((step, index) => {
          const active = index === activeStep;
          const complete = index < activeStep;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveStep(index)}
              className={`group relative flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                active ? 'bg-[#0A66C2] text-white shadow-[0_14px_30px_rgba(10,102,194,0.20)]' : 'text-[#496179] hover:bg-[#F0F8FF]'
              }`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-black ${
                active
                  ? 'border-white bg-white text-[#0A66C2]'
                  : complete
                    ? 'border-[#0A66C2] bg-[#0A66C2] text-white'
                    : 'border-[#B8D8F3] bg-white text-[#0A66C2]'
              }`}>
                {index + 1}
              </span>
              <span className={`text-sm font-bold ${active ? 'text-white' : 'text-[#071D3A]'}`}>{step.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-2xl border border-[#D7E8F8] bg-[#F7FBFF] p-4">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#0A66C2]">Current mode</p>
        <p className="mt-2 text-base font-black text-[#071D3A]">{activeRole.label}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-[#5C748C]">{activeRole.identity}</p>
      </div>
      </div>
    </nav>
  );
}

function StatusPill({ value, state }: { value: string; state: SignalState }) {
  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${stateStyles[state]}`}>{value}</span>;
}

function FounderView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Executive intelligence</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="Confidence 74" state="build" />
      </div>
      <div className="mt-4 rounded-2xl bg-white p-4">
        <div className="flex items-end gap-2">
          {[58, 52, 49, 46, 41, 44, 39].map((height, index) => (
            <div key={index} className="flex-1 rounded-t-lg bg-[#0A66C2]" style={{ height }} />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs font-bold text-[#496179]">
          <span>Visibility trend</span>
          <span className="text-[#0A66C2]">Needs attention</span>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Competitor authority rising', 'Watch', 'watch'],
          ['3 priority risks surfaced', 'Review', 'build'],
          ['Content execution delayed', 'Blocked', 'watch'],
          ['Strategic visibility score', '74/100', 'good'],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function MarketingView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Workflow operational</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="Queue active" state="build" />
      </div>
      <div className="mt-4 grid gap-3">
        {['Plan', 'Create', 'Publish', 'Review'].map((item, index) => (
          <div key={item} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 rounded-2xl bg-white p-3">
            <span className="text-sm font-black text-[#071D3A]">{item}</span>
            <div className="h-2 rounded-full bg-[#D7E8F8]">
              <div className="h-2 rounded-full bg-[#0A66C2]" style={{ width: `${[85, 58, 72, 44][index]}%` }} />
            </div>
            <span className="text-xs font-black text-[#0A66C2]">{[85, 58, 72, 44][index]}%</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Paid visibility dropping', 'Alert', 'watch' as SignalState],
          ['2 campaign bottlenecks', 'Fix', 'build' as SignalState],
          ['SEO/AEO opportunity detected', 'Open', 'good' as SignalState],
          ['Publishing alignment improved', 'Stable', 'good' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function GrowthView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Opportunity radar</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="GEO gap" state="build" />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 rounded-2xl bg-white p-3">
        {Array.from({ length: 16 }).map((_, index) => (
          <div
            key={index}
            className={`h-10 rounded-xl ${index % 5 === 0 ? 'bg-[#0A66C2]' : index % 3 === 0 ? 'bg-[#9BD6FF]' : 'bg-[#E8F7FF]'}`}
          />
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Visibility momentum rising', 'Up', 'good' as SignalState],
          ['Competitor overlap increasing', 'Watch', 'watch' as SignalState],
          ['GEO opportunity detected', 'Act', 'build' as SignalState],
          ['Authority growth accelerating', 'Good', 'good' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function ContentView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Content strategist view</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="3 opportunities" state="build" />
      </div>
      <div className="mt-4 rounded-2xl bg-white p-4">
        <div className="grid grid-cols-3 gap-3">
          {['Topic authority', 'AI visibility', 'Publishing'].map((label, index) => (
            <div key={label} className="rounded-2xl border border-[#D7E8F8] p-3 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-[8px] border-[#0A66C2] text-sm font-black text-[#0A66C2]">
                {[42, 68, 81][index]}
              </div>
              <p className="mt-2 text-xs font-black text-[#071D3A]">{label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Topic authority weak', 'Build', 'watch' as SignalState],
          ['AI visibility improving', 'Up', 'good' as SignalState],
          ['3 content opportunities detected', 'Open', 'build' as SignalState],
          ['Publishing consistency stable', 'Stable', 'good' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function AgencyView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Multi-client intelligence</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="Review ready" state="good" />
      </div>
      <div className="mt-4 grid gap-2">
        {[
          ['Client A', 'Visibility loss', 42],
          ['Client B', 'Authority improving', 74],
          ['Client C', 'Competitor overlap', 58],
        ].map(([client, label, score]) => (
          <div key={client} className="grid grid-cols-[80px_1fr_48px] items-center gap-3 rounded-2xl bg-white p-3">
            <span className="text-sm font-black text-[#071D3A]">{client}</span>
            <div>
              <p className="text-xs font-bold text-[#496179]">{label}</p>
              <div className="mt-1 h-2 rounded-full bg-[#D7E8F8]"><div className="h-2 rounded-full bg-[#0A66C2]" style={{ width: `${score}%` }} /></div>
            </div>
            <span className="text-sm font-black text-[#0A66C2]">{score}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['2 clients losing visibility', 'Watch', 'watch' as SignalState],
          ['Strategic recommendation ready', 'Ready', 'build' as SignalState],
          ['Authority benchmark improved', 'Good', 'good' as SignalState],
          ['Client opportunity tracking', 'Live', 'good' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function SoloView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Simplified action queue</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="3 actions" state="build" />
      </div>
      <div className="mt-4 grid gap-2">
        {['Create one authority post', 'Schedule campaign touchpoint', 'Review visibility gap'].map((item, index) => (
          <div key={item} className="flex items-center gap-3 rounded-2xl bg-white p-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0A66C2] text-sm font-black text-white">{index + 1}</span>
            <span className="text-sm font-black text-[#071D3A]">{item}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Visibility improving', 'Up', 'good' as SignalState],
          ['Publishing consistency stable', 'Stable', 'good' as SignalState],
          ['Authority gaps detected', 'Fix', 'watch' as SignalState],
          ['Operational overload reduced', 'Focus', 'build' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function MetricRow({ metrics }: { metrics: StepContent['metrics'] }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
          <p className="text-xl font-black text-[#0A66C2]">{metric.value}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#607A94]">{metric.label}</p>
        </div>
      ))}
    </div>
  );
}

function RoleOperationalView({ role, step }: { role: Role; step: StepContent }) {
  if (role.id === 'founder') return <FounderView role={role} step={step} />;
  if (role.id === 'marketing') return <MarketingView role={role} step={step} />;
  if (role.id === 'growth') return <GrowthView role={role} step={step} />;
  if (role.id === 'creator') return <ContentView role={role} step={step} />;
  if (role.id === 'agency') return <AgencyView role={role} step={step} />;
  return <SoloView role={role} step={step} />;
}

function GuidedPanel({ role, step }: { role: Role; step: StepContent }) {
  return (
    <article key={`${role.id}-${step.title}`} className="solution-reveal relative overflow-hidden rounded-[32px] border border-[#CBE2F7] bg-white/[0.90] p-5 shadow-[0_24px_72px_rgba(8,68,138,0.10)] backdrop-blur lg:p-7">
      <SignalMemory />
      <div className="pointer-events-none absolute -right-28 top-8 h-72 w-72 rounded-full bg-[#3FA9F5]/[0.10] blur-3xl" />
      <div className="relative grid gap-7 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-[#0A66C2]">{role.label}</p>
          <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-[#071D3A] lg:text-4xl">{step.title}</h2>
          <p className="mt-4 text-base leading-7 text-[#496179]">{step.summary}</p>

          <div className="mt-5 rounded-2xl border border-[#D7E8F8] bg-[#F7FBFF]/85 p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Daily frustration</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#334B63]">{step.pain}</p>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Omnivyra unifies</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {step.connects.map((item) => (
                  <span key={item} className="rounded-full border border-[#CBE2F7] bg-[#F7FBFF]/90 px-3 py-2 text-xs font-black text-[#0A3A7A]">{item}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">What changes</p>
              <div className="mt-3 space-y-2">
                {step.changes.map((item) => (
                  <div key={item} className="rounded-2xl bg-[#0A66C2] px-3 py-2 text-xs font-bold leading-5 text-white">{item}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <RoleOperationalView role={role} step={step} />
        </div>
      </div>

      <div className="relative mt-6 rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF]/86 p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Recommended actions</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {step.recommendations.map((item, index) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl bg-white px-3 py-3 shadow-[0_8px_20px_rgba(8,68,138,0.05)]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0A66C2] text-xs font-black text-white">{index + 1}</span>
                  <span className="text-sm font-bold leading-5 text-[#071D3A]">{item}</span>
                </div>
              ))}
            </div>
          </div>
          <Link
            href={role.id === 'marketing' || role.id === 'creator' || role.id === 'solo' ? '/get-free-credits' : '/create-account'}
            className="inline-flex min-h-[52px] items-center justify-center rounded-full bg-[#0A66C2] px-7 py-3 text-sm font-black text-white shadow-[0_16px_34px_rgba(10,102,194,0.22)] transition hover:-translate-y-0.5 hover:bg-[#075FAE]"
          >
            {role.cta}
          </Link>
        </div>
      </div>
    </article>
  );
}

function FragmentedFlow() {
  const nodes = ['Content', 'Campaigns', 'Publishing', 'Visibility', 'Analytics', 'Reporting'];
  const positions = [
    'left-[4%] top-[10%]',
    'left-[34%] top-[4%]',
    'right-[4%] top-[14%]',
    'left-[6%] bottom-[16%]',
    'left-[38%] bottom-[8%]',
    'right-[6%] bottom-[18%]',
  ];
  return (
    <div className="relative overflow-hidden rounded-[30px] border border-[#CBE2F7]/70 bg-[#F7FBFF]/72 p-5 shadow-[0_18px_56px_rgba(8,68,138,0.06)] backdrop-blur">
      <div className="pointer-events-none absolute inset-0 opacity-45" aria-hidden="true">
        <SignalMemory />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(10,102,194,0.10),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.62),rgba(247,251,255,0.36))]" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-70" viewBox="0 0 900 520" preserveAspectRatio="none" aria-hidden="true">
        <path d="M92 126 C 245 72, 332 180, 452 154 S 670 104, 806 202" fill="none" stroke="rgba(10,102,194,0.12)" strokeWidth="1" strokeDasharray="3 18" className="solution-signal-drift" />
        <path d="M96 370 C 250 290, 384 420, 512 330 S 700 276, 820 372" fill="none" stroke="rgba(63,169,245,0.11)" strokeWidth="1" className="solution-signal-breathe" />
        <path d="M120 130 C 278 230, 330 246, 450 252 S 620 255, 785 150" fill="none" stroke="rgba(10,102,194,0.13)" strokeWidth="1" strokeDasharray="2 15" className="solution-signal-drift" />
        <path d="M120 390 C 290 292, 340 266, 450 252 S 610 238, 782 382" fill="none" stroke="rgba(63,169,245,0.12)" strokeWidth="1" strokeDasharray="2 15" className="solution-signal-drift-slow" />
      </svg>
      <div className="relative min-h-[430px]">
        <div className="hidden sm:block">
          {nodes.map((node, index) => (
            <div
              key={node}
              className={`solution-node-drift absolute w-[29%] rounded-2xl border px-4 py-3 ${positions[index]} ${
                index % 2 === 0
                  ? 'border-[#D7E8F8]/70 bg-white/70'
                  : 'border-[#CBE2F7]/65 bg-[#EAF6FF]/62'
              }`}
            >
              <p className="text-sm font-black text-[#071D3A]">{node}</p>
              <p className="mt-1 text-xs font-semibold text-[#607A94]">Operational signal</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:hidden">
          {nodes.map((node) => (
            <div key={node} className="rounded-2xl border border-[#D7E8F8]/70 bg-white/70 p-4">
              <p className="text-sm font-black text-[#071D3A]">{node}</p>
              <p className="mt-1 text-xs font-semibold text-[#607A94]">Operational signal</p>
            </div>
          ))}
        </div>

        <div className="absolute left-1/2 top-[46%] hidden -translate-x-1/2 -translate-y-1/2 sm:block">
          <div className="relative grid h-44 w-44 place-items-center rounded-full border border-[#0A66C2]/20 bg-[#0A66C2]/[0.08] shadow-[inset_0_0_42px_rgba(10,102,194,0.08)]">
            <div className="absolute h-32 w-32 rounded-full border border-[#3FA9F5]/25 bg-white/50" />
            <div className="relative max-w-[120px] text-center text-sm font-black leading-5 text-[#0A3A7A]">
              Omnivyra operational layer
            </div>
          </div>
        </div>

        <div className="relative mt-5 overflow-hidden rounded-[24px] bg-[#0A66C2] p-5 text-white shadow-[0_18px_38px_rgba(10,102,194,0.20)] sm:absolute sm:inset-x-0 sm:bottom-0 sm:mt-0">
          <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#BFE5FF]">Connected visibility intelligence</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {['Guided priorities', 'Operational clarity', 'Discoverability context'].map((item) => (
              <div key={item} className="rounded-2xl border border-white/20 bg-white/10 p-4 text-sm font-black">{item}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TransformationRows() {
  return (
    <div className="relative mx-auto mt-10 max-w-5xl overflow-hidden rounded-[30px] border border-[#CBE2F7] bg-white/[0.90] p-5 shadow-[0_18px_56px_rgba(8,68,138,0.08)] backdrop-blur">
      <SignalMemory />
      <div className="pointer-events-none absolute bottom-16 left-7 top-16 hidden w-px bg-gradient-to-b from-[#0A66C2]/10 via-[#0A66C2]/34 to-[#0A66C2]/10 sm:block" />
      {TRANSFORMATIONS.map(([before, after], index) => (
        <div key={before} className="relative grid gap-3 py-3 pl-0 sm:grid-cols-[52px_1fr] sm:items-stretch">
          <div className="solution-node-drift relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[#0A66C2] text-sm font-black text-white shadow-[0_10px_24px_rgba(10,102,194,0.22)] sm:mt-4">
            {String(index + 1).padStart(2, '0')}
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-[#D7E8F8] bg-[#F7FBFF]/72 p-4">
            <div className="grid gap-3 sm:grid-cols-[0.82fr_1.18fr] sm:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#607A94]">Starts as</p>
                <p className="mt-1 text-lg font-black text-[#071D3A]">{before}</p>
              </div>
              <div className="rounded-2xl border border-[#0A66C2]/30 bg-[#0A66C2] px-4 py-4 text-white shadow-[0_14px_30px_rgba(10,102,194,0.16)]">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#BFE5FF]">Synchronizes into</p>
                <p className="mt-1 text-lg font-black">{after}</p>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SolutionsPage() {
  const [activeRoleId, setActiveRoleId] = useState<RoleId>('founder');
  const [activeStep, setActiveStep] = useState(0);
  const activeRole = ROLES.find((role) => role.id === activeRoleId) ?? ROLES[0];
  const activeStepContent = activeRole.steps[STEPS[activeStep].id];
  const activeAtmosphere = roleAtmospheres[activeRole.id];

  function selectRole(role: Role) {
    setActiveRoleId(role.id);
    setActiveStep(0);
  }

  return (
    <>
      <Head>
        <title>Solutions for Scaling Marketing Operations | Omnivyra</title>
        <meta
          name="description"
          content="Explore how Omnivyra helps founders, marketing leads, growth teams, creators, agencies, and solo operators scale marketing operations with operational intelligence."
        />
      </Head>

      <main className="relative isolate overflow-x-hidden bg-[#F7FBFF] text-[#071D3A]">
        <OperationalAtmosphere />
        <section className="relative z-10 overflow-hidden" style={{ background: BLUE_FIELD }}>
          <SignalMemory dark />
          <div className="absolute left-1/2 top-0 h-[360px] w-[70%] -translate-x-1/2 bg-[#3FA9F5]/[0.08] blur-3xl" />
          <div className="relative mx-auto max-w-[1280px] px-6 py-12 text-center lg:px-8 lg:py-14">
            <p className="inline-flex rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.28em] text-[#D6F0FF] backdrop-blur">
              Solutions
            </p>
            <h1 className="mx-auto mt-5 max-w-5xl text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-5xl lg:text-[3.35rem]">
              Marketing operations rarely fail from lack of effort.
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-7 text-[#EAF6FF] sm:text-lg">
              They fail because systems, visibility, execution, and intelligence do not move together. Omnivyra helps each role experience connected operational intelligence inside the way marketing actually runs.
            </p>
            <div className="mt-7">
              <PrimaryCtas />
            </div>
          </div>
        </section>

        <section className="relative z-10 border-b border-[#D7E8F8]" style={{ background: activeAtmosphere }}>
          <SignalMemory />
          <div className="relative mx-auto max-w-[1280px] px-6 py-8 lg:px-8 lg:py-11">
            <RoleSelector activeRole={activeRole} onSelect={selectRole} />

            <div className="mt-10 grid gap-6 lg:grid-cols-[286px_1fr] lg:items-start">
              <ProgressNavigator activeStep={activeStep} setActiveStep={setActiveStep} activeRole={activeRole} />
              <GuidedPanel role={activeRole} step={activeStepContent} />
            </div>
          </div>
        </section>

        <section className="relative z-10 bg-white/[0.92]">
          <SignalMemory />
          <div className="mx-auto max-w-[1280px] px-6 py-12 lg:px-8 lg:py-14">
            <div className="max-w-5xl">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-[#0A66C2]">Why this matters</p>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
                Most marketing operations were never designed to work together.
              </h2>
              <p className="mt-7 text-xs font-black uppercase tracking-[0.22em] text-[#0A66C2]">The operating reality</p>
              <p className="mt-3 max-w-3xl text-lg leading-8 text-[#496179]">
                Teams use separate systems for content, campaigns, publishing, discoverability, analytics, and reporting,
                but operational understanding rarely moves together.
              </p>
            </div>

            <div className="mt-8 grid gap-8 lg:grid-cols-[0.55fr_1.45fr] lg:items-stretch">
              <div className="flex flex-col">
                <div className="grid flex-1 gap-1">
                  {[
                    ['Fragmented execution', 'Work moves, but the operating pattern is hard to see.'],
                    ['Delayed decisions', 'Reports arrive after the moment to act has passed.'],
                    ['Discoverability blind spots', 'Visibility gaps stay hidden until growth slows.'],
                  ].map(([title, body]) => (
                    <div key={title} className="relative border-l border-[#0A66C2]/20 px-5 py-5">
                      <span className="absolute -left-[5px] top-7 h-2.5 w-2.5 rounded-full bg-[#0A66C2]/45" />
                      <p className="text-sm font-black text-[#0A66C2]">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-[#496179]">{body}</p>
                    </div>
                  ))}
                </div>
              </div>
              <FragmentedFlow />
            </div>
          </div>
        </section>

        <section className="relative z-10 bg-[#F7FBFF]/[0.92]">
          <SignalMemory />
          <div className="relative mx-auto max-w-[1280px] px-6 py-16 lg:px-8 lg:py-20">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-[#0A66C2]">Outcome-driven operations</p>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-4xl">
                Built for operational outcomes, not isolated dashboards.
              </h2>
            </div>
            <TransformationRows />
            <div className="mx-auto mt-8 max-w-3xl rounded-[26px] border border-[#CBE2F7] bg-white/[0.82] p-5 text-center shadow-[0_14px_36px_rgba(8,68,138,0.06)] backdrop-blur">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#0A66C2]">Future evolution</p>
              <p className="mt-3 text-sm font-semibold leading-7 text-[#496179]">
                Operational intelligence is still evolving through deeper forecasting, contextual analysis, and connected
                decision support. Our goal is to empower teams to operate with clearer visibility, stronger operational
                understanding, and increasingly intelligent marketing execution.
              </p>
            </div>
          </div>
        </section>

        <section className="relative z-10 bg-white/[0.92]">
          <SignalMemory />
          <div className="mx-auto max-w-[1280px] px-6 py-16 lg:px-8 lg:py-20">
            <div className="grid gap-5 lg:grid-cols-3">
              {TESTIMONIALS.map((item) => (
                <figure key={item.name} className="relative overflow-hidden rounded-[26px] border border-[#CBE2F7] bg-white/[0.90] p-6 shadow-[0_18px_46px_rgba(8,68,138,0.09)] backdrop-blur">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#0A66C2]/35 to-transparent" />
                  <blockquote className="text-lg font-black leading-8 text-[#071D3A]">"{item.quote}"</blockquote>
                  <figcaption className="mt-5 border-t border-[#D7E8F8] pt-4">
                    <p className="font-black text-[#0A66C2]">{item.name}</p>
                    <p className="text-sm text-[#496179]">{item.role}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="relative z-10 overflow-hidden" style={{ background: BLUE_FIELD }}>
          <SignalMemory dark />
          <div className="absolute left-1/2 top-0 h-[300px] w-[70%] -translate-x-1/2 bg-[#3FA9F5]/[0.08] blur-3xl" />
          <div className="relative mx-auto max-w-[900px] px-6 py-16 text-center lg:px-8 lg:py-20">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-[#D6F0FF]">Start simple</p>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-5xl">
              Start with your Visibility Snapshot.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#EAF6FF]">
              Create an account, complete your company profile, request the snapshot, and use free credits to explore the workflow layer.
            </p>
            <div className="mt-9">
              <PrimaryCtas />
            </div>
          </div>
        </section>
      </main>

      <CinematicFooter />
      <style jsx global>{`
        @keyframes solutionSignalDrift {
          0%,
          100% {
            stroke-dashoffset: 0;
            opacity: 0.5;
          }
          50% {
            stroke-dashoffset: -38;
            opacity: 0.88;
          }
        }

        @keyframes solutionSignalBreathe {
          0%,
          100% {
            opacity: 0.28;
          }
          50% {
            opacity: 0.66;
          }
        }

        @keyframes solutionNodeDrift {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(0, -4px, 0);
          }
        }

        @keyframes solutionReveal {
          from {
            opacity: 0.88;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .solution-signal-drift {
          animation: solutionSignalDrift 15s ease-in-out infinite;
        }

        .solution-signal-drift-slow {
          animation: solutionSignalDrift 19s ease-in-out infinite reverse;
        }

        .solution-signal-breathe {
          animation: solutionSignalBreathe 9s ease-in-out infinite;
        }

        .solution-node-drift {
          animation: solutionNodeDrift 10s ease-in-out infinite;
        }

        .solution-reveal {
          animation: solutionReveal 420ms ease-out both;
        }

        @media (prefers-reduced-motion: reduce) {
          .solution-signal-drift,
          .solution-signal-drift-slow,
          .solution-signal-breathe,
          .solution-node-drift,
          .solution-reveal {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}
