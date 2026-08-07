/** Part 1/2 of solutions.tsx — verbatim split (barrel preserved; importers unchanged). */
'use client';

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';


export const BLUE_FIELD = 'linear-gradient(150deg, #071D3A 0%, #0A3770 54%, #0A66C2 100%)';

export type RoleId = 'founder' | 'marketing' | 'growth' | 'creator' | 'agency' | 'solo';
type StepId = 'challenge' | 'visibility' | 'intelligence' | 'outcomes' | 'actions';
export type SignalState = 'good' | 'watch' | 'build';

export type StepContent = {
  title: string;
  summary: string;
  pain: string;
  connects: string[];
  changes: string[];
  metrics: { value: string; label: string }[];
  recommendations: string[];
};

export type Role = {
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

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'challenge', label: 'Operational Challenges' },
  { id: 'visibility', label: 'Missing Visibility' },
  { id: 'intelligence', label: 'Operational Intelligence' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'actions', label: 'Recommended Actions' },
];

export const ROLES: Role[] = [
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

export const TRANSFORMATIONS = [
  ['Disconnected tools', 'Connected operational intelligence'],
  ['Reactive decisions', 'Guided priorities'],
  ['Fragmented discoverability', 'Unified visibility intelligence'],
  ['Reporting chaos', 'Operational clarity'],
];

export const TESTIMONIALS = [
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

export const stateStyles: Record<SignalState, string> = {
  good: 'border-[#9BD6FF] bg-[#E8F7FF] text-[#075FAE]',
  watch: 'border-[#CBE2F7] bg-white text-[#0A3A7A]',
  build: 'border-[#0A66C2] bg-[#0A66C2] text-white',
};

export const roleAtmospheres: Record<RoleId, string> = {
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

export function OperationalAtmosphere() {
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

export function SignalMemory({ dark = false }: { dark?: boolean }) {
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

export function PrimaryCtas() {
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

export function CinematicFooter() {
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
              <img width={465} height={144} src="/logo.webp" alt="Omnivyra" className="h-12 w-auto object-contain" />
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

export function RoleSelector({
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

export function ProgressNavigator({
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

