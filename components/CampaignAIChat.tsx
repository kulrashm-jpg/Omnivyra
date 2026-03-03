import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Send, 
  FileText, 
  X,
  Minimize2,
  Maximize2,
  Settings,
  Zap,
  AlertCircle,
  CheckCircle,
  Loader2,
  Brain,
  Sparkles,
  BookOpen,
  TrendingUp,
  Target,
  Calendar,
  Save,
  PenTool
} from 'lucide-react';
import ChatVoiceButton from './ChatVoiceButton';
import AIGenerationProgress from './AIGenerationProgress';
import { fetchWithAuth } from './community-ai/fetchWithAuth';
import { getFormatLineForContentType, getIntentLabelForContentType } from '../utils/formatLineForContentType';

/** True when the user message indicates they're ready for the final weekly plan (not just answering a question). */
function isFinalPlanSubmissionMessage(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  if (/(create my plan|i'?m ready|i am ready|generate (my )?plan|ready to generate|build (my )?plan|submit|go ahead|generate it|yes,? generate|generate the plan)/.test(t)) return true;
  if (/^\s*(yes|ok|go)\s*$/i.test(t)) return true;
  // "Yes, proceed with 4 weeks." / "Proceed with 12 weeks." / "Use 8 weeks instead."
  if (/(yes,?\s*)?proceed with \d+\s*weeks?/i.test(t)) return true;
  if (/use \d+\s*weeks?\s*(instead)?/i.test(t)) return true;
  // Bare duration after "create your week plan now?" (e.g. "4 weeks", "8 weeks")
  if (/^\s*\d{1,2}\s*weeks?\s*$/i.test(t)) return true;
  if (/^\s*sure\s*$/i.test(t)) return true;
  return false;
}

/** Expected and max seconds for weekly plan generation by campaign length (2–12 weeks). Longer = more complexity. */
function getWeeklyPlanTimingByWeeks(weeks: number): { expectedSeconds: number; maxSecondsHint: number } {
  const w = Math.min(12, Math.max(2, Math.floor(weeks)));
  if (w <= 2) return { expectedSeconds: 50, maxSecondsHint: 120 };   // 2 weeks: ~1 min typical, up to 2 min
  if (w <= 4) return { expectedSeconds: 75, maxSecondsHint: 180 };   // 4 weeks: ~1.25 min typical, up to 3 min
  if (w <= 8) return { expectedSeconds: 105, maxSecondsHint: 240 };  // 8 weeks: ~1.75 min typical, up to 4 min
  return { expectedSeconds: 135, maxSecondsHint: 300 };               // 12 weeks: ~2.25 min typical, up to 5 min
}

function formatPlanMarkersForDisplay(raw: string): string {
  const t = String(raw ?? '');
  if (!t) return '';
  // Keep backend markers for parsing, but do not show them to the user.
  // Replace the end marker with user-friendly text.
  return t
    .replace(/^\s*BEGIN_12WEEK_PLAN\s*$/gmi, '')
    .replace(/^\s*END_12WEEK_PLAN\s*$/gmi, 'END of your weekly plan')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Renders AI message with proper structure: greeting, objective, theme, formats, reach, question */
function FormattedAIMessage({ message, className = '' }: { message: string; className?: string }) {
  const renderInline = (text: string): React.ReactNode => {
    const segments: React.ReactNode[] = [];
    let s = text;
    while (s) {
      const bi = s.indexOf('**');
      const ii = s.indexOf('*');
      const nextBi = bi >= 0 ? bi : s.length;
      const nextIi = (ii >= 0 && (ii !== 0 || s[1] !== '*')) ? ii : s.length;
      const next = Math.min(nextBi, nextIi);
      if (next < s.length) {
        if (next > 0) segments.push(s.slice(0, next));
        if (s[next] === '*') {
          if (s[next + 1] === '*') {
            const end = s.indexOf('**', next + 2);
            if (end >= 0) {
              segments.push(<strong key={segments.length}>{s.slice(next + 2, end)}</strong>);
              s = s.slice(end + 2);
              continue;
            }
          } else {
            const end = s.indexOf('*', next + 1);
            if (end >= 0 && end !== next + 1) {
              segments.push(<em key={segments.length}>{s.slice(next + 1, end)}</em>);
              s = s.slice(end + 1);
              continue;
            }
          }
        }
      }
      segments.push(s);
      break;
    }
    return <>{segments}</>;
  };
  const displayMessage = formatPlanMarkersForDisplay(message);
  const paragraphs = displayMessage.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={`text-sm space-y-4 leading-relaxed ${className}`}>
      {paragraphs.map((p, i) => {
        const isGreeting = p.startsWith('Hello!') || (i === 0 && p.includes('help you turn'));
        const isTheme = p.startsWith('I see your theme:');
        const isSection = /^\*\*(Target regions|Suggested formats|Estimated reach)/.test(p);
        const isQuestion = /^\*\*(First question|Next question|Question \d+):/i.test(p);
        return (
          <div
            key={i}
            className={
              isGreeting ? 'font-semibold text-gray-900' :
              isTheme ? 'italic text-gray-700 pl-1 border-l-2 border-indigo-200' :
              isSection ? 'text-gray-800' :
              isQuestion ? 'font-semibold text-indigo-800 mt-2 pt-2 border-t border-gray-200' :
              'text-gray-700'
            }
          >
            {renderInline(p)}
          </div>
        );
      })}
    </div>
  );
}

interface ChatMessage {
  id: number;
  type: 'user' | 'ai';
  message: string;
  timestamp: string;
  attachments?: string[];
  provider?: string;
  campaignId?: string;
}

interface CampaignLearning {
  campaignId: string;
  campaignName: string;
  goals: any[];
  performance: {
    engagement: number;
    reach: number;
    conversions: number;
    actualResults: any[];
  };
  learnings: string[];
  improvements: string[];
}

interface RecommendationContext {
  target_regions?: string[] | null;
  context_payload?: Record<string, unknown> | null;
  source_opportunity_id?: string | null;
  /** Topic/title from the recommendation card when campaign was built from a theme (replaces generic "Campaign from themes"). */
  topic_from_card?: string | null;
}

interface AIChatProps {
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
  context?: string;
  companyId?: string;
  campaignId?: string;
  campaignData?: any;
  recommendationContext?: RecommendationContext | null;
  onProgramGenerated?: (program: any) => void;
  /** Stage 29: Governance lockdown — schedule button disabled */
  governanceLocked?: boolean;
  /** Stage 35: ROI + optimization headlines for AI context injection */
  optimizationContext?: { roiScore: number; headlines: string[] };
  /** Pre-filled planning context from campaign setup — AI will skip these questions */
  prefilledPlanning?: Record<string, unknown> | null;
  /** Existing plan when refining (avoids re-asking; skips to refine mode) */
  initialPlan?: { weeks: any[] } | null;
  /** Render as full-page embedded view (no overlay) for new-tab usage */
  standalone?: boolean;
  /** Pre-selected weeks and areas from recommendations page (skips scope questions) */
  vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
  /** Client-collected planning context (form, pre-planning result) — merged server-side to avoid re-asking */
  collectedPlanningContext?: Record<string, unknown> | null;
  /** Force fresh planning chat once (ignore cached/loaded history). */
  forceFreshPlanningThread?: boolean;
}

type AIProvider = 'gpt' | 'claude' | 'demo';

/** Progressive flow: show primary options first, then compatible secondaries only. */
type ProgressiveStyleConfig = {
  primaryOptions: string[];
  secondaryByPrimary: Record<string, string[]>;
  /** Hover tooltip per primary option (words/characters guidance). */
  primaryTooltips?: Record<string, string>;
  /** Hover tooltip per secondary option. */
  secondaryTooltips?: Record<string, string>;
};

type QuickPickConfig = {
  key:
    | 'campaign_duration'
    | 'target_audience'
    | 'available_content'
    | 'audience_professional_segment'
    | 'communication_style'
    | 'action_expectation'
    | 'content_depth'
    | 'topic_continuity'
    | 'platforms'
    | 'platform_content_types'
    | 'platform_content_requests'
    | 'exclusive_campaigns'
    | 'campaign_types'
    | 'success_metrics'
    | 'tentative_start'
    | 'content_capacity';
  multi: boolean;
  options: string[];
  /** When set, use primary-then-secondary flow; primary is one, secondaries limited by compatibility. */
  progressiveStyle?: ProgressiveStyleConfig;
  /** Optional short hint shown above options (e.g. "Pick one; a 1–2 line answer is fine."). */
  helperText?: string;
  /** Optional one-line description per option (key = option label). Shown as title or caption. */
  optionDescriptions?: Record<string, string>;
  /** Optional hover tooltip per option (words/characters guidance). */
  optionTooltips?: Record<string, string>;
};

/** Primary communication styles. Pick one or two; "Simple & easy" and "Deep & thoughtful" describe different depth levels — avoid picking both. */
const COMMUNICATION_STYLE_PRIMARY = [
  'Simple & easy',
  'Professional & expert',
  'Friendly & conversational',
  'Bold & opinionated',
  'Deep & thoughtful',
] as const;

const COMMUNICATION_STYLE_SECONDARY_BY_PRIMARY: Record<string, string[]> = {
  'Simple & easy': ['Direct & no-fluff', 'Story-driven', 'Inspiring & motivational'],
  'Professional & expert': ['Data-driven', 'Direct & no-fluff', 'Deep & thoughtful', 'Story-driven'],
  'Friendly & conversational': ['Story-driven', 'Inspiring & motivational', 'Witty & playful'],
  'Bold & opinionated': ['Direct & no-fluff', 'Inspiring & motivational'],
  'Deep & thoughtful': ['Story-driven', 'Data-driven', 'Professional & expert'],
};

/** Primary CTA intents (mutually exclusive). Compatible CTA actions per intent. */
const CTA_INTENT_PRIMARY = [
  'Awareness',
  'Engagement',
  'Community Building',
  'Lead Generation',
  'Conversion / Sales',
] as const;

const CTA_ACTIONS_BY_INTENT: Record<string, string[]> = {
  'Awareness': ['Like / react', 'Share with a friend/team', 'Save for later', 'Just understand the topic better'],
  'Engagement': ['Comment with an opinion', 'Share with a friend/team', 'Like / react', 'Connect'],
  'Community Building': ['Follow / subscribe', 'Join newsletter', 'Connect', 'DM us'],
  'Lead Generation': ['Download a resource', 'Visit website', 'Join newsletter', 'DM us'],
  'Conversion / Sales': ['Book a call / demo', 'Visit website', 'DM us', 'Download a resource'],
};

function extractQuestionCandidate(message: string): string {
  if (!message) return '';
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const isNoiseLine = (line: string) => /^\(required missing:/i.test(line);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (isNoiseLine(line)) continue;
    // Prefer the authoritative question sentence, even if it doesn't end with "?".
    if (line.includes('?')) return line;
    if (line.endsWith('?')) return line;
  }
  // Fallback: last non-noise line.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isNoiseLine(lines[i])) return lines[i];
  }
  return lines[lines.length - 1] || '';
}

function prettyContentTypeLabel(contentType: string): string {
  const t = String(contentType || '').trim();
  if (!t) return '';
  if (t === 'feed_post') return 'Post';
  if (t === 'tweet') return 'Post';
  if (t === 'short') return 'Short';
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const PLANNING_CONTENT_TYPE_LABELS = [
  'Posts',
  'Videos',
  'Long Videos',
  'Blogs',
  'Articles',
  'White Papers',
  'Carousels',
  'Images',
  'Stories',
  'Threads',
  'Shorts',
  'Reels',
  'Spaces',
  'Songs',
  'Audio',
  'Podcasts',
  'Newsletters',
  'Webinars',
  'Slides',
  'Slideware',
] as const;

function canonicalPlanningTypeLabel(label: string): string {
  const s = String(label || '').trim();
  if (!s) return '';
  const n = s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (n === 'post' || n === 'posts') return 'Posts';
  if (n === 'text' || n === 'texts') return 'Posts';
  if (n === 'video' || n === 'videos') return 'Videos';
  if (n === 'long video' || n === 'long videos' || n === 'long-form video' || n === 'long-form videos') return 'Long Videos';
  if (n === 'blog' || n === 'blogs') return 'Blogs';
  if (n === 'article' || n === 'articles') return 'Articles';
  if (n === 'white paper' || n === 'white papers' || n === 'whitepaper' || n === 'whitepapers') return 'White Papers';
  if (n === 'document' || n === 'documents' || n === 'pdf' || n === 'pdfs') return 'White Papers';
  if (n === 'carousel' || n === 'carousels') return 'Carousels';
  if (n === 'image' || n === 'images') return 'Images';
  if (n === 'story' || n === 'stories') return 'Stories';
  if (n === 'thread' || n === 'threads') return 'Threads';
  if (n === 'short' || n === 'shorts') return 'Shorts';
  if (n === 'reel' || n === 'reels') return 'Reels';
  // Treat live streams as video (we don't show a separate "Lives" option).
  if (n === 'live' || n === 'lives') return 'Videos';
  if (n === 'space' || n === 'spaces') return 'Spaces';
  if (n === 'song' || n === 'songs') return 'Songs';
  if (n === 'audio') return 'Audio';
  if (n === 'podcast' || n === 'podcasts') return 'Podcasts';
  if (n === 'newsletter' || n === 'newsletters') return 'Newsletters';
  if (n === 'webinar' || n === 'webinars') return 'Webinars';
  if (n === 'slide' || n === 'slides') return 'Slides';
  if (n === 'slideware') return 'Slideware';
  // Best-effort: title-case unknown labels
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function planningLabelToParseKeyAndTag(label: string): { parseKey: string; tag?: string; displayUnit?: string } {
  const canon = canonicalPlanningTypeLabel(label);
  switch (canon) {
    case 'Posts':
      return { parseKey: 'post' };
    case 'Images':
      return { parseKey: 'post', tag: 'image' };
    case 'Carousels':
      return { parseKey: 'post', tag: 'carousel' };
    case 'Videos':
      return { parseKey: 'video' };
    case 'Reels':
      return { parseKey: 'video', tag: 'reels' };
    case 'Shorts':
      return { parseKey: 'video', tag: 'shorts' };
    case 'Spaces':
      return { parseKey: 'video', tag: 'spaces' };
    case 'Songs':
      return { parseKey: 'video', tag: 'song' };
    case 'Audio':
      return { parseKey: 'video', tag: 'audio' };
    case 'Podcasts':
      return { parseKey: 'video', tag: 'podcast' };
    case 'Long Videos':
      return { parseKey: 'video', tag: 'long-form' };
    case 'Blogs':
      return { parseKey: 'blog' };
    case 'Articles':
      return { parseKey: 'blog', tag: 'article' };
    case 'White Papers':
      return { parseKey: 'blog', displayUnit: 'white paper' };
    case 'Newsletters':
      return { parseKey: 'blog', tag: 'newsletter' };
    case 'Webinars':
      return { parseKey: 'blog', tag: 'webinar' };
    case 'Slides':
    case 'Slideware':
      return { parseKey: 'blog', tag: 'slides' };
    case 'Stories':
      return { parseKey: 'story' };
    case 'Threads':
      return { parseKey: 'thread' };
    default:
      // Fallback: treat as post so capacity validation doesn't drop it
      return { parseKey: 'post', tag: canon.toLowerCase() };
  }
}

function getQuickPickConfig(question: string, platformOptions: string[]): QuickPickConfig | null {
  const q = question.toLowerCase();
  if (
    q.includes('how many weeks') ||
    q.includes('campaign run') ||
    q.includes('duration') ||
    q.includes('create your week plan now')
  ) {
    const isCreatePlanStep = q.includes('create your week plan now');
    return {
      key: 'campaign_duration',
      multi: false,
      options: ['2 weeks', '4 weeks', '8 weeks', '12 weeks'],
      ...(isCreatePlanStep && { helperText: "You're all set — pick a duration and click Submit to create your plan." }),
    };
  }
  if (q.includes('target audience') || q.includes('who will see your content')) {
    return {
      key: 'target_audience',
      multi: true,
      options: ['Professionals', 'Entrepreneurs', 'Students', 'SMB owners', 'Parents'],
    };
  }
  if ((q.includes('which professionals') && q.includes('mainly speaking')) || q.includes('which group fits')) {
    return {
      key: 'audience_professional_segment',
      multi: true,
      options: ['Managers', 'Job seekers', 'Founders', 'Corporate employees'],
    };
  }
  if (q.includes('how do you want your content to sound') || q.includes('how should your posts sound')) {
    return {
      key: 'communication_style',
      multi: true,
      helperText: 'Primary = main voice; modifiers add nuance. Tip: pick either "Simple & easy" (clear, scannable) or "Deep & thoughtful" (in-depth) as your main direction — they work best separately.',
      options: [
        'Simple & easy',
        'Professional & expert',
        'Friendly & conversational',
        'Bold & opinionated',
        'Witty & playful',
        'Deep & thoughtful',
        'Story-driven',
        'Data-driven',
        'Direct & no-fluff',
        'Inspiring & motivational',
      ],
      progressiveStyle: {
        primaryOptions: [...COMMUNICATION_STYLE_PRIMARY],
        secondaryByPrimary: COMMUNICATION_STYLE_SECONDARY_BY_PRIMARY,
        primaryTooltips: {
          'Simple & easy': 'Clear, everyday words; easy to follow. Best for short tips or scannable posts.',
          'Professional & expert': 'Structured and authoritative; you sound like the expert.',
          'Friendly & conversational': 'Warm, like talking to a friend.',
          'Bold & opinionated': 'Clear point of view; strong opening.',
          'Deep & thoughtful': 'In-depth when the topic needs it: full explanation or reflective story. Pairs well with Professional.',
        },
        secondaryTooltips: {
          'Direct & no-fluff': 'One clear ask (e.g. “Sign up” or “Read more”).',
          'Story-driven': 'Start with a short hook; posts link together.',
          'Data-driven': 'Add a number or stat when it helps.',
          'Inspiring & motivational': 'End on an uplifting note.',
          'Witty & playful': 'Light, punchy tone.',
        },
      },
    };
  }
  if ((q.includes('after reading your content') && q.includes('what should people do')) || q.includes('what do you want people to do after')) {
    return {
      key: 'action_expectation',
      multi: true,
      options: [
        'Follow / subscribe',
        'Like / react',
        'Comment with an opinion',
        'Share with a friend/team',
        'Save for later',
        'DM us',
        'Connect',
        'Visit website',
        'Download a resource',
        'Book a call / demo',
        'Join newsletter',
        'Just understand the topic better',
      ],
      progressiveStyle: {
        primaryOptions: [...CTA_INTENT_PRIMARY],
        secondaryByPrimary: CTA_ACTIONS_BY_INTENT,
        primaryTooltips: {
          'Awareness': 'Goal: people notice and remember you.',
          'Lead Generation': 'Goal: get sign-ups, demos, or contacts.',
          'Engagement': 'Goal: more likes, comments, shares.',
          'Authority': 'Goal: show expertise (e.g. download, read more).',
        },
        secondaryTooltips: {
          'Like / react': 'Ask for a like or reaction.',
          'Visit website': 'Link to your site + one short line.',
          'Book a call / demo': 'One clear button or line to book.',
        },
      },
    };
  }
  if (q.includes('short easy reads') || q.includes('detailed insights') || q.includes('short reads or longer') || q.includes('longer pieces')) {
    return {
      key: 'content_depth',
      multi: false,
      options: ['Short & quick', 'Medium detail', 'Deep explanation'],
      helperText: 'Pick one.',
      optionDescriptions: {
        'Short & quick': 'Tips, takeaways; a few lines.',
        'Medium detail': 'Clear sections; not too long.',
        'Deep explanation': 'Full guides; in-depth read.',
      },
      optionTooltips: {
        'Short & quick': 'Like a tip: a few lines, easy to scan.',
        'Medium detail': 'A few short sections with headings.',
        'Deep explanation': 'Longer piece; full story or guide.',
      },
    };
  }
  if ((q.includes('connected series') && q.includes('mostly independent')) || q.includes('ongoing story') || q.includes('different topics each time')) {
    return {
      key: 'topic_continuity',
      multi: false,
      options: ['Connected series', 'Mostly independent', 'Mix of both'],
      helperText: 'Pick one.',
      optionDescriptions: {
        'Connected series': 'Posts link together (e.g. weekly thread).',
        'Mostly independent': 'Each post is its own topic.',
        'Mix of both': 'Some threads + one-off posts.',
      },
      optionTooltips: {
        'Connected series': 'Same thread or story; people follow along.',
        'Mostly independent': 'New topic each time; no order needed.',
        'Mix of both': 'A few series plus standalone posts.',
      },
    };
  }
  if (q.includes('existing content') || q.includes('do you have any existing content') || q.includes('content for this campaign')) {
    return {
      key: 'available_content',
      multi: true,
      options: Array.from(PLANNING_CONTENT_TYPE_LABELS),
    };
  }
  if (q.includes('which platforms') || q.includes('platforms will you focus') || q.includes('where will you post')) {
    return {
      key: 'platforms',
      multi: true,
      options: platformOptions.length > 0 ? platformOptions : [],
    };
  }
  if (
    (q.includes('content types') && q.includes('count per week')) ||
    q.includes('set how often') ||
    q.includes('same topic across platforms') ||
    q.includes('publish same day on all platforms') ||
    q.includes('let AI decide')
  ) {
    return {
      key: 'platform_content_requests',
      multi: true,
      options: [],
    };
  }
  if (q.includes('platform-exclusive campaigns') || q.includes('anything only for one platform')) {
    return {
      key: 'exclusive_campaigns',
      multi: true,
      options: [],
    };
  }
  if (
    (q.includes('content types') && q.includes('platform')) ||
    q.includes('which content types will you use') ||
    q.includes('for each platform you selected')
  ) {
    return {
      key: 'platform_content_types',
      multi: true,
      options: [],
    };
  }
  if (q.includes('campaign types')) {
    return {
      key: 'campaign_types',
      multi: true,
      options: ['Brand awareness', 'Lead generation', 'Authority positioning', 'Engagement growth', 'Product promotion'],
    };
  }
  if ((q.includes('start') && q.includes('date')) || q.includes('yyyy-mm-dd')) {
    return {
      key: 'tentative_start',
      multi: false,
      options: [],
    };
  }
  if (
    q.includes('content capacity') ||
    q.includes('production capacity') ||
    q.includes('content can you create') ||
    q.includes('create each week') ||
    q.includes('produce each week') ||
    q.includes('how much content') ||
    q.includes('what can your team produce') ||
    q.includes('how will you create') ||
    q.includes('how many pieces per week')
  ) {
    return {
      key: 'content_capacity',
      multi: true,
      // Will be overridden at runtime with the full catalog-derived list (same as availability).
      options: Array.from(PLANNING_CONTENT_TYPE_LABELS),
    };
  }
  if (q.includes('success metrics') || (q.includes('metrics') && q.includes('track'))) {
    return {
      key: 'success_metrics',
      multi: true,
      options: ['Reach', 'Engagement', 'Leads', 'Bookings', 'Followers'],
    };
  }
  return null;
}

function computeEligiblePlanningTypeSet(hints: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of hints || []) {
    const canon = canonicalPlanningTypeLabel(raw);
    if (canon) out.add(canon);
  }
  return out;
}

function extractPlanningTypeHintsFromCapacityValue(value: unknown): string[] {
  const out = new Set<string>();

  const add = (label: string) => {
    const canon = canonicalPlanningTypeLabel(label);
    if (canon) out.add(canon);
  };

  const text = typeof value === 'string' ? value : '';
  if (text) {
    const t = text.toLowerCase();
    const hasPositive = (re: RegExp): boolean => {
      let m: RegExpExecArray | null = null;
      while ((m = re.exec(t)) !== null) {
        const n = Number(m[1] || 0);
        if (Number.isFinite(n) && n > 0) return true;
      }
      return false;
    };

    if (hasPositive(/\b(\d{1,3})\s*white\s*papers?\b/g) || hasPositive(/\b(\d{1,3})\s*whitepapers?\b/g)) add('White Papers');
    if (hasPositive(/\b(\d{1,3})\s*blogs?\b/g)) add('Blogs');
    if (hasPositive(/\b(\d{1,3})\s*articles?\b/g)) add('Articles');
    if (hasPositive(/\b(\d{1,3})\s*(?:posts?|feed\s*posts?)\b/g)) add('Posts');
    if (hasPositive(/\b(\d{1,3})\s*videos?\b/g)) add('Videos');
    if (hasPositive(/\b(\d{1,3})\s*reels?\b/g)) add('Reels');
    if (hasPositive(/\b(\d{1,3})\s*shorts?\b/g)) add('Shorts');
    if (hasPositive(/\b(\d{1,3})\s*threads?\b/g)) add('Threads');
    if (hasPositive(/\b(\d{1,3})\s*stories?\b/g)) add('Stories');
    if (hasPositive(/\b(\d{1,3})\s*carousels?\b/g)) add('Carousels');
    if (hasPositive(/\b(\d{1,3})\s*images?\b/g)) add('Images');
    if (hasPositive(/\b(\d{1,3})\s*podcasts?\b/g)) add('Podcasts');
    if (hasPositive(/\b(\d{1,3})\s*(?:audio|songs?)\b/g)) add('Audio');
    if (hasPositive(/\b(\d{1,3})\s*spaces?\b/g)) add('Spaces');
    if (hasPositive(/\b(\d{1,3})\s*(?:slides?|slideware)\b/g)) add('Slides');
    return Array.from(out);
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const num = (v: unknown) => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    };

    if (num(obj.post) > 0) add('Posts');
    if (num(obj.video) > 0) add('Videos');
    if (num(obj.blog) > 0) add('Blogs');
    if (num(obj.story) > 0) add('Stories');
    if (num(obj.thread) > 0) add('Threads');

    const breakdown = obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)
      ? (obj.breakdown as Record<string, unknown>)
      : null;
    if (breakdown) {
      const map: Record<string, string> = {
        reels: 'Reels',
        shorts: 'Shorts',
        long_videos: 'Long Videos',
        carousels: 'Carousels',
        images: 'Images',
        white_papers: 'White Papers',
        articles: 'Articles',
        newsletters: 'Newsletters',
        webinars: 'Webinars',
        slides: 'Slides',
        podcasts: 'Podcasts',
        audio: 'Audio',
        spaces: 'Spaces',
      };
      for (const [k, v] of Object.entries(breakdown)) {
        if (num(v) <= 0) continue;
        const label = map[String(k || '').toLowerCase()];
        if (label) add(label);
      }
    }
  }

  return Array.from(out);
}

function isEligiblePlanningType(candidate: string, eligible: Set<string>): boolean {
  // If we have no eligibility signals yet, be conservative: don't show video formats.
  // This prevents "Video/Reels" leaking when availability/capacity is missing/skipped.
  if (eligible.size === 0) {
    const c0 = canonicalPlanningTypeLabel(candidate);
    if (!c0) return false;
    return ['Posts', 'Images', 'Carousels', 'Blogs', 'Articles', 'White Papers', 'Threads', 'Stories'].includes(c0);
  }
  const c = canonicalPlanningTypeLabel(candidate);
  if (!c) return false;
  if (eligible.has(c)) return true;

  // Rollups: if you can do Videos, you can pick specific video formats.
  if (eligible.has('Videos') && ['Reels', 'Shorts', 'Long Videos', 'Spaces', 'Audio', 'Podcasts'].includes(c)) return true;
  // Rollups: if you can do Posts, you can pick specific post formats.
  if (eligible.has('Posts') && ['Images', 'Carousels'].includes(c)) return true;
  // Rollups: if you can do Blogs, you can pick specific written formats.
  if (
    eligible.has('Blogs') &&
    ['Articles', 'White Papers', 'Newsletters', 'Webinars', 'Slides', 'Slideware'].includes(c)
  ) {
    return true;
  }
  // If you can do a subtype, also allow picking the rollup.
  if (c === 'Articles' && eligible.has('Articles')) return true;
  if (c === 'Blogs' && eligible.has('Articles')) return true;
  return false;
}

function getPlatformSupportedPlanningTypes(platform: string, platformContentTypeOptions: Record<string, string[]>): Set<string> {
  const key = String(platform || '').toLowerCase().trim();
  const raw = platformContentTypeOptions[key] || [];
  const supportedCanon = new Set<string>(raw.map(canonicalPlanningTypeLabel).filter(Boolean));

  // If platform intelligence is incomplete, provide conservative fallbacks for major platforms.
  if (key === 'linkedin') {
    ['Posts', 'Images', 'Carousels', 'Videos', 'Articles', 'White Papers'].forEach((t) => supportedCanon.add(t));
  } else if (key === 'facebook') {
    ['Posts', 'Images', 'Carousels', 'Videos', 'Reels', 'Stories'].forEach((t) => supportedCanon.add(t));
  } else if (key === 'instagram') {
    ['Posts', 'Images', 'Carousels', 'Videos', 'Reels', 'Stories'].forEach((t) => supportedCanon.add(t));
  } else if (key === 'x' || key === 'twitter') {
    ['Posts', 'Threads', 'Spaces', 'Videos'].forEach((t) => supportedCanon.add(t));
  } else if (key === 'youtube') {
    ['Videos', 'Long Videos', 'Shorts'].forEach((t) => supportedCanon.add(t));
  }

  // Expand supported rollups for nicer UX.
  if (supportedCanon.has('Articles') || supportedCanon.has('White Papers')) supportedCanon.add('Blogs');
  if (supportedCanon.has('Images') || supportedCanon.has('Carousels')) supportedCanon.add('Posts');
  if (supportedCanon.has('Reels') || supportedCanon.has('Shorts') || supportedCanon.has('Long Videos')) supportedCanon.add('Videos');

  return supportedCanon;
}

/** Returns all content-type keys (catalog raw + any supported canonical not in catalog) so the capacity grid shows every type the platform supports (e.g. Carousel, Image for Facebook). */
function getAllSupportedContentTypeKeysForPlatform(
  platform: string,
  platformContentTypeRawOptions: Record<string, string[]>,
  platformContentTypeOptions: Record<string, string[]>
): string[] {
  const rawFromCatalog = platformContentTypeRawOptions[platform] || [];
  const supportedCanon = getPlatformSupportedPlanningTypes(platform, platformContentTypeOptions);
  const covered = new Set(
    rawFromCatalog.map((r) => canonicalPlanningTypeLabel(prettyContentTypeLabel(r))).filter(Boolean)
  );
  const additional = Array.from(supportedCanon).filter((c) => !covered.has(c));
  return [...rawFromCatalog, ...additional];
}

function getEligiblePlatformPlanningTypeOptions(args: {
  platform: string;
  platformContentTypeOptions: Record<string, string[]>;
  eligible: Set<string>;
}): string[] {
  const supported = getPlatformSupportedPlanningTypes(args.platform, args.platformContentTypeOptions);
  const list = Array.from(supported).filter((opt) => isEligiblePlanningType(opt, args.eligible));
  // Stable, human-friendly ordering.
  const priority = new Map<string, number>([
    ['Posts', 1],
    ['Images', 2],
    ['Carousels', 3],
    ['Blogs', 4],
    ['Articles', 5],
    ['White Papers', 6],
    ['Videos', 7],
    ['Reels', 8],
    ['Shorts', 9],
    ['Long Videos', 10],
    ['Stories', 11],
    ['Threads', 12],
    ['Spaces', 13],
    ['Audio', 14],
    ['Podcasts', 15],
    ['Newsletters', 16],
    ['Webinars', 17],
    ['Slides', 18],
    ['Slideware', 19],
  ]);
  return list.sort((a, b) => (priority.get(a) ?? 999) - (priority.get(b) ?? 999) || a.localeCompare(b));
}

const CAMPAIGN_AI_PROVIDER_KEY = 'virality-campaign-ai-provider';

function getStoredProvider(): AIProvider {
  if (typeof window === 'undefined') return 'claude';
  const s = localStorage.getItem(CAMPAIGN_AI_PROVIDER_KEY);
  if (s === 'gpt' || s === 'claude' || s === 'demo') return s;
  return 'claude';
}

type StructuredDay = {
  day: string;
  objective: string;
  content: string;
  platforms: Record<string, string>;
  hashtags?: string[];
  seo_keywords?: string[];
  meta_title?: string;
  meta_description?: string;
  hook?: string;
  cta?: string;
  best_time?: string;
  effort_score?: number;
  success_projection?: number;
};

type StructuredWeek = {
  week: number;
  theme?: string;
  daily?: StructuredDay[];
  /** Blueprint format fields */
  phase_label?: string;
  topics_to_cover?: string[];
  primary_objective?: string;
  platform_allocation?: Record<string, number>;
  content_type_mix?: string[];
  cta_type?: string;
  total_weekly_content_count?: number;
  weekly_kpi_focus?: string;
  /** Per-platform content types. Shared items (platforms.length>1) appear under each platform. */
  platform_content_breakdown?: Record<string, Array<{ type: string; count: number; topic?: string; topics?: string[]; platforms?: string[] }>>;
  platform_topics?: Record<string, string[]>;
  weeklyContextCapsule?: {
    audienceProfile?: string;
    weeklyIntent?: string;
    toneGuidance?: string;
    campaignStage?: string;
    psychologicalGoal?: string;
  };
  topics?: Array<{
    topicTitle?: string;
    whoAreWeWritingFor?: string;
    whatProblemAreWeAddressing?: string;
    whatShouldReaderLearn?: string;
    desiredAction?: string;
    narrativeStyle?: string;
    topicContext?: {
      writingIntent?: string;
    };
    contentTypeGuidance?: {
      primaryFormat?: string;
      maxWordTarget?: number;
      platformWithHighestLimit?: string;
    };
  }>;
  resolved_postings?: Array<{
    posting_id?: string;
    posting_order?: number;
    execution_id?: string;
    platform?: string;
    content_type?: string;
    progression_step?: number;
    global_progression_index?: number;
    narrative_position?: string;
    narrative_role?: string;
    format_validation_warning?: boolean;
    alignment_reason?: string[];
    writer_content_brief?: {
      format_requirements?: {
        format_family?: string;
      };
    };
  }>;
};

type StructuredPlan = {
  weeks: StructuredWeek[];
  format?: 'blueprint' | 'legacy';
};

type RefinedDay = {
  week: number;
  day: string;
  objective: string;
  content: string;
  platforms: Record<string, string>;
  hashtags?: string[];
  seo_keywords?: string[];
  meta_title?: string;
  meta_description?: string;
  hook?: string;
  cta?: string;
  best_time?: string;
  effort_score?: number;
  success_projection?: number;
};

type PlatformCustomization = {
  day: string;
  platforms: Record<string, string>;
};

type AiHistoryEntry = {
  snapshot_hash: string;
  omnivyre_decision: any;
  structured_plan: StructuredPlan;
  scheduled_posts: Array<{
    id: string;
    platform: string;
    content: string;
    scheduled_for: string;
    status: string;
    created_at: string;
  }>;
  created_at: string;
};

export default function AIChat({ isOpen, onClose, onMinimize, context = "general", companyId, campaignId, campaignData, recommendationContext, onProgramGenerated, governanceLocked, optimizationContext, prefilledPlanning, initialPlan, standalone = false, vetScope, collectedPlanningContext, forceFreshPlanningThread = false }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [inputClearKey, setInputClearKey] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLearning, setShowLearning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(getStoredProvider);
  const [isLoading, setIsLoading] = useState(false);
  const [modeLoading, setModeLoading] = useState<Record<string, boolean>>({});
  const [uiErrorMessage, setUiErrorMessage] = useState<string | null>(null);
  const [campaignLearnings, setCampaignLearnings] = useState<CampaignLearning[]>([]);
  const [showDateSelection, setShowDateSelection] = useState(false);
  const [commitStartDate, setCommitStartDate] = useState('');
  const [commitDurationWeeks, setCommitDurationWeeks] = useState(12);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [showPlanPreview, setShowPlanPreview] = useState(false);
  const [structuredPlan, setStructuredPlan] = useState<StructuredPlan | null>(null);
  const [structuredPlanMessageId, setStructuredPlanMessageId] = useState<number | null>(null);
  const [hasGeneratedPlanInSession, setHasGeneratedPlanInSession] = useState(false);
  const [reviewWeekNumber, setReviewWeekNumber] = useState<number>(1);
  const [replaceMode, setReplaceMode] = useState(false);
  const [replaceSelection, setReplaceSelection] = useState<{ week: number; text: string } | null>(null);
  const [showScheduleConfirm, setShowScheduleConfirm] = useState(false);
  const [isSchedulingPlan, setIsSchedulingPlan] = useState(false);
  const [uiSuccessMessage, setUiSuccessMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'history' | 'audit' | 'execution' | 'content' | 'performance' | 'memory' | 'business' | 'platform'>('chat');
  const [aiHistory, setAiHistory] = useState<AiHistoryEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [auditReport, setAuditReport] = useState<any>(null);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [healthReport, setHealthReport] = useState<any>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [optimizeWeekNumber, setOptimizeWeekNumber] = useState<number>(1);
  const [optimizeReason, setOptimizeReason] = useState<string>('');
  const [isOptimizingWeek, setIsOptimizingWeek] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<any>(null);
  const [executionPlan, setExecutionPlan] = useState<any>(null);
  const [isExecutionLoading, setIsExecutionLoading] = useState(false);
  const [executionWeekNumber, setExecutionWeekNumber] = useState<number>(1);
  const [schedulerPayload, setSchedulerPayload] = useState<any>(null);
  const [contentAssets, setContentAssets] = useState<any[]>([]);
  const [isContentLoading, setIsContentLoading] = useState(false);
  const [contentWeekNumber, setContentWeekNumber] = useState<number>(1);
  const [regenerateInstruction, setRegenerateInstruction] = useState<string>('');
  const [analyticsReport, setAnalyticsReport] = useState<any>(null);
  const [learningInsights, setLearningInsights] = useState<any>(null);
  const [isPerformanceLoading, setIsPerformanceLoading] = useState(false);
  const [performanceWeekNumber, setPerformanceWeekNumber] = useState<number>(1);
  const [campaignMemory, setCampaignMemory] = useState<any>(null);
  const [memoryOverlap, setMemoryOverlap] = useState<any>(null);
  const [forecastReport, setForecastReport] = useState<any>(null);
  const [roiReport, setRoiReport] = useState<any>(null);
  const [businessReport, setBusinessReport] = useState<any>(null);
  const [isBusinessLoading, setIsBusinessLoading] = useState(false);
  const [platformIntelAssetId, setPlatformIntelAssetId] = useState<string>('');
  const [platformIntelPlatform, setPlatformIntelPlatform] = useState<string>('linkedin');
  const [platformIntelContentType, setPlatformIntelContentType] = useState<string>('text');
  const [platformIntelData, setPlatformIntelData] = useState<any>(null);
  const [isPlatformIntelLoading, setIsPlatformIntelLoading] = useState(false);
  const [hasViewedPlanMessageId, setHasViewedPlanMessageId] = useState<number | null>(null);
  const [showPlanOverview, setShowPlanOverview] = useState(false);
  const [pendingAmendment, setPendingAmendment] = useState<StructuredPlan | null>(null);
  const [isSavingDraftForView, setIsSavingDraftForView] = useState(false);
  const [retrievePlanData, setRetrievePlanData] = useState<{ savedPlan?: { content: string; savedAt: string }; committedPlan?: { weeks: any[] }; draftPlan?: { weeks: any[]; savedAt: string } } | null>(null);
  const [planSource, setPlanSource] = useState<'ai' | 'committed' | 'draft'>('ai');
  const [isRetrievePlanLoading, setIsRetrievePlanLoading] = useState(false);
  const [isParsingSavedPlan, setIsParsingSavedPlan] = useState(false);
  const [selectedQuickOptions, setSelectedQuickOptions] = useState<string[]>([]);
  const [quickPickPrimaryStyles, setQuickPickPrimaryStyles] = useState<string[]>([]);
  const [quickPickSecondaryModifiers, setQuickPickSecondaryModifiers] = useState<string[]>([]);
  const [quickCustomizeMode, setQuickCustomizeMode] = useState(false);
  const [quickCustomizeText, setQuickCustomizeText] = useState('');
  const [quickCustomContentType, setQuickCustomContentType] = useState('');
  const [quickCustomContentCount, setQuickCustomContentCount] = useState('');
  const [quickCustomPlatform, setQuickCustomPlatform] = useState('');
  const [hideQuickPickPanel, setHideQuickPickPanel] = useState(false);
  const [quickDateYear, setQuickDateYear] = useState('');
  const [quickDateMonth, setQuickDateMonth] = useState('');
  const [quickDateDay, setQuickDateDay] = useState('');
  const [quickCapacityCounts, setQuickCapacityCounts] = useState<Record<string, string>>({});
  const [planningAvailableCountsOverride, setPlanningAvailableCountsOverride] = useState<Record<string, number> | null>(null);
  const [planningCapacityCountsOverride, setPlanningCapacityCountsOverride] = useState<Record<string, number> | null>(null);
  const [quickCapacityCreationMode, setQuickCapacityCreationMode] = useState<
    '' | 'manual' | 'ai-assisted' | 'full-ai'
  >('');
  const [showAllTypeCounters, setShowAllTypeCounters] = useState<
    Record<'available_content' | 'content_capacity', boolean>
  >({
    available_content: false,
    content_capacity: false,
  });
  const [planningSelectedPlatforms, setPlanningSelectedPlatforms] = useState<string[]>([]);
  const [quickPlatformContentTypes, setQuickPlatformContentTypes] = useState<Record<string, string[]>>({});
  const [planningPlatformContentTypePrefs, setPlanningPlatformContentTypePrefs] = useState<Record<string, string[]>>({});
  const [planningPlatformContentRequests, setPlanningPlatformContentRequests] = useState<Record<string, Record<string, string>>>({});
  const [hasProvidedPlatformContentRequests, setHasProvidedPlatformContentRequests] = useState(false);
  const [planningCrossPlatformSharingEnabled, setPlanningCrossPlatformSharingEnabled] = useState(true);
  const [planningCrossPlatformScheduleMode, setPlanningCrossPlatformScheduleMode] = useState<'same_time' | 'staggered' | 'ai_recommended'>('ai_recommended');
  const [showAllPlatformRequestTypes, setShowAllPlatformRequestTypes] = useState<Record<string, boolean>>({});
  const [planningAvailableTypeHints, setPlanningAvailableTypeHints] = useState<string[]>([]);
  const [planningCapacityTypeHints, setPlanningCapacityTypeHints] = useState<string[]>([]);
  const [planningExclusiveCampaigns, setPlanningExclusiveCampaigns] = useState<
    Array<{ platform: string; content_type: string; count_per_week: string }>
  >([]);
  const [hasProvidedExclusiveCampaigns, setHasProvidedExclusiveCampaigns] = useState(false);
  const [lastCollectedPlanningContextFromApi, setLastCollectedPlanningContextFromApi] = useState<Record<string, unknown> | null>(null);
  const [platformCatalogPlatforms, setPlatformCatalogPlatforms] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const freshThreadAppliedRef = useRef<Set<string>>(new Set());
  const planAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      try {
        const response = await fetchWithAuth('/api/platform-intelligence/catalog?activeOnly=true&strict=false');
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        const platforms = Array.isArray(data?.platforms) ? data.platforms : [];
        if (!cancelled) setPlatformCatalogPlatforms(platforms);
      } catch {
      }
    };
    loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const platformLabels = useMemo(() => {
    const next: Record<string, string> = {};
    for (const p of platformCatalogPlatforms) {
      const key = String(p?.canonical_key || '').toLowerCase().trim();
      const name = String(p?.name || '').trim();
      if (key && name) next[key] = name;
    }
    return next;
  }, [platformCatalogPlatforms]);

  const platformQuickPickOptions = useMemo(() => {
    const names = platformCatalogPlatforms
      .map((p) => String(p?.name || '').trim())
      .filter(Boolean);
    return names;
  }, [platformCatalogPlatforms]);

  const platformContentTypeOptions = useMemo(() => {
    const next: Record<string, string[]> = {};
    for (const p of platformCatalogPlatforms) {
      const key = String(p?.canonical_key || '').toLowerCase().trim();
      const rawTypes = Array.isArray(p?.supported_content_types) ? p.supported_content_types : [];
      const labels = rawTypes.map((ct: any) => prettyContentTypeLabel(String(ct))).filter(Boolean);
      if (key && labels.length > 0) next[key] = labels;
    }
    return next;
  }, [platformCatalogPlatforms]);

  const platformContentTypeRawOptions = useMemo(() => {
    const next: Record<string, string[]> = {};
    for (const p of platformCatalogPlatforms) {
      const key = String(p?.canonical_key || '').toLowerCase().trim();
      const rawTypes = Array.isArray(p?.supported_content_types) ? p.supported_content_types : [];
      const types = rawTypes.map((ct: any) => String(ct || '').trim()).filter(Boolean);
      if (key && types.length > 0) next[key] = types;
    }
    return next;
  }, [platformCatalogPlatforms]);

  const allCatalogContentTypeQuickPickOptions = useMemo(() => {
    const raw = new Set<string>(Array.from(PLANNING_CONTENT_TYPE_LABELS).map(canonicalPlanningTypeLabel).filter(Boolean));
    for (const p of platformCatalogPlatforms || []) {
      const types = Array.isArray((p as any)?.supported_content_types) ? (p as any).supported_content_types : [];
      for (const t of types) {
        const label = canonicalPlanningTypeLabel(prettyContentTypeLabel(String(t || '').trim()));
        if (label) raw.add(label);
      }
    }
    const list = Array.from(raw);
    // Prefer common types first for speed.
    const priority = new Map<string, number>([
      ['Posts', 1],
      ['Videos', 2],
      ['Reels', 3],
      ['Shorts', 4],
      ['Long Videos', 5],
      ['Blogs', 6],
      ['Articles', 7],
      ['White Papers', 8],
      ['Carousels', 9],
      ['Images', 10],
      ['Stories', 11],
      ['Threads', 12],
      ['Spaces', 13],
      ['Songs', 14],
      ['Audio', 15],
      ['Podcasts', 16],
      ['Newsletters', 17],
      ['Webinars', 18],
      ['Slides', 19],
      ['Slideware', 20],
    ]);
    return list
      .map((s) => String(s).trim())
      .filter(Boolean)
      .sort((a, b) => {
        const pa = priority.get(a) ?? 999;
        const pb = priority.get(b) ?? 999;
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b);
      });
  }, [platformCatalogPlatforms]);

  const platformExtractCandidates = useMemo(() => {
    const keys =
      platformCatalogPlatforms && platformCatalogPlatforms.length > 0
        ? platformCatalogPlatforms
            .map((p) => String(p?.canonical_key || '').toLowerCase().trim())
            .filter(Boolean)
        : [];
    const out = new Set<string>(keys);
    if (out.has('x')) out.add('twitter');
    return Array.from(out);
  }, [platformCatalogPlatforms]);
  const resolvedCompanyId = useMemo(() => {
    if (companyId) return companyId;
    if (typeof window === 'undefined') return '';
    try {
      const urlCompanyId = new URL(window.location.href).searchParams.get('companyId');
      if (urlCompanyId) return urlCompanyId;
    } catch {
      // ignore
    }
    const fromCampaign = String((campaignData as any)?.company_id ?? (campaignData as any)?.companyId ?? '').trim();
    if (fromCampaign) return fromCampaign;
    return window.localStorage.getItem('selected_company_id') || window.localStorage.getItem('company_id') || '';
  }, [companyId, campaignData]);

  const ensureCompanyId = (): boolean => {
    if (!resolvedCompanyId) {
      setUiErrorMessage('Please select or create a campaign first.');
      return false;
    }
    return true;
  };

  const resolveWorkingDurationWeeks = (): number => {
    const candidates: Array<unknown> = [
      structuredPlan?.weeks?.length,
      retrievePlanData?.draftPlan?.weeks?.length,
      retrievePlanData?.committedPlan?.weeks?.length,
      initialPlan?.weeks?.length,
      (prefilledPlanning?.campaign_duration as number | undefined),
      (campaignData as { duration_weeks?: number } | undefined)?.duration_weeks,
    ];
    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 52) {
        return parsed;
      }
    }
    return 12;
  };

  const buildCollectedPlanningContextForApi = (): Record<string, unknown> | undefined => {
    const base: Record<string, unknown> = {};
    const recPayload = (recommendationContext?.context_payload ?? {}) as Record<string, unknown>;
    const weekOne: any = structuredPlan?.weeks?.[0];
    const weekOneCapsule: any | undefined = weekOne?.weeklyContextCapsule;

    const pickString = (...vals: Array<unknown>) => {
      for (const v of vals) {
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return '';
    };

    const normalizePlatformContentType = (label: string): string => {
      const n = String(label || '').toLowerCase().trim();
      if (!n) return '';
      if (n.includes('blog') || n.includes('article')) return 'article';
      if (n.includes('slide')) return 'slideware';
      if (n.includes('carousel')) return 'carousel';
      if (n.includes('song') || n.includes('audio')) return 'song';
      if (n.includes('thread')) return 'thread';
      if (n.includes('space')) return 'space';
      if (n.includes('short')) return 'short';
      if (n.includes('live')) return 'live';
      if (n.includes('reel')) return 'reel';
      if (n.includes('story')) return 'story';
      if (n.includes('video')) return 'video';
      if (n.includes('post')) return 'post';
      return n.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    };

    const targetAudience = pickString(
      (prefilledPlanning as any)?.target_audience,
      (collectedPlanningContext as any)?.target_audience,
      recPayload.target_audience,
      weekOneCapsule?.audienceProfile
    );
    if (targetAudience) base.target_audience = targetAudience;

    const tentativeStart = pickString(
      (prefilledPlanning as any)?.tentative_start,
      (collectedPlanningContext as any)?.tentative_start,
      (campaignData as any)?.start_date
    );
    if (tentativeStart) base.tentative_start = tentativeStart;

    const contentCapacity = pickString(
      (prefilledPlanning as any)?.content_capacity,
      (collectedPlanningContext as any)?.content_capacity
    );
    if (contentCapacity) base.content_capacity = contentCapacity;

    const durationWeeks =
      (prefilledPlanning as any)?.campaign_duration ??
      (collectedPlanningContext as any)?.campaign_duration ??
      structuredPlan?.weeks?.length;
    const durationNum = Number(durationWeeks);
    if (Number.isFinite(durationNum) && durationNum >= 1 && durationNum <= 52) {
      base.campaign_duration = durationNum;
    }

    const platformsFromFields = pickString(
      (prefilledPlanning as any)?.platforms,
      (collectedPlanningContext as any)?.platforms
    );
    const platformsFromWeek =
      weekOne?.platform_allocation && typeof weekOne.platform_allocation === 'object'
        ? Object.keys(weekOne.platform_allocation).join(', ')
        : '';
    const platforms = pickString(platformsFromFields, platformsFromWeek);
    if (platforms) base.platforms = platforms;

    // Persist platform-content-type selections (used for blueprint weekly cards).
    const platformContentTypesFromFields = (prefilledPlanning as any)?.platform_content_types ?? (collectedPlanningContext as any)?.platform_content_types;
    if (typeof platformContentTypesFromFields === 'string' && platformContentTypesFromFields.trim()) {
      base.platform_content_types = platformContentTypesFromFields.trim();
    } else {
      if (planningPlatformContentTypePrefs && Object.keys(planningPlatformContentTypePrefs).length > 0) {
        base.platform_content_types = JSON.stringify(planningPlatformContentTypePrefs);
      } else {
      const selectedPlatforms = planningSelectedPlatforms.length > 0 ? planningSelectedPlatforms : Object.keys(quickPlatformContentTypes || {});
      const mapping: Record<string, string[]> = {};
      for (const rawPlatform of selectedPlatforms) {
        const raw = quickPlatformContentTypes?.[rawPlatform] ?? [];
        const normalized = Array.from(new Set(raw.map(normalizePlatformContentType).filter(Boolean)));
        if (normalized.length > 0) mapping[rawPlatform] = normalized;
      }
      if (Object.keys(mapping).length > 0) {
        base.platform_content_types = JSON.stringify(mapping);
      }
      }
    }

    const platformContentRequestsFromFields =
      (prefilledPlanning as any)?.platform_content_requests ?? (collectedPlanningContext as any)?.platform_content_requests;
    if (platformContentRequestsFromFields && typeof platformContentRequestsFromFields === 'object') {
      base.platform_content_requests = platformContentRequestsFromFields;
    } else if (hasProvidedPlatformContentRequests && planningPlatformContentRequests && Object.keys(planningPlatformContentRequests).length > 0) {
      const next: Record<string, Record<string, number>> = {};
      for (const [platform, byType] of Object.entries(planningPlatformContentRequests)) {
        const out: Record<string, number> = {};
        for (const [contentType, rawCount] of Object.entries(byType || {})) {
          const label = prettyContentTypeLabel(contentType);
          if (!isEligiblePlanningType(label, eligiblePlanningTypes)) continue;
          const n = Number(String(rawCount).replace(/\D/g, '').slice(0, 2));
          if (Number.isFinite(n) && n > 0) out[String(contentType)] = Math.floor(n);
        }
        if (Object.keys(out).length > 0) next[String(platform)] = out;
      }
      if (Object.keys(next).length > 0) base.platform_content_requests = next;
    }

    if (hasProvidedPlatformContentRequests) {
      base.cross_platform_sharing = {
        enabled: planningCrossPlatformSharingEnabled,
        schedule: planningCrossPlatformScheduleMode,
      };
    }

    const exclusiveCampaignsFromFields =
      (prefilledPlanning as any)?.exclusive_campaigns ?? (collectedPlanningContext as any)?.exclusive_campaigns;
    if (Array.isArray(exclusiveCampaignsFromFields)) {
      base.exclusive_campaigns = exclusiveCampaignsFromFields;
    } else if (hasProvidedExclusiveCampaigns) {
      const cleaned = planningExclusiveCampaigns
        .map((row) => {
          const platform = String((row as any)?.platform || '').trim().toLowerCase();
          const content_type = String((row as any)?.content_type || '').trim();
          const n = Number(String((row as any)?.count_per_week || '').replace(/\D/g, '').slice(0, 2));
          const count_per_week = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
          if (!platform || !content_type || count_per_week <= 0) return null;
          return { platform, content_type, count_per_week };
        })
        .filter(Boolean);
      base.exclusive_campaigns = cleaned.length > 0 ? (cleaned as any) : [];
    }

    const keyMessages = pickString(
      (prefilledPlanning as any)?.key_messages,
      (collectedPlanningContext as any)?.key_messages,
      recPayload.key_messages
    );
    if (keyMessages) base.key_messages = keyMessages;

    return Object.keys(base).length > 0 ? base : undefined;
  };

  const buildTopicsWithExecutionForWeek = (week: any) => {
    const hasEnrichedTopics = Array.isArray(week?.topics) && week.topics.length > 0;
    if (!hasEnrichedTopics) return [];
    const platformTargets = Object.entries(week?.platform_allocation || {})
      .map(([platform, count]) => `${platform}: ${count}`)
      .filter(Boolean);
    const contentTypes = Array.isArray(week?.content_type_mix) ? week.content_type_mix : [];
    return (week.topics as any[]).map((topic, idx) => ({
      ...topic,
      topicExecution: {
        platformTargets: platformTargets.length > 0 ? [platformTargets[idx % platformTargets.length]] : ['—'],
        contentType: contentTypes[idx % Math.max(contentTypes.length, 1)] || '—',
        ctaType: week?.cta_type || '—',
        kpiFocus: week?.weekly_kpi_focus || '—',
      },
    }));
  };

  const applyLocalWeekTextReplacement = (
    plan: StructuredPlan,
    weekNumber: number,
    rawOldText: string,
    newTextRaw: string
  ): { nextPlan: StructuredPlan; replacedCount: number } => {
    const oldText = (rawOldText || '').trim();
    const newText = (newTextRaw || '').trim();
    if (!oldText || !newText || !plan?.weeks?.length) return { nextPlan: plan, replacedCount: 0 };

    const normalizeCandidate = (s: string) => {
      const t = s.trim();
      const m = t.match(/^([A-Za-z][A-Za-z\s()\/-]*):\s*(.+)$/);
      return m ? m[2].trim() : t;
    };

    const candidates = Array.from(new Set([oldText, normalizeCandidate(oldText)])).filter(Boolean);
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const deepReplace = (value: any, needle: string): { next: any; count: number } => {
      if (typeof value === 'string') {
        // 1) Exact substring replace
        if (value.includes(needle)) {
          const re = new RegExp(escapeRegExp(needle), 'g');
          const matches = value.match(re);
          return { next: value.replace(re, newText), count: matches ? matches.length : 0 };
        }
        // 2) Whitespace-insensitive replace (useful when selection spans line breaks)
        const tokens = needle.trim().split(/\s+/).filter(Boolean);
        if (tokens.length >= 3 && needle.length >= 12) {
          const reWs = new RegExp(tokens.map(escapeRegExp).join('\\s+'), 'g');
          const matches = value.match(reWs);
          if (matches?.length) {
            return { next: value.replace(reWs, newText), count: matches.length };
          }
        }
        return { next: value, count: 0 };
      }
      if (Array.isArray(value)) {
        let changed = false;
        let count = 0;
        const nextArr = value.map((item) => {
          const r = deepReplace(item, needle);
          if (r.count > 0) changed = true;
          count += r.count;
          return r.next;
        });
        return { next: changed ? nextArr : value, count };
      }
      if (value && typeof value === 'object') {
        let changed = false;
        let count = 0;
        const nextObj: any = { ...(value as any) };
        for (const [k, v] of Object.entries(value)) {
          const r = deepReplace(v, needle);
          if (r.count > 0) changed = true;
          count += r.count;
          nextObj[k] = r.next;
        }
        return { next: changed ? nextObj : value, count };
      }
      return { next: value, count: 0 };
    };

    let replacedCount = 0;
    const weeks = plan.weeks.map((w) => {
      if (w.week !== weekNumber) return w;
      let updated: any = w;
      let total = 0;
      for (const needle of candidates) {
        const r = deepReplace(updated, needle);
        updated = r.next;
        total += r.count;
      }
      replacedCount = total;
      return total > 0 ? updated : w;
    });

    return { nextPlan: replacedCount > 0 ? { ...plan, weeks } : plan, replacedCount };
  };

  // Debug: Log props when component mounts or props change
  useEffect(() => {
    console.log('CampaignAIChat props:', { isOpen, context, campaignId, hasCampaignData: !!campaignData });
  }, [isOpen, context, campaignId, campaignData]);

  // Initialize campaign-specific conversation
  useEffect(() => {
    if (campaignId && campaignData) {
      initializeCampaignThread(campaignId, campaignData);
    }
  }, [campaignId, campaignData, recommendationContext, initialPlan, context]);

  useEffect(() => {
    setHasGeneratedPlanInSession(false);
    setReviewWeekNumber(1);
    setReplaceMode(false);
    setReplaceSelection(null);
    setLastCollectedPlanningContextFromApi(null);
  }, [campaignId, context]);

  useEffect(() => {
    if (!showPlanOverview) {
      setReplaceMode(false);
      setReplaceSelection(null);
    }
  }, [showPlanOverview]);

  // Persist recommendations chat to session storage when messages change (separate from planning)
  useEffect(() => {
    if (context?.toLowerCase().includes('campaign-recommendations') && campaignId && messages.length > 0 && typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(
          `campaign_chat_draft_${campaignId}_recommendations`,
          JSON.stringify({ messages, savedAt: new Date().toISOString() })
        );
      } catch (e) {
        console.warn('Could not persist recommendations chat to sessionStorage', e);
      }
    }
  }, [context, campaignId, messages]);

  // Fetch saved/committed plan availability when chat opens for a campaign
  useEffect(() => {
    if (!isOpen || !campaignId) {
      setRetrievePlanData(null);
      return;
    }
    let cancelled = false;
    setIsRetrievePlanLoading(true);
    fetch(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setRetrievePlanData(data);
      })
      .catch(() => { if (!cancelled) setRetrievePlanData(null); })
      .finally(() => { if (!cancelled) setIsRetrievePlanLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, campaignId]);

  useEffect(() => {
    if (activeTab === 'history' && campaignId) {
      loadAiHistory(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'audit' && campaignId) {
      loadAuditReport(campaignId);
    }
  }, [activeTab, campaignId, campaignData]);

  useEffect(() => {
    if (activeTab === 'audit' && campaignId) {
      loadHealthReport(campaignId);
    }
  }, [activeTab, campaignId, campaignData]);

  useEffect(() => {
    if (activeTab === 'execution' && campaignId) {
      loadExecutionPlan(campaignId);
    }
  }, [activeTab, campaignId, executionWeekNumber]);

  useEffect(() => {
    if (activeTab === 'content' && campaignId) {
      loadContentAssets(campaignId);
    }
  }, [activeTab, campaignId, contentWeekNumber]);

  useEffect(() => {
    if (activeTab === 'performance' && campaignId) {
      loadPerformanceInsights(campaignId);
    }
  }, [activeTab, campaignId, performanceWeekNumber]);

  useEffect(() => {
    if (activeTab === 'memory' && campaignId) {
      loadCampaignMemory(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'business' && campaignId) {
      loadBusinessReports(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'platform' && campaignId) {
      setPlatformIntelData(null);
      loadContentAssets(campaignId);
    }
  }, [activeTab, campaignId]);

  // Load campaign learnings
  useEffect(() => {
    loadCampaignLearnings();
  }, []);

  const handleProviderChange = (provider: AIProvider) => {
    setSelectedProvider(provider);
    if (typeof window !== 'undefined') {
      localStorage.setItem(CAMPAIGN_AI_PROVIDER_KEY, provider);
    }
  };

  useEffect(() => {
    const loadAdminStatus = async () => {
      try {
        const response = await fetch('/api/admin/check-super-admin');
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch (error) {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, []);

  const saveAIContentForPlan = async (aiMessage: string, structuredPlanToSave?: StructuredPlan | null) => {
    if (!campaignId) return;
    try {
      // When structured plan exists, save to twelve_week_plan (same table; status: draft or edited_committed)
      if (structuredPlanToSave?.weeks?.length) {
        const isEditOfCommitted = planSource === 'committed';
        const api = isEditOfCommitted ? '/api/campaigns/update-edited-committed' : '/api/campaigns/save-draft-plan';
        const draftRes = await fetchWithAuth(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            structuredPlan: { weeks: structuredPlanToSave.weeks },
          }),
        });
        if (draftRes.ok) {
          if (typeof window !== 'undefined') {
            try {
              window.sessionStorage.setItem(
                getChatStorageKey(campaignId),
                JSON.stringify({ messages, savedAt: new Date().toISOString() })
              );
            } catch (e) {
              console.warn('Could not persist chat to sessionStorage', e);
            }
          }
          const successMessage: ChatMessage = {
            id: Date.now(),
            type: 'ai',
            message: isEditOfCommitted
              ? '✅ Changes saved to submitted plan (edited).'
              : '✅ Plan saved as draft. Topics, platforms, and content breakdown preserved.',
            timestamp: new Date().toLocaleTimeString(),
            provider: getProviderName(selectedProvider),
            campaignId
          };
          setMessages(prev => [...prev, successMessage]);
          return;
        }
        const err = await draftRes.json().catch(() => ({}));
        throw new Error(err?.error ?? err?.message ?? 'Failed to save draft plan');
      }
      const response = await fetchWithAuth('/api/campaigns/save-ai-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          aiContent: aiMessage,
          timestamp: new Date().toISOString(),
          provider: selectedProvider
        })
      });

      if (response.ok) {
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.setItem(
              getChatStorageKey(campaignId),
              JSON.stringify({ messages, savedAt: new Date().toISOString() })
            );
          } catch (e) {
            console.warn('Could not persist chat to sessionStorage', e);
          }
        }
        const successMessage: ChatMessage = {
          id: Date.now(),
          type: 'ai',
          message: '✅ Chat saved! Open Campaign planning (draft or edit) to continue with this conversation on the same page.',
          timestamp: new Date().toLocaleTimeString(),
          provider: getProviderName(selectedProvider),
          campaignId
        };
        setMessages(prev => [...prev, successMessage]);
      } else {
        const errData = await response.json().catch(() => ({}));
        const detail = errData?.error ?? errData?.message ?? response.statusText;
        throw new Error(detail || 'Failed to save content');
      }
    } catch (error) {
      console.error('Error saving AI content:', error);
      const detail = error instanceof Error ? error.message : 'Unknown error';
      const errorMessage: ChatMessage = {
        id: Date.now(),
        type: 'ai',
        message: `❌ Failed to save AI content. ${detail}`,
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  const serializeStructuredPlanToText = (plan: StructuredPlan): string => {
    const fmt = (s: unknown) => String(s ?? '').trim();
    const oneLine = (s: unknown, max = 180) => {
      const t = fmt(s).replace(/\s+/g, ' ');
      if (!t) return '';
      return t.length > max ? `${t.slice(0, max - 1)}…` : t;
    };
    const serializeBreakdown = (w: any) => {
      const b = w?.platform_content_breakdown;
      if (!b || typeof b !== 'object') return '';
      const lines: string[] = [];
      for (const [platform, items] of Object.entries(b as any)) {
        if (!Array.isArray(items) || items.length === 0) continue;
        const parts = items.map((it: any) => {
          const type = fmt(it?.type) || 'item';
          const count = Number(it?.count ?? 0);
          const topics = Array.isArray(it?.topics) ? it.topics.map((t: any) => oneLine(t, 80)).filter(Boolean) : [];
          const topicSeed = topics.length > 0 ? ` — topics: ${topics.slice(0, 4).join(' | ')}${topics.length > 4 ? ' …' : ''}` : '';
          return `${type}${Number.isFinite(count) && count > 1 ? ` (${count})` : ''}${topicSeed}`;
        });
        lines.push(`${platform}: ${parts.join('; ')}`);
      }
      return lines.length > 0 ? `Platform breakdown:\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
    };
    const serializeTopicBriefs = (w: any) => {
      const topics = Array.isArray(w?.topics) ? w.topics : [];
      if (topics.length === 0) return '';
      const lines = topics.slice(0, 6).map((t: any, idx: number) => {
        const title = fmt(t?.topicTitle) || `Topic ${idx + 1}`;
        const intent = oneLine(t?.topicContext?.writingIntent, 140);
        const who = oneLine(t?.whoAreWeWritingFor, 90);
        const problem = oneLine(t?.whatProblemAreWeAddressing, 90);
        return `- ${title}${intent ? ` — ${intent}` : ''}${who ? ` (who: ${who})` : ''}${problem ? ` (problem: ${problem})` : ''}`;
      });
      return `Writer briefs (sample):\n${lines.join('\n')}${topics.length > 6 ? `\n- … +${topics.length - 6} more` : ''}`;
    };

    return plan.weeks
      .map((w: any) => {
        const theme = fmt(w.theme || w.phase_label) || `Week ${w.week}`;
        const objective = oneLine(w.primary_objective || w.objective, 220);
        const platforms = w.platform_allocation
          ? Object.entries(w.platform_allocation)
              .map(([p, n]) => `${p}: ${n}`)
              .join(', ')
          : '';
        const content = Array.isArray(w.content_type_mix) ? w.content_type_mix.join(', ') : '';
        const capsule = (w as any)?.weeklyContextCapsule;
        const audience = capsule ? oneLine(capsule.audienceProfile, 120) : '';
        const weeklyIntent = capsule ? oneLine(capsule.weeklyIntent, 160) : '';
        const tone = capsule ? oneLine(capsule.toneGuidance, 120) : '';
        const topicsToCover = Array.isArray(w.topics_to_cover) ? w.topics_to_cover.map((t: any) => oneLine(t, 80)).filter(Boolean) : [];
        const breakdownBlock = serializeBreakdown(w);
        const briefsBlock = serializeTopicBriefs(w);

        return [
          `Week ${w.week}: ${theme}`,
          objective ? `Objective: ${objective}` : '',
          platforms ? `Platforms: ${platforms}` : 'Platforms: —',
          content ? `Content mix: ${content}` : 'Content mix: —',
          audience ? `Audience: ${audience}` : '',
          weeklyIntent ? `Weekly intent: ${weeklyIntent}` : '',
          tone ? `Tone: ${tone}` : '',
          topicsToCover.length > 0 ? `Topics to cover:\n${topicsToCover.slice(0, 10).map((t: string) => `- ${t}`).join('\n')}${topicsToCover.length > 10 ? '\n- …' : ''}` : '',
          breakdownBlock,
          briefsBlock,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');
  };

  const saveDraftAndViewOnCampaign = async () => {
    if (!campaignId || !structuredPlan?.weeks?.length || !onProgramGenerated) return;
    setIsSavingDraftForView(true);
    setUiErrorMessage(null);
    const weeksToSave = structuredPlan.weeks.map((w: any, idx: number) => ({
      ...w,
      week: Number(w.week ?? w.week_number ?? idx + 1) || idx + 1,
      week_number: Number(w.week_number ?? w.week ?? idx + 1) || idx + 1,
    }));
    let saveSucceeded = false;
    try {
      const saveRes = await fetchWithAuth('/api/campaigns/save-draft-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, structuredPlan: { weeks: weeksToSave } }),
      });
      if (saveRes.ok) saveSucceeded = true;
      else {
        const err = await saveRes.json().catch(() => ({}));
        console.warn('Failed to save draft for view', err);
        setUiErrorMessage('Plan could not be saved. Try again or use "Create week plan from stored context" on the campaign page.');
      }
    } catch (e) {
      console.warn('Failed to save draft for view', e);
      setUiErrorMessage('Plan could not be saved. Try again or use "Create week plan from stored context" on the campaign page.');
    }
    const programData = convertStructuredPlanToProgram(structuredPlan);
    onProgramGenerated({ program: programData, structuredPlan, saveSucceeded });
    setIsSavingDraftForView(false);
  };

  const commitPlan = (aiMessage?: string) => {
    const today = new Date().toISOString().split('T')[0];
    const resolvedStartDate =
      (commitStartDate && /^\d{4}-\d{2}-\d{2}$/.test(commitStartDate) ? commitStartDate : '') ||
      (typeof (prefilledPlanning as any)?.tentative_start === 'string' ? (prefilledPlanning as any).tentative_start : '') ||
      (typeof (collectedPlanningContext as any)?.tentative_start === 'string' ? (collectedPlanningContext as any).tentative_start : '') ||
      (typeof (campaignData as any)?.start_date === 'string' ? (campaignData as any).start_date : '') ||
      today;

    const resolvedWeeks =
      (structuredPlan?.weeks?.length && structuredPlan.weeks.length > 0 ? structuredPlan.weeks.length : undefined) ??
      (typeof commitDurationWeeks === 'number' && commitDurationWeeks >= 1 && commitDurationWeeks <= 52 ? commitDurationWeeks : undefined) ??
      resolveWorkingDurationWeeks();

    if (structuredPlan) {
      const text = serializeStructuredPlanToText(structuredPlan);
      setSelectedPlan(text);
      setCommitDurationWeeks(structuredPlan.weeks.length);
    } else if (aiMessage) {
      setSelectedPlan(aiMessage);
    }
    setCommitStartDate(resolvedStartDate);
    setShowPlanOverview(false);
    setShowPlanPreview(false);
    setShowDateSelection(false);

    // Direct commit — no re-confirmation modal
    void create12WeekPlan(resolvedStartDate, resolvedWeeks);
  };

  const viewPlan = (aiMessage?: string, messageId?: number) => {
    if (aiMessage) setSelectedPlan(aiMessage);
    if (messageId != null) setHasViewedPlanMessageId(messageId);
    if (structuredPlan) {
      setShowPlanOverview(true);
    } else {
      setShowPlanPreview(true);
    }
  };

  const loadDraftPlanAndEdit = () => {
    const plan = retrievePlanData?.draftPlan;
    if (!plan?.weeks?.length) return;
    setStructuredPlan({ weeks: plan.weeks, format: 'blueprint' });
    setStructuredPlanMessageId(Date.now());
    setPlanSource('draft');
    setShowPlanOverview(true);
  };

  const loadCommittedPlanAndEdit = () => {
    const plan = retrievePlanData?.committedPlan;
    if (!plan?.weeks?.length) return;
    setStructuredPlan({ weeks: plan.weeks, format: 'blueprint' });
    setStructuredPlanMessageId(Date.now());
    setPlanSource('committed');
    setShowPlanOverview(true);
  };

  const loadSavedPlanAndEdit = async () => {
    const saved = retrievePlanData?.savedPlan;
    if (!saved?.content) return;
    setIsParsingSavedPlan(true);
    try {
      const res = await fetch('/api/campaigns/parse-saved-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: saved.content }),
      });
      if (res.ok) {
        const { weeks } = await res.json();
        if (Array.isArray(weeks) && weeks.length > 0) {
          setStructuredPlan({ weeks, format: 'blueprint' });
          setStructuredPlanMessageId(Date.now());
          setPlanSource('draft');
          setShowPlanOverview(true);
        } else {
          setUiErrorMessage('Could not parse saved plan into editable format.');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setUiErrorMessage(err.details || err.error || 'Failed to parse saved plan.');
      }
    } catch (e) {
      setUiErrorMessage('Failed to parse saved plan. Please try again.');
    } finally {
      setIsParsingSavedPlan(false);
    }
  };

  const requestDailyPlanForWeek = (weekNum: number) => {
    setNewMessage(`Generate the daily plan for Week ${weekNum} with specific content for each day (Monday–Sunday).`);
    setShowPlanOverview(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const generateDefaultPlan = () => {
    return `Social Media Campaign Plan

Weeks 1-3: Foundation & Brand Awareness
- Establish brand voice and visual identity
- Create foundational content themes
- Build initial audience engagement
- Focus on educational and value-driven content

Weeks 4-6: Content Diversification
- Introduce user-generated content
- Implement storytelling strategies
- Add interactive elements (polls, Q&As)
- Cross-platform content adaptation

Weeks 7-9: Community Building
- Foster deeper audience connections
- Launch community challenges
- Feature customer testimonials
- Engage with trending topics

Weeks 10-12: Optimization & Growth
- Analyze performance metrics
- Refine top-performing content
- Scale successful strategies
- Prepare for next campaign phase

This comprehensive approach ensures consistent growth and engagement across all platforms.`;
  };

  const create12WeekPlan = async (startDate: string, durationWeeks?: number) => {
    try {
      setIsLoading(true);
      
      // Check if we have a plan selected, if not create a default one
      const aiContent = selectedPlan || generateDefaultPlan();
      
      // Validate all required fields
      if (!campaignId) {
        console.error('Campaign ID is missing. Props received:', { campaignId, isOpen, context });
        throw new Error('Campaign ID is missing. Please refresh the page and try again.');
      }
      if (!startDate) {
        throw new Error('Start date is missing');
      }
      if (!aiContent) {
        throw new Error('AI content is missing');
      }
      
      console.log('Sending request with:', { 
        campaignId, 
        startDate, 
        aiContent: aiContent?.substring(0, 100) + '...', 
        provider: selectedProvider,
        hasSelectedPlan: !!selectedPlan,
        campaignIdType: typeof campaignId,
        startDateType: typeof startDate,
        aiContentLength: aiContent?.length
      });
      
      const resolvedDuration = typeof durationWeeks === 'number' && durationWeeks >= 1 && durationWeeks <= 52
        ? durationWeeks
        : resolveWorkingDurationWeeks();
      const body: Record<string, unknown> = {
        campaignId,
        startDate,
        aiContent,
        provider: selectedProvider,
        companyId: resolvedCompanyId || undefined,
        ...(typeof resolvedDuration === 'number' && resolvedDuration >= 1 && resolvedDuration <= 52 ? { durationWeeks: resolvedDuration } : {}),
      };
      if (structuredPlan?.weeks?.length) {
        body.structuredPlan = { weeks: structuredPlan.weeks };
      }
      const response = await fetchWithAuth('/api/campaigns/create-12week-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const result = await response.json();

        // Refetch retrieve-plan so "View committed plan" / "Load committed plan" appear
        const refetchRes = await fetch(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`);
        if (refetchRes.ok) {
          const refetchData = await refetchRes.json();
          setRetrievePlanData(refetchData);
        }

        const weeksMsg = typeof resolvedDuration === 'number' ? resolvedDuration : resolveWorkingDurationWeeks();
        const successMessage: ChatMessage = {
          id: Date.now(),
          type: 'ai',
          message: `🎉 ${weeksMsg}-week campaign plan created successfully! Starting from ${new Date(startDate).toLocaleDateString()}. Use **View submitted plan** above to open your plan.`,
          timestamp: new Date().toLocaleTimeString(),
          provider: getProviderName(selectedProvider),
          campaignId
        };
        setMessages(prev => [...prev, successMessage]);

        setShowDateSelection(false);
        setSelectedPlan('');

        // After commit, land user directly on weekly blueprint cards.
        if (typeof window !== 'undefined') {
          const currentUrl = new URL(window.location.href);
          const nextParams = new URLSearchParams();
          const companyIdParam = currentUrl.searchParams.get('companyId') || resolvedCompanyId;
          if (companyIdParam) nextParams.set('companyId', companyIdParam);
          if (currentUrl.searchParams.get('fromRecommendation') === '1') {
            nextParams.set('fromRecommendation', '1');
            const recommendationIdParam = currentUrl.searchParams.get('recommendationId');
            if (recommendationIdParam) nextParams.set('recommendationId', recommendationIdParam);
          }
          nextParams.set('focus', 'weekly-blueprint');
          window.location.href = `/campaign-details/${campaignId}?${nextParams.toString()}`;
          return;
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('API Error Response:', errorData);
        const detail = errorData.details || errorData.message || errorData.error || 'Unknown error';
        const hint = errorData.hint ? ` (${errorData.hint})` : '';
        throw new Error(`Failed to create plan: ${detail}${hint}`);
      }
    } catch (error) {
      console.error('Error creating campaign plan:', error);
      const errorMessage: ChatMessage = {
        id: Date.now(),
        type: 'ai',
        message: '❌ Failed to create campaign plan. Please try again.',
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const buildRecommendationWelcome = (campaignData: any): string => {
    const name = campaignData?.name || 'this campaign';
    const desc = campaignData?.description || campaignData?.objective || '';
    const regions = recommendationContext?.target_regions?.filter(Boolean);
    const payload = recommendationContext?.context_payload as Record<string, unknown> | undefined;
    const formats = payload?.formats as string[] | undefined;
    const reachEst = payload?.reach_estimate;
    const parts: string[] = [
      `Hello! I'm here to help you turn **"${name}"** into a complete content marketing plan.`,
    ];
    if (prefilledPlanning && Object.keys(prefilledPlanning).length > 0) {
      parts.push('\n\nI already have from your setup:\n' + Object.entries(prefilledPlanning).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n'));
      parts.push(`\n\nI'll ask only what's still needed to build your week plan.\n\n**Who is your primary target audience?** (e.g., professionals, entrepreneurs, parents, educators)`);
      return parts.join('');
    }
    if (desc) {
      parts.push(`\n\nI see your theme: *${desc.slice(0, 200)}${desc.length > 200 ? '...' : ''}*`);
    }
    if (regions && regions.length > 0) {
      parts.push(`\n\n**Target regions:** ${regions.join(', ')}`);
    }
    if (formats && formats.length > 0) {
      parts.push(`\n**Suggested formats:** ${formats.join(', ')}`);
    }
    if (reachEst) {
      parts.push(`\n**Estimated reach:** ${reachEst}`);
    }
    parts.push(`\n\nI'll ask you one question at a time. We need: target audience, available content (if any—and if you have content, which campaign objective it should serve and which week(s) to slot it into), tentative start date (YYYY-MM-DD format), campaign types, content & production capacity, duration, platforms, key messages, success metrics. Then say "Create my plan" or "I'm ready".\n\n**First question:** Who is your primary target audience? (e.g., professionals, entrepreneurs, parents, educators)`);
    return parts.join('');
  };

  const buildPrefilledWelcome = (name: string): string => {
    const pre = prefilledPlanning;
    if (!pre || Object.keys(pre).length === 0) return '';
    const items = Object.entries(pre).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n');
    return `Hello! I'm your AI assistant for "${name}".

I already have these from your campaign setup:
${items}

I'll ask only what's still needed to build your week plan.

**Who is your primary target audience?** (e.g., professionals, entrepreneurs, parents, educators)\n\n`;
  };

  const GENERIC_WELCOME = (name: string) => {
    const prefilledIntro = buildPrefilledWelcome(name);
    const base = prefilledIntro || `Hello! I'm your AI assistant for "${name}". I'll ask you one question at a time to build your campaign plan.

**Planning checklist:** target audience, available content (if any—if you have content, we'll ask which objective it serves and which week(s) to slot it into), tentative start date (YYYY-MM-DD format), campaign types, content & production capacity, duration, platforms, key messages, success metrics. Each week will have a concrete theme decided by AI before scheduling.

When we have everything, say "Create my plan" or "I'm ready" and I'll generate it.

`;
    return base + (prefilledIntro ? '' : '**First question:** Who is your primary target audience? (e.g., professionals, entrepreneurs, parents, educators)');
  };

  const initializeCampaignThread = async (campaignId: string, campaignData: any) => {
    const contextKey = `${campaignId}:${String(context || 'general').toLowerCase()}`;
    const isPlanningContext =
      context.toLowerCase().includes('campaign-planning') ||
      context.toLowerCase().includes('12week-plan') ||
      context.toLowerCase().includes('blueprint-plan');
    const freshThreadSessionKey = `campaign_chat_fresh_applied_${contextKey}`;
    const wasFreshAppliedInSession =
      typeof window !== 'undefined' &&
      window.sessionStorage.getItem(freshThreadSessionKey) === '1';
    const shouldForceFreshNow =
      forceFreshPlanningThread &&
      isPlanningContext &&
      !freshThreadAppliedRef.current.has(contextKey) &&
      !wasFreshAppliedInSession;

    if (shouldForceFreshNow && typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(getChatStorageKey(campaignId));
        window.sessionStorage.removeItem(getPlanningFormStorageKey(campaignId));
        window.sessionStorage.setItem(freshThreadSessionKey, '1');
      } catch (e) {
        console.warn('Could not clear saved chat draft', e);
      }
      freshThreadAppliedRef.current.add(contextKey);
    }

    // Load existing conversation for this campaign (context-specific: recommendations use separate storage)
    let existingMessages = shouldForceFreshNow ? [] : await loadCampaignMessages(campaignId);
    // If we now have recommendations but stored messages are from "no recs" state, start fresh with consultation welcome
    const isRecsContext = context?.toLowerCase().includes('campaign-recommendations');
    if (isRecsContext && initialPlan?.weeks?.length && existingMessages.length > 0) {
      const firstAi = existingMessages.find((m) => m.type === 'ai')?.message ?? '';
      if (firstAi.includes('Generate recommendations first')) existingMessages = [];
    }
    if (existingMessages.length === 0) {
      const durationWeeks = (campaignData?.duration_weeks ?? initialPlan?.weeks?.length ?? 12);
      let welcomeText: string;
      const isRecommendationsContext = context?.toLowerCase().includes('campaign-recommendations');
      if (isRecommendationsContext) {
        welcomeText = initialPlan?.weeks?.length
          ? `Hello! I'm your expert consultant for **improving this campaign's plan**. You've got recommendations loaded.

I'll ask a few quick questions first to focus our work—scope (all weeks or specific week), interest areas (topics, content types, geo focus, scheduling, target customer, etc.), and what's missing from a content manager standpoint. Once you answer, I'll refine accordingly. When you're satisfied, apply the agreed changes to your campaign.

**Would you like to improve all weeks, or focus on a specific week (or weeks)?**`
          : `Hello! I'm your expert consultant for **vetting and refining recommendations**. Generate recommendations first (click "Generate Recommendations" above), then I'll help you improve them by scope (all weeks or specific weeks), topics, content types, geo focus, and more.`;
      } else if (initialPlan?.weeks?.length && (context?.toLowerCase().includes('12week-plan') || context?.toLowerCase().includes('blueprint-plan'))) {
        welcomeText = `Hello! You're refining your **${durationWeeks}-week campaign plan**. I won't ask questions—just describe the changes you want (e.g., "Add topic X to Week 1", "Change Week 2 theme to...", "Add 2 LinkedIn posts to Week 3"). I'll apply them and return the updated plan.`;
      } else if (recommendationContext && (recommendationContext.target_regions?.length || recommendationContext.context_payload)) {
        welcomeText = buildRecommendationWelcome(campaignData);
      } else {
        welcomeText = GENERIC_WELCOME(campaignData?.name || 'this campaign');
      }
      const welcomeMessage: ChatMessage = {
        id: Date.now(),
        type: 'ai',
        message: welcomeText,
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId
      };
      setMessages([welcomeMessage]);
    } else {
      setMessages(existingMessages);
    }

    // Restore planning form state (last unsaved) so user can continue from where they left off
    if (typeof window !== 'undefined' && campaignId && isPlanningContext) {
      try {
        const formKey = getPlanningFormStorageKey(campaignId);
        const saved = window.sessionStorage.getItem(formKey);
        if (saved) {
          const parsed = JSON.parse(saved) as {
            platformContentRequests?: Record<string, Record<string, string>>;
            crossPlatformSharing?: boolean;
            scheduleMode?: string;
          };
          if (parsed?.platformContentRequests && typeof parsed.platformContentRequests === 'object' && Object.keys(parsed.platformContentRequests).length > 0) {
            setPlanningPlatformContentRequests(parsed.platformContentRequests);
          }
          if (typeof parsed?.crossPlatformSharing === 'boolean') {
            setPlanningCrossPlatformSharingEnabled(parsed.crossPlatformSharing);
          }
          if (parsed?.scheduleMode === 'same_time' || parsed?.scheduleMode === 'staggered' || parsed?.scheduleMode === 'ai_recommended') {
            setPlanningCrossPlatformScheduleMode(parsed.scheduleMode);
          }
        }
      } catch (e) {
        console.warn('Could not restore planning form state', e);
      }
    }
  };

  const getChatStorageKey = (cid: string) =>
    context?.toLowerCase().includes('campaign-recommendations')
      ? `campaign_chat_draft_${cid}_recommendations`
      : `campaign_chat_draft_${cid}`;

  const getPlanningFormStorageKey = (cid: string) =>
    `campaign_planning_form_${cid}`;

  const loadCampaignMessages = async (campaignId: string): Promise<ChatMessage[]> => {
    const storageKey = getChatStorageKey(campaignId);
    if (typeof window !== 'undefined') {
      try {
        const stored = window.sessionStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored) as { messages?: ChatMessage[] };
          if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
            return parsed.messages;
          }
        }
      } catch (e) {
        console.warn('Could not load saved chat draft', e);
      }
    }
    // For recommendations context, use only session storage (avoid mixing with planning conversation)
    if (context?.toLowerCase().includes('campaign-recommendations')) return [];
    try {
      const response = await fetch(`/api/ai/campaign-messages?campaignId=${campaignId}`);
      if (response.ok) {
        const data = await response.json();
        return data.messages || [];
      }
    } catch (error) {
      console.error('Error loading campaign messages:', error);
    }
    return [];
  };

  const isWeeklyPlanMessage = (msg: string): boolean => {
    if (!msg || msg.length < 100) return false;
    const hasWeekStructure = /\bWeek\s+\d+/i.test(msg) || /\bWeeks\s+\d+\s*[-–]\s*\d+/i.test(msg);
    const hasPlatformOrContent = /\b(LinkedIn|Facebook|Instagram|Twitter|TikTok|YouTube|Blog|Video|Post|Carousel|Reel)\b/i.test(msg);
    return hasWeekStructure && (hasPlatformOrContent || msg.length > 500);
  };

  const saveCampaignMessage = async (message: ChatMessage) => {
    try {
      await fetch('/api/ai/campaign-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, campaignId })
      });
    } catch (error) {
      console.error('Error saving campaign message:', error);
    }
  };

  const loadCampaignLearnings = async () => {
    try {
      const response = await fetch('/api/ai/campaign-learnings');
      if (response.ok) {
        const data = await response.json();
        setCampaignLearnings(data.learnings || []);
      }
    } catch (error) {
      console.error('Error loading campaign learnings:', error);
    }
  };

  const extractProgramFromResponse = (response: string) => {
    try {
      // Look for structured program data in the response
      const weeks = [];
      const platforms = platformQuickPickOptions;
      
      // Extract week-by-week content
      for (let i = 1; i <= 12; i++) {
        const weekMatch = response.match(new RegExp(`Week ${i}[\\s\\S]*?(?=Week ${i + 1}|$)`, 'i'));
        if (weekMatch) {
          const weekContent = weekMatch[0];
          const content = [];
          
          // Extract content types and platforms
          platforms.forEach((platform) => {
            const label = String(platform || '').trim();
            if (!label) return;
            const hay = weekContent.toLowerCase();
            const needle = label.toLowerCase();
            const matches = needle === 'x' ? /\bx\b/.test(hay) : hay.includes(needle);
            if (matches) {
              const key = extractPlatforms(label)?.[0] || needle;
              content.push({
                type: 'post',
                platform: key,
                description: `Week ${i} ${label} content`
              });
            }
          });
          
          weeks.push({
            weekNumber: i,
            theme: `Week ${i} Theme`,
            content: content.length > 0 ? content : [{
              type: 'post',
              platform: 'linkedin',
              description: `Week ${i} content`
            }]
          });
        }
      }
      
      return {
        description: 'AI-generated campaign content program',
        totalContent: weeks.reduce((sum, week) => sum + week.content.length, 0),
        platforms: platforms,
        weeks: weeks.length > 0 ? weeks : generateDefaultProgram()
      };
    } catch (error) {
      console.error('Error extracting program:', error);
      return generateDefaultProgram();
    }
  };

  const generateDefaultProgram = () => {
    const weeks = [];
    const platforms = Object.keys(platformLabels);
    
    for (let i = 1; i <= 12; i++) {
      weeks.push({
        weekNumber: i,
        theme: `Week ${i} Theme`,
        content: platforms.map(platform => ({
          type: 'post',
          platform: platform,
          description: `Week ${i} ${platform} content`
        }))
      });
    }
    
    return {
      description: 'AI-generated 12-week content program',
      totalContent: weeks.reduce((sum, week) => sum + week.content.length, 0),
      platforms: platforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)),
      weeks: weeks
    };
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  const focusInputSoon = () => {
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const extractLastQuestionLine = (text: string): string | null => {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].endsWith('?')) return lines[i];
    }
    return null;
  };
  const extractDurationWeeksFromHistory = (
    history: Array<{ type: 'user' | 'ai'; message: string }>
  ): number | undefined => {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const msg = history[i];
      if (msg.type !== 'user') continue;
      const match = msg.message.match(/\b(\d{1,2})\s*(?:week|weeks)\b/i);
      if (!match) continue;
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 52) return n;
    }
    return undefined;
  };

  const enrichPlanningQuestionExamples = (text: string): string => {
    if (!text) return text;
    const exampleForQuestion = (question: string): string => {
      const q = question.toLowerCase();
      if (
        q.includes('do you want to proceed with') ||
        q.includes('proceed with') ||
        q.includes('recommend') && q.includes('week') ||
        q.includes('would you like me to create') ||
        (q.includes('create your') && q.includes('plan now'))
      ) {
        return '(e.g., "Yes, proceed with 12 weeks." or "Use 8 weeks instead.")';
      }
      if (q.includes('target audience')) {
        return '(e.g., professionals, entrepreneurs, parents, educators, students, SMB owners)';
      }
      if (q.includes('start') && q.includes('date')) {
        return '(e.g., 2026-08-15)';
      }
      if (q.includes('duration') || (q.includes('how many') && q.includes('week'))) {
        return '(e.g., 6, 8, or 12 weeks)';
      }
      if (q.includes('platform')) {
        return '(e.g., LinkedIn, Instagram, YouTube, X)';
      }
      if (q.includes('content') && (q.includes('have') || q.includes('existing'))) {
        return '(e.g., 3 videos, 10 posts, 2 blogs)';
      }
      if (q.includes('capacity') || q.includes('per week')) {
        return '(e.g., 2 videos/week, 5 posts/week, 1 blog/week)';
      }
      if (q.includes('success metric') || q.includes('kpi') || (q.includes('metric') && q.includes('track'))) {
        return '(e.g., 5% engagement rate, 200 qualified leads/month, 20 demo bookings/month)';
      }
      if (q.includes('objective') || q.includes('goal')) {
        return '(e.g., awareness, leads, conversions, retention)';
      }
      if (q.includes('budget')) {
        return '(e.g., $500/month, $2,000/quarter)';
      }
      if (q.includes('region') || q.includes('geo') || q.includes('market')) {
        return '(e.g., US, UK, India, global)';
      }
      return '(e.g., brief specific answer in 1-2 lines)';
    };

    const withExample = (line: string): string => {
      const example = exampleForQuestion(line);
      // Replace weak or messy example blocks with a clearer one.
      if (/\(e\.g\.,?.*\)/i.test(line)) {
        return line.replace(/\(e\.g\.,?.*\)/i, example);
      }
      return `${line} ${example}`;
    };

    return text
      .split('\n')
      .map((line) => {
        if (!line.includes('?')) return line;
        return withExample(line);
      })
      .join('\n');
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const quickPickConfig = useMemo(() => {
    const lastAi = [...messages].reverse().find((m) => m.type === 'ai' && m.message)?.message || '';
    const q = extractQuestionCandidate(lastAi);
    const base = getQuickPickConfig(q, platformQuickPickOptions);
    if (!base) return base;
    if (base.key === 'available_content' || base.key === 'content_capacity') {
      return { ...base, options: allCatalogContentTypeQuickPickOptions };
    }
    return base;
  }, [messages, platformQuickPickOptions, allCatalogContentTypeQuickPickOptions]);
  const quickPickAiMessageId = useMemo(() => {
    return [...messages].reverse().find((m) => m.type === 'ai' && m.message)?.id ?? null;
  }, [messages]);
  const eligiblePlanningTypes = useMemo(() => {
    const fromProps = [
      ...extractPlanningTypeHintsFromCapacityValue((prefilledPlanning as any)?.available_content),
      ...extractPlanningTypeHintsFromCapacityValue((prefilledPlanning as any)?.weekly_capacity ?? (prefilledPlanning as any)?.content_capacity),
      ...extractPlanningTypeHintsFromCapacityValue((collectedPlanningContext as any)?.available_content),
      ...extractPlanningTypeHintsFromCapacityValue(
        (collectedPlanningContext as any)?.weekly_capacity ?? (collectedPlanningContext as any)?.content_capacity
      ),
    ];

    const fromHistory: string[] = [];
    for (let i = 0; i < messages.length - 1; i += 1) {
      const curr = messages[i];
      const next = messages[i + 1];
      if (curr?.type !== 'ai' || next?.type !== 'user') continue;
      const q = extractQuestionCandidate(String(curr?.message ?? ''));
      const cfg = getQuickPickConfig(q, platformQuickPickOptions);
      if (!cfg) continue;
      if (cfg.key === 'available_content' || cfg.key === 'content_capacity') {
        fromHistory.push(...extractPlanningTypeHintsFromCapacityValue(String(next?.message ?? '')));
      }
    }

    return computeEligiblePlanningTypeSet([
      ...(planningAvailableTypeHints || []),
      ...(planningCapacityTypeHints || []),
      ...fromProps,
      ...fromHistory,
    ]);
  }, [
    planningAvailableTypeHints,
    planningCapacityTypeHints,
    prefilledPlanning,
    collectedPlanningContext,
    messages,
    platformQuickPickOptions,
  ]);
  const shouldRenderQuickPickInInput = false;

  useEffect(() => {
    setSelectedQuickOptions([]);
    setQuickPickPrimaryStyles([]);
    setQuickPickSecondaryModifiers([]);
    setQuickCustomizeMode(false);
    setQuickCustomizeText('');
    setQuickCustomContentType('');
    setQuickCustomContentCount('');
    setQuickCustomPlatform('');
    setHideQuickPickPanel(false);
    setQuickDateYear('');
    setQuickDateMonth('');
    setQuickDateDay('');
    setQuickCapacityCounts({});
    setQuickCapacityCreationMode('');
    setShowAllTypeCounters({ available_content: false, content_capacity: false });
    setQuickPlatformContentTypes({});
  }, [quickPickConfig?.key]);

  // Persist planning form state (platform content requests, sharing, schedule) so user can start from last unsaved state
  useEffect(() => {
    if (typeof window === 'undefined' || !campaignId) return;
    const isPlanning =
      context?.toLowerCase().includes('campaign-planning') ||
      context?.toLowerCase().includes('12week-plan') ||
      context?.toLowerCase().includes('blueprint-plan');
    if (!isPlanning) return;
    try {
      const formKey = getPlanningFormStorageKey(campaignId);
      const payload = {
        platformContentRequests: planningPlatformContentRequests ?? {},
        crossPlatformSharing: planningCrossPlatformSharingEnabled,
        scheduleMode: planningCrossPlatformScheduleMode,
      };
      window.sessionStorage.setItem(formKey, JSON.stringify(payload));
    } catch (e) {
      console.warn('Could not persist planning form state', e);
    }
  }, [campaignId, context, planningPlatformContentRequests, planningCrossPlatformSharingEnabled, planningCrossPlatformScheduleMode]);

  const sendMessage = async (overrideMessage?: unknown) => {
    const safeOverride =
      typeof overrideMessage === 'string'
        ? overrideMessage
        : '';
    const messageText = (safeOverride || newMessage).trim();
    if (!messageText) return;

    // Persist platform selection so the next question can show only selected platforms.
    if (quickPickConfig?.key === 'platforms') {
      const inferred = extractPlatforms(messageText);
      if (inferred?.length) setPlanningSelectedPlatforms(Array.from(new Set(inferred)));
    }
    const effectiveCurrentPlan = initialPlan?.weeks?.length
      ? initialPlan
      : (showPlanOverview && structuredPlan ? { weeks: structuredPlan.weeks } : undefined);

    const userMessage: ChatMessage = {
      id: Date.now(),
      type: 'user',
      message: messageText,
      timestamp: new Date().toLocaleTimeString(),
      campaignId
    };

    setMessages(prev => [...prev, userMessage]);
    await saveCampaignMessage(userMessage);
    setNewMessage('');
    setSelectedQuickOptions([]);
    setQuickCustomizeMode(false);
    setQuickCustomizeText('');
    setQuickCustomContentType('');
    setQuickCustomContentCount('');
    setQuickCustomPlatform('');
    setQuickDateYear('');
    setQuickDateMonth('');
    setQuickDateDay('');
    setQuickCapacityCounts({});
    setQuickCapacityCreationMode('');
    setShowAllTypeCounters({ available_content: false, content_capacity: false });
    setInputClearKey((k) => k + 1);
    setIsTyping(true);
    setIsLoading(true);
    setUiErrorMessage(null);

    try {
      let response: string = '';
      let provider: string;
      let structuredPlanFromResponse: StructuredPlan | undefined;

      // Create AI response message placeholder for streaming
      const aiResponseId = Date.now() + 1;
      const aiResponse: ChatMessage = {
        id: aiResponseId,
        type: 'ai',
        message: '',
        timestamp: new Date().toLocaleTimeString(),
        provider: '',
        campaignId
      };

      if (selectedProvider === 'demo') {
        await new Promise(resolve => setTimeout(resolve, 1500));
        response = generateDemoResponse(messageText, context, campaignData, campaignLearnings);
        provider = 'Demo AI';
        aiResponse.message = response;
        aiResponse.provider = provider;
        setMessages(prev => [...prev, aiResponse]);
        await saveCampaignMessage(aiResponse);
      } else if (selectedProvider === 'gpt' || selectedProvider === 'claude') {
        provider = selectedProvider === 'gpt' ? 'GPT-4' : 'Claude 3.5 Sonnet';
        aiResponse.provider = provider;
        setMessages(prev => [...prev, aiResponse]);

        const mode = context.toLowerCase().includes('daily')
          ? 'refine_day'
          : context.toLowerCase().includes('campaign-planning') || context.toLowerCase().includes('12week-plan') || context.toLowerCase().includes('blueprint-plan') || context.toLowerCase().includes('campaign-recommendations')
          ? 'generate_plan'
          : 'platform_customize';

        setModeLoading((prev) => ({ ...prev, [mode]: true }));

        const targetDay = extractTargetDay(messageText);
        const platforms = extractPlatforms(messageText);

        const conversationHistory = [...messages, userMessage].map((m) => ({
          type: m.type as 'user' | 'ai',
          message: m.message,
        }));
        const userAgreedDuration =
          extractDurationWeeksFromHistory(conversationHistory) ??
          (typeof (collectedPlanningContext?.campaign_duration as number) === 'number'
            ? (collectedPlanningContext?.campaign_duration as number)
            : undefined);

        const totalWeeks = campaignData?.duration_weeks ?? effectiveCurrentPlan?.weeks?.length ?? 12;
        const scopeWeeks = effectiveCurrentPlan && mode === 'generate_plan' ? extractScopeWeeks(messageText, totalWeeks) : null;
        const planResponse = await callCampaignPlanAPI(
          messageText,
          mode,
          {
            durationWeeks: mode === 'generate_plan' ? userAgreedDuration : undefined,
            targetDay: mode !== 'generate_plan' ? targetDay : undefined,
            platforms: mode === 'platform_customize' ? platforms : undefined,
            conversationHistory: mode === 'generate_plan' ? conversationHistory : undefined,
            currentPlan: effectiveCurrentPlan,
            scopeWeeks: scopeWeeks ?? undefined,
            chatContext: context?.toLowerCase().includes('campaign-recommendations') ? 'campaign-recommendations' : undefined,
            vetScope: vetScope,
            planAbortRef,
          }
        );

        if (planResponse.collectedPlanningContext && typeof planResponse.collectedPlanningContext === 'object') {
          setLastCollectedPlanningContextFromApi((prev) => ({ ...(prev ?? {}), ...planResponse.collectedPlanningContext }));
        }

        if (planResponse.plan) {
          structuredPlanFromResponse = planResponse.plan;
          setStructuredPlan(planResponse.plan);
          setStructuredPlanMessageId(aiResponseId);
          setHasGeneratedPlanInSession(true);
          setPlanSource('ai');
          setHasViewedPlanMessageId(aiResponseId);
          setSelectedPlan(serializeStructuredPlanToText(planResponse.plan));
          setShowPlanOverview(true);
          setReviewWeekNumber((prev) => {
            const maxWeeks = Array.isArray(planResponse.plan?.weeks) ? planResponse.plan.weeks.length : 0;
            if (Number.isFinite(prev) && prev >= 1 && prev <= maxWeeks) return prev;
            return 1;
          });
          const isRefineMode = !!effectiveCurrentPlan?.weeks?.length;
          if (isRefineMode) {
            setPendingAmendment(planResponse.plan);
            response = 'Changes applied to your plan. Review below and click **Amend** when ready to save all changes.';
          } else {
            setPendingAmendment(null);
            response = 'Structured plan generated.\n\n**Review your week plan below.** When ready: **Save & view on campaign** to see it on the campaign page, **Save for Later** to keep a copy, or **Submit This Plan** to commit.';
          }
          console.log('Structured plan received', planResponse.plan, 'refineMode:', isRefineMode);
        } else if (planResponse.conversationalResponse) {
          response = enrichPlanningQuestionExamples(planResponse.conversationalResponse);
          if (planResponse.startDateConflictWarning) {
            response += '\n\n' + planResponse.startDateConflictWarning;
          }
        } else if (planResponse.day) {
          setStructuredPlan((prev) =>
            prev ? updatePlanWithRefinedDay(prev, planResponse.day) : prev
          );
          console.log('Refined day received', planResponse.day);
          response = `Updated ${planResponse.day.day} for week ${planResponse.day.week}.`;
        } else if (planResponse.platform_content) {
          setStructuredPlan((prev) =>
            prev ? updatePlanWithPlatformCustomization(prev, planResponse.platform_content) : prev
          );
          console.log('Platform customization received', planResponse.platform_content);
          response = `Updated platform versions for ${planResponse.platform_content.day}.`;
        } else {
          setUiErrorMessage(
            'We did not receive a structured response. Please try again.'
          );
          response = 'No structured response received.';
        }
        if (planResponse.startDateConflictWarning && response) {
          response += '\n\n' + planResponse.startDateConflictWarning;
        }

        setMessages(prev => prev.map(msg =>
          msg.id === aiResponseId
            ? { ...msg, message: response }
            : msg
        ));
        await saveCampaignMessage({ ...aiResponse, message: response });
        setModeLoading((prev) => ({ ...prev, [mode]: false }));
      } else {
        throw new Error('Invalid provider');
      }

      // No auto-save or redirect: flow stops at week plan so user can save / view / commit from chat.

      setIsTyping(false);
      setIsLoading(false);
      focusInputSoon();
    } catch (error) {
      console.error('Error calling AI API:', error);
      const err = error as { name?: string; message?: string };
      const isAbort =
        err?.name === 'AbortError' ||
        (typeof err?.message === 'string' && err.message.toLowerCase().includes('aborted'));
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const isSchemaError =
        !isAbort &&
        (errorMessage.toLowerCase().includes('schema') ||
          errorMessage.toLowerCase().includes('validation'));
      setUiErrorMessage(
        isAbort
          ? 'Plan generation is taking longer than expected. You can try again with a shorter duration (e.g. 4 weeks) or try again in a moment.'
          : isSchemaError
          ? 'We could not parse the AI response. Please try again.'
          : 'We could not complete that request. Please try again in a moment.'
      );
      const lastAssistantQuestion =
        [...messages]
          .reverse()
          .find((m) => m.type === 'ai' && m.provider !== 'Error' && m.message)?.message || '';
      const isAtConfirmationStep =
        /create your (week )?plan now|would you like me to create|I have everything I need/i.test(lastAssistantQuestion);
      const timeoutMessage = isAbort && isAtConfirmationStep
        ? 'That took too long — no worries. Pick a duration below and click **Submit** to try again (fewer weeks is quicker). Your last choices are remembered so you can also say **continue** to use the same settings.'
        : isAbort
          ? 'Plan generation timed out. Try a shorter duration (e.g. 4 weeks) or say **continue** to retry with the same settings.'
          : null;
      const errorResponse: ChatMessage = {
        id: Date.now() + 1,
        type: 'ai',
        message: timeoutMessage
          ?? (isAbort
            ? 'Plan generation timed out. Try a shorter duration (e.g. 4 weeks) or retry in a moment.'
            : `Sorry, I encountered an error with ${selectedProvider.toUpperCase()}. Please check your API key and try again.`),
        timestamp: new Date().toLocaleTimeString(),
        provider: 'Error',
        campaignId
      };
      const repeatedQuestion = extractLastQuestionLine(lastAssistantQuestion);
      const shouldNotRepeatQuestion = isAtConfirmationStep && isAbort;
      const continuationMessage: ChatMessage | null =
        shouldNotRepeatQuestion || !repeatedQuestion
          ? null
          : {
              id: Date.now() + 2,
              type: 'ai',
              message: `Let's continue.\n\n${enrichPlanningQuestionExamples(repeatedQuestion)}`,
              timestamp: new Date().toLocaleTimeString(),
              provider: getProviderName(selectedProvider),
              campaignId,
            };
      setMessages((prev) =>
        continuationMessage ? [...prev, errorResponse, continuationMessage] : [...prev, errorResponse]
      );
      setIsTyping(false);
      setIsLoading(false);
      setModeLoading({});
      focusInputSoon();
    }
  };

  const submitQuickPickAnswer = async (config: QuickPickConfig) => {
    if (isBusy) return;
    if (config.progressiveStyle && quickPickPrimaryStyles.length > 0 && (config.key === 'communication_style' || config.key === 'action_expectation')) {
      const primaries = quickPickPrimaryStyles.join(', ');
      let modifiers = quickPickSecondaryModifiers;
      if (config.key === 'communication_style' && quickPickPrimaryStyles.includes('Simple & easy')) {
        modifiers = modifiers.filter((s) => s !== 'Deep & thoughtful');
      }
      const answer =
        config.key === 'action_expectation'
          ? modifiers.length > 0
            ? `CTA — Primary intent: ${primaries}. Actions: ${modifiers.join(', ')}.`
            : `CTA — Primary intent: ${primaries}.`
          : modifiers.length > 0
            ? `Communication style — Primary: ${primaries}. Secondary: ${modifiers.join(', ')}.`
            : `Communication style — Primary: ${primaries}.`;
      setHideQuickPickPanel(true);
      setQuickPickPrimaryStyles([]);
      setQuickPickSecondaryModifiers([]);
      await sendMessage(answer);
      return;
    }
    const picked = [...selectedQuickOptions];
    const custom = quickCustomizeText.trim();
    const captureCountsOverride = (): Record<string, number> | null => {
      const out: Record<string, number> = {};
      for (const [label, raw] of Object.entries(quickCapacityCounts || {})) {
        const n = Number(String(raw).trim());
        if (!Number.isFinite(n) || n <= 0) continue;
        out[label] = Math.max(0, Math.floor(n));
      }
      return Object.keys(out).length > 0 ? out : null;
    };
    const countPhrase = (label: string, n: number, perWeek: boolean) => {
      const mapped = planningLabelToParseKeyAndTag(label);
      const parseKey = mapped.parseKey;
      const baseUnit = mapped.displayUnit || parseKey;
      const unit = n === 1 ? baseUnit : `${baseUnit}s`;
      const suffix = perWeek ? '/week' : '';
      const tag = mapped.tag ? ` (${mapped.tag})` : '';
      return `${n} ${unit}${suffix}${tag}`;
    };
    let answer = '';
    if (config.key === 'campaign_duration') {
      if (quickCustomizeMode && custom) {
        answer = custom;
      } else if (picked.length > 0) {
        answer = `Yes, proceed with ${picked[0]}.`;
      }
    } else if (config.key === 'available_content') {
      const override = captureCountsOverride();
      if (override) setPlanningAvailableCountsOverride(override);
      const nextHints = Object.entries(quickCapacityCounts)
        .map(([key, value]) => {
          const n = Number(String(value).trim());
          if (!Number.isFinite(n) || n <= 0) return '';
          return canonicalPlanningTypeLabel(key);
        })
        .filter(Boolean);
      if (nextHints.length > 0) {
        setPlanningAvailableTypeHints(Array.from(new Set(nextHints)));
      }
      const mapped = Object.entries(quickCapacityCounts)
        .map(([key, value]) => {
          const n = Number(String(value).trim());
          if (!Number.isFinite(n) || n <= 0) return '';
          return countPhrase(key, Math.floor(n), false);
        })
        .filter(Boolean);
      answer = mapped.join(', ');
    } else if (config.key === 'tentative_start') {
      const y = quickDateYear.trim();
      const m = quickDateMonth.trim().padStart(2, '0');
      const d = quickDateDay.trim().padStart(2, '0');
      if (y.length === 4 && m.length === 2 && d.length === 2) {
        answer = `${y}-${m}-${d}`;
      }
    } else if (config.key === 'content_capacity') {
      const override = captureCountsOverride();
      if (override) setPlanningCapacityCountsOverride(override);
      const nextHints = Object.entries(quickCapacityCounts)
        .map(([key, value]) => {
          const n = Number(String(value).trim());
          if (!Number.isFinite(n) || n <= 0) return '';
          return canonicalPlanningTypeLabel(key);
        })
        .filter(Boolean);
      if (nextHints.length > 0) {
        setPlanningCapacityTypeHints(Array.from(new Set(nextHints)));
      }
      const mapped = Object.entries(quickCapacityCounts)
        .map(([key, value]) => {
          const n = Number(String(value).trim());
          if (!Number.isFinite(n) || n <= 0) return '';
          return countPhrase(key, Math.floor(n), true);
        })
        .filter(Boolean);
      if (quickCapacityCreationMode) {
        const modeLabel =
          quickCapacityCreationMode === 'manual'
            ? 'manual'
            : quickCapacityCreationMode === 'ai-assisted'
            ? 'AI-assisted'
            : 'full AI';
        mapped.push(`creation: ${modeLabel}`);
      }
      answer = mapped.join(', ');
    } else if (config.key === 'platform_content_types') {
      const orderedPlatforms = planningSelectedPlatforms.length > 0
        ? planningSelectedPlatforms
        : Array.from(new Set(Object.keys(quickPlatformContentTypes)));
      const normalizePlatformContentType = (label: string): string => {
        const n = String(label || '').toLowerCase().trim();
        if (!n) return '';
        if (n.includes('blog') || n.includes('article')) return 'article';
        if (n.includes('white')) return 'white_paper';
        if (n.includes('slide')) return 'slideware';
        if (n.includes('carousel')) return 'carousel';
        if (n.includes('song') || n.includes('audio')) return 'song';
        if (n.includes('thread')) return 'thread';
        if (n.includes('space')) return 'space';
        if (n.includes('short')) return 'short';
        if (n.includes('live')) return 'live';
        if (n.includes('reel')) return 'reel';
        if (n.includes('story')) return 'story';
        if (n.includes('video')) return 'video';
        if (n.includes('post')) return 'post';
        return n.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
      };
      const parts = orderedPlatforms
        .map((p) => {
          const selections = quickPlatformContentTypes[p] || [];
          const allowed = getEligiblePlatformPlanningTypeOptions({
            platform: p,
            platformContentTypeOptions,
            eligible: eligiblePlanningTypes,
          });
          const filtered = selections.filter((s) => allowed.includes(s));
          if (filtered.length === 0) return '';
          const formatted = filtered.join(', ');
          const name = platformLabels[p] || p;
          return `${name}: ${formatted}`;
        })
        .filter(Boolean);

      // Persist canonical per-platform preferences so they are available at final plan generation time.
      const prefs: Record<string, string[]> = {};
      for (const p of orderedPlatforms) {
        const selections = quickPlatformContentTypes[p] || [];
        const allowed = getEligiblePlatformPlanningTypeOptions({
          platform: p,
          platformContentTypeOptions,
          eligible: eligiblePlanningTypes,
        });
        const filtered = selections.filter((s) => allowed.includes(s));
        const normalized = Array.from(new Set(filtered.map(normalizePlatformContentType).filter(Boolean)));
        if (normalized.length > 0) prefs[p] = normalized;
      }
      if (Object.keys(prefs).length > 0) {
        setPlanningPlatformContentTypePrefs(prefs);
      }

      if (quickCustomizeMode && custom) parts.push(custom);
      answer = parts.join('; ');
    } else if (config.key === 'platform_content_requests') {
      setHasProvidedPlatformContentRequests(true);
      answer = 'Platform content requests captured.';
    } else if (config.key === 'exclusive_campaigns') {
      setHasProvidedExclusiveCampaigns(true);
      const cleaned = (planningExclusiveCampaigns || [])
        .map((row) => {
          const platform = String((row as any)?.platform || '').trim().toLowerCase();
          const content_type = String((row as any)?.content_type || '').trim();
          const n = Number(String((row as any)?.count_per_week || '').replace(/\D/g, '').slice(0, 2));
          const count_per_week = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
          if (!platform || !content_type || count_per_week <= 0) return null;
          return { platform, content_type, count_per_week };
        })
        .filter(Boolean);
      answer = cleaned.length > 0 ? 'Yes.' : 'No.';
    } else {
      const values = [...picked];
      if (quickCustomizeMode && custom) values.push(custom);
      answer = values.join(', ');
    }
    if (!answer.trim()) return;
    setHideQuickPickPanel(true);
    if (config.key === 'available_content' || config.key === 'content_capacity') {
      setQuickCapacityCounts({});
      setShowAllTypeCounters((prev) => ({
        ...prev,
        [config.key]: false,
      }));
    }
    await sendMessage(answer);
  };

  const renderQuickPickPanel = (config: QuickPickConfig | null) => {
    if (!config || hideQuickPickPanel) return null;
    if (config.key === 'available_content') {
      const showAll = Boolean(showAllTypeCounters.available_content);
      const visibleOptions = showAll ? config.options : config.options.slice(0, 10);
      const hasAnyInput = Object.values(quickCapacityCounts).some((v) => {
        const n = Number(String(v).trim());
        return Number.isFinite(n) && n > 0;
      });
      const canSubmit = hasAnyInput;
      const customKeys = Object.keys(quickCapacityCounts).filter((k) => {
        if (config.options.includes(k)) return false;
        const n = Number(String(quickCapacityCounts[k] ?? '').trim());
        return Number.isFinite(n) && n > 0;
      });
      return (
        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-xs text-gray-600 mb-2">
            Enter counts for any existing content you already have. If none, click <span className="font-semibold">None</span>.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
            {visibleOptions.map((option) => (
              <label key={option} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
                <span className="text-xs text-gray-700 w-20 shrink-0">{option}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  value={quickCapacityCounts[option] ?? ''}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 3);
                    setQuickCapacityCounts((prev) => ({ ...prev, [option]: value }));
                  }}
                  placeholder="0"
                  className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  disabled={isBusy}
                />
              </label>
            ))}
          </div>
          {quickCustomizeMode ? (
            <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
              <div className="text-xs text-gray-600 mb-2">Add another content type (optional).</div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={quickCustomContentType}
                  onChange={(e) => setQuickCustomContentType(e.target.value)}
                  placeholder="Content type (e.g., White Papers)"
                  className="flex-1 min-w-[180px] px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  disabled={isBusy}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  value={quickCustomContentCount}
                  onChange={(e) => setQuickCustomContentCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  placeholder="0"
                  className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  disabled={isBusy}
                />
                <button
                  type="button"
                  disabled={
                    isBusy ||
                    !canonicalPlanningTypeLabel(quickCustomContentType).trim() ||
                    !(Number(quickCustomContentCount) > 0)
                  }
                  onClick={() => {
                    const label = canonicalPlanningTypeLabel(quickCustomContentType).trim();
                    const n = Number(quickCustomContentCount);
                    if (!label || !Number.isFinite(n) || n <= 0) return;
                    setQuickCapacityCounts((prev) => {
                      const curr = Number(String(prev[label] ?? '0').trim());
                      const next = (Number.isFinite(curr) ? curr : 0) + Math.floor(n);
                      return { ...prev, [label]: String(Math.min(999, Math.max(0, next))) };
                    });
                    setQuickCustomContentCount('');
                  }}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-white text-gray-700 border border-gray-300 hover:border-indigo-400 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {customKeys.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {customKeys.map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setQuickCapacityCounts((prev) => {
                          const next = { ...prev };
                          delete next[k];
                          return next;
                        });
                      }}
                      className="px-2 py-1 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-700 hover:border-rose-300"
                      title="Remove"
                    >
                      {k}: {quickCapacityCounts[k]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {config.options.length > 10 ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() =>
                  setShowAllTypeCounters((prev) => ({ ...prev, available_content: !prev.available_content }))
                }
                className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
              >
                {showAll ? 'Show fewer types' : 'Show all types'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={isBusy}
              onClick={async () => {
                setHideQuickPickPanel(true);
                await sendMessage('No');
              }}
              className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-emerald-400"
            >
              None
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setQuickCustomizeText('');
                setSelectedQuickOptions([]);
                setQuickCustomContentType('');
                setQuickCustomContentCount('');
                setQuickCustomizeMode((prev) => !prev);
              }}
              className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
            >
              {quickCustomizeMode ? 'Done' : 'Customize'}
            </button>
            <button
              type="button"
              disabled={isBusy || !canSubmit}
              onClick={() => submitQuickPickAnswer(config)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
            >
              Submit
            </button>
          </div>
        </div>
      );
    }
    if (config.key === 'tentative_start') {
      const canSubmitDate =
        quickDateYear.trim().length === 4 &&
        quickDateMonth.trim().length >= 1 &&
        quickDateDay.trim().length >= 1;
      return (
        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-xs text-gray-600 mb-2">
            Select date fields and submit (YYYY-MM-DD).
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={quickDateYear}
              onChange={(e) => setQuickDateYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="YYYY"
              className="w-24 px-2 py-2 border border-gray-300 rounded-md text-sm"
              disabled={isBusy}
            />
            <span className="text-gray-500">-</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={quickDateMonth}
              onChange={(e) => setQuickDateMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
              placeholder="MM"
              className="w-16 px-2 py-2 border border-gray-300 rounded-md text-sm"
              disabled={isBusy}
            />
            <span className="text-gray-500">-</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={quickDateDay}
              onChange={(e) => setQuickDateDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
              placeholder="DD"
              className="w-16 px-2 py-2 border border-gray-300 rounded-md text-sm"
              disabled={isBusy}
            />
            <button
              type="button"
              disabled={isBusy || !canSubmitDate}
              onClick={() => submitQuickPickAnswer(config)}
              className="px-3 py-2 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
            >
              Submit
            </button>
          </div>
        </div>
      );
    }
    if (config.key === 'content_capacity') {
      const showAll = Boolean(showAllTypeCounters.content_capacity);
      const visibleOptions = showAll ? config.options : config.options.slice(0, 10);
      const hasPreparation = !!quickCapacityCreationMode;
      const hasCapacityInput = Object.values(quickCapacityCounts).some((v) => {
        const n = Number(String(v).trim());
        return Number.isFinite(n) && n > 0;
      });
      const customKeys = Object.keys(quickCapacityCounts).filter((k) => {
        if (config.options.includes(k)) return false;
        const n = Number(String(quickCapacityCounts[k] ?? '').trim());
        return Number.isFinite(n) && n > 0;
      });
      return (
        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-xs text-gray-600 mb-2">
            <strong>(1) How will you create?</strong> Pick one: Manual, AI‑assisted, or Full AI.
          </div>
          <div className="text-xs font-medium text-gray-700 mb-1.5">
            Your choice
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {(['manual', 'ai-assisted', 'full-ai'] as const).map((mode) => {
              const selected = quickCapacityCreationMode === mode;
              const label = mode === 'manual' ? 'Manual' : mode === 'ai-assisted' ? 'AI‑assisted' : 'Full AI';
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={isBusy}
                  onClick={() => setQuickCapacityCreationMode((prev) => (prev === mode ? '' : mode))}
                  className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                    selected
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="text-xs font-medium text-gray-700 mb-1.5">
            (2) How many per week? (e.g. 2 posts, 1 video)
          </div>
          {!hasPreparation ? (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-2">
              Pick an option above first, then add your counts.
            </div>
          ) : null}
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2 ${!hasPreparation ? 'opacity-60 pointer-events-none' : ''}`}>
            {visibleOptions.map((option) => (
              <label key={option} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
                <span className="text-xs text-gray-700 w-20 shrink-0">{option}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={quickCapacityCounts[option] ?? ''}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 2);
                    setQuickCapacityCounts((prev) => ({ ...prev, [option]: value }));
                  }}
                  placeholder="0"
                  className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  disabled={isBusy}
                />
                <span className="text-xs text-gray-500">/week</span>
              </label>
            ))}
          </div>
          {quickCustomizeMode ? (
            <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
              <div className="text-xs text-gray-600 mb-2">Add another content type (optional).</div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={quickCustomContentType}
                  onChange={(e) => setQuickCustomContentType(e.target.value)}
                  placeholder="Content type (e.g., White Papers)"
                  className="flex-1 min-w-[180px] px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  disabled={isBusy}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={quickCustomContentCount}
                  onChange={(e) => setQuickCustomContentCount(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  placeholder="0"
                  className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  disabled={isBusy}
                />
                <button
                  type="button"
                  disabled={
                    isBusy ||
                    !canonicalPlanningTypeLabel(quickCustomContentType).trim() ||
                    !(Number(quickCustomContentCount) > 0)
                  }
                  onClick={() => {
                    const label = canonicalPlanningTypeLabel(quickCustomContentType).trim();
                    const n = Number(quickCustomContentCount);
                    if (!label || !Number.isFinite(n) || n <= 0) return;
                    setQuickCapacityCounts((prev) => {
                      const curr = Number(String(prev[label] ?? '0').trim());
                      const next = (Number.isFinite(curr) ? curr : 0) + Math.floor(n);
                      return { ...prev, [label]: String(Math.min(99, Math.max(0, next))) };
                    });
                    setQuickCustomContentCount('');
                  }}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-white text-gray-700 border border-gray-300 hover:border-indigo-400 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {customKeys.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {customKeys.map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setQuickCapacityCounts((prev) => {
                          const next = { ...prev };
                          delete next[k];
                          return next;
                        });
                      }}
                      className="px-2 py-1 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-700 hover:border-rose-300"
                      title="Remove"
                    >
                      {k}: {quickCapacityCounts[k]}/week
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {config.options.length > 10 ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() =>
                  setShowAllTypeCounters((prev) => ({ ...prev, content_capacity: !prev.content_capacity }))
                }
                className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
              >
                {showAll ? 'Show fewer types' : 'Show all types'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setQuickCustomizeText('');
                setSelectedQuickOptions([]);
                setQuickCustomContentType('');
                setQuickCustomContentCount('');
                setQuickCustomizeMode((prev) => !prev);
              }}
              className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
            >
              {quickCustomizeMode ? 'Done' : 'Customize'}
            </button>
            <button
              type="button"
              disabled={isBusy || !hasPreparation || !hasCapacityInput}
              onClick={() => submitQuickPickAnswer(config)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
            >
              Submit selection
            </button>
          </div>
        </div>
      );
    }
    if (config.key === 'platform_content_types') {
      const platforms = planningSelectedPlatforms || [];
      const hasPlatforms = platforms.length > 0;
      const hasAnySelection = platforms.some((p) => {
        const allowed = getEligiblePlatformPlanningTypeOptions({
          platform: p,
          platformContentTypeOptions,
          eligible: eligiblePlanningTypes,
        });
        return (quickPlatformContentTypes[p] || []).some((sel) => allowed.includes(sel));
      });
      return (
        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-xs text-gray-600 mb-2">
            For each platform, pick the content types you’ll use. Next we’ll set how often (aligned with your capacity).
          </div>
          {quickCustomizeMode ? (
            <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
              <div className="text-xs text-gray-600 mb-2">Tailored input (optional).</div>
              <textarea
                value={quickCustomizeText}
                onChange={(e) => setQuickCustomizeText(e.target.value)}
                placeholder='Example: "LinkedIn: posts, articles; Instagram: reels"'
                className="w-full min-h-[72px] mb-2 px-3 py-2 border border-gray-300 rounded-md text-sm"
                disabled={isBusy}
              />
            </div>
          ) : !hasPlatforms ? (
            <div className="text-xs text-gray-500">
              (No platforms detected yet. Please answer the platforms question first, or click Customize and type your answer.)
            </div>
          ) : (
            <div className="space-y-3 mb-2">
              {platforms.map((platform) => {
                const platformName = platformLabels[platform] || platform;
                const options = getEligiblePlatformPlanningTypeOptions({
                  platform,
                  platformContentTypeOptions,
                  eligible: eligiblePlanningTypes,
                });
                const selected = quickPlatformContentTypes[platform] || [];
                return (
                  <div key={platform} className="bg-white border border-gray-200 rounded-md p-2">
                    <div className="text-xs font-medium text-gray-700 mb-2">{platformName}</div>
                    <div className="flex flex-wrap gap-2">
                      {options.map((opt, idx) => {
                        const isSelected = selected.includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setQuickPlatformContentTypes((prev) => {
                                const curr = prev[platform] || [];
                                const next = curr.includes(opt) ? curr.filter((x) => x !== opt) : [...curr, opt];
                                return { ...prev, [platform]: next };
                              });
                            }}
                            className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                            }`}
                            title={opt}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setQuickCustomizeText('');
                setSelectedQuickOptions([]);
                setQuickCustomizeMode((prev) => !prev);
              }}
              className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
            >
              {quickCustomizeMode ? 'Back to options' : 'Customize'}
            </button>
            {quickCustomizeMode ? (
              <button
                type="button"
                disabled={isBusy || !quickCustomizeText.trim()}
                onClick={() => {
                  const text = quickCustomizeText.trim();
                  if (!text) return;
                  setHideQuickPickPanel(true);
                  void sendMessage(text);
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
              >
                Submit custom
              </button>
            ) : (
              <button
                type="button"
                disabled={isBusy || !hasAnySelection}
                onClick={() => submitQuickPickAnswer(config)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
              >
                Submit selection
              </button>
            )}
          </div>
        </div>
      );
    }
    if (config.key === 'platform_content_requests') {
      const platforms = planningSelectedPlatforms || [];
      const hasPlatforms = platforms.length > 0;
      const hasCatalog = platformCatalogPlatforms && platformCatalogPlatforms.length > 0;
      const hasAnyRequest = Object.values(planningPlatformContentRequests || {}).some((byType) =>
        Object.values(byType || {}).some((v) => {
          const n = Number(String(v || '').replace(/\D/g, '').slice(0, 2));
          return Number.isFinite(n) && n > 0;
        })
      );
      const normalizeCustomTypeKey = (label: string): string => {
        const s = String(label || '').trim();
        if (!s) return '';
        const n = s.toLowerCase().trim();
        if (n.includes('white')) return 'white_papers';
        return n.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
      };
      const sumOverrideCounts = (value: Record<string, number> | null): number => {
        if (!value) return 0;
        return Object.values(value).reduce((a, b) => a + (Number(b) || 0), 0);
      };
      const coerceLegacyCountsTotal = (value: unknown): { total: number; known: boolean } => {
        if (!value) return { total: 0, known: false };
        if (typeof value === 'object' && !Array.isArray(value)) {
          const obj = value as any;
          const num = (v: any) => {
            const n = typeof v === 'number' ? v : Number(v);
            return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
          };
          const baseTotal =
            num(obj.post) + num(obj.video) + num(obj.blog) + num(obj.story) + num(obj.thread);
          const breakdown =
            obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)
              ? (obj.breakdown as Record<string, unknown>)
              : null;
          const breakdownTotal = breakdown
            ? (Object.values(breakdown) as any[]).reduce((sum: number, v: any) => {
                const n = typeof v === 'number' ? v : Number(v);
                return sum + (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
              }, 0)
            : 0;
          const known = baseTotal > 0 || breakdownTotal > 0 || Boolean(obj._declared_none);
          return { total: baseTotal + breakdownTotal, known };
        }
        if (typeof value === 'string') {
          const t = value.toLowerCase();
          const pull = (re: RegExp) => {
            let sum = 0;
            let m: RegExpExecArray | null = null;
            while ((m = re.exec(t)) !== null) sum += Number(m[1] || 0) || 0;
            return sum;
          };
          const total =
            pull(/\b(\d{1,3})\s*(?:posts?|feed\s*posts?)\b/g) +
            pull(/\b(\d{1,3})\s*(?:videos?|reels?|shorts?|long\s*videos?)\b/g) +
            pull(/\b(\d{1,3})\s*(?:blogs?|articles?|white\s*papers?)\b/g) +
            pull(/\b(\d{1,3})\s*stories?\b/g) +
            pull(/\b(\d{1,3})\s*threads?\b/g);
          const known = /\b\d{1,3}\b/.test(t) && /(post|video|blog|article|white\s*paper|story|thread|reel|short)/i.test(t);
          return { total, known };
        }
        return { total: 0, known: false };
      };
      const exclusiveTotal = (planningExclusiveCampaigns || []).reduce((sum, row) => {
        const n = Number(String((row as any)?.count_per_week ?? '').replace(/\D/g, '').slice(0, 2));
        return sum + (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
      }, 0);
      const availableOverrideTotal = sumOverrideCounts(planningAvailableCountsOverride);
      const capacityOverrideTotal = sumOverrideCounts(planningCapacityCountsOverride);
      const availableFromFields = (prefilledPlanning as any)?.available_content ?? (collectedPlanningContext as any)?.available_content;
      const capacityFromFields =
        (prefilledPlanning as any)?.weekly_capacity ??
        (prefilledPlanning as any)?.content_capacity ??
        (collectedPlanningContext as any)?.weekly_capacity ??
        (collectedPlanningContext as any)?.content_capacity;
      const availableLegacy = coerceLegacyCountsTotal(availableFromFields);
      const capacityLegacy = coerceLegacyCountsTotal(capacityFromFields);
      const availableTotal = availableOverrideTotal > 0 ? availableOverrideTotal : availableLegacy.total;
      const capacityTotalRaw = capacityOverrideTotal > 0 ? capacityOverrideTotal : capacityLegacy.total;
      const effectiveCapacity = Math.max(0, capacityTotalRaw - exclusiveTotal);
      const supplyTotal = availableTotal + effectiveCapacity;
      const hasKnownSupply =
        capacityOverrideTotal > 0 ||
        capacityLegacy.known ||
        availableOverrideTotal > 0 ||
        availableLegacy.known ||
        exclusiveTotal > 0;

      const computeRequestTotals = (requests: Record<string, Record<string, string>>) => {
        const postingsByType: Record<string, number> = {};
        const maxByType: Record<string, number> = {};
        const sumByType: Record<string, number> = {};
        let postingsTotal = 0;
        for (const [p, byType] of Object.entries(requests || {})) {
          if (!p) continue;
          for (const [ct, raw] of Object.entries(byType || {})) {
            const n = Number(String(raw || '').replace(/\D/g, '').slice(0, 2));
            const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
            if (!ct || count <= 0) continue;
            postingsTotal += count;
            postingsByType[ct] = (postingsByType[ct] ?? 0) + count;
          }
        }
        // unique (sharing) counts per type
        const perTypePerPlatform: Record<string, Record<string, number>> = {};
        for (const [p, byType] of Object.entries(requests || {})) {
          for (const [ct, raw] of Object.entries(byType || {})) {
            const n = Number(String(raw || '').replace(/\D/g, '').slice(0, 2));
            const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
            if (!ct || count <= 0) continue;
            perTypePerPlatform[ct] = perTypePerPlatform[ct] || {};
            perTypePerPlatform[ct]![p] = (perTypePerPlatform[ct]![p] ?? 0) + count;
          }
        }
        for (const [ct, byP] of Object.entries(perTypePerPlatform)) {
          const counts = Object.values(byP);
          const mx = counts.length ? Math.max(...counts) : 0;
          const sm = counts.reduce((a, b) => a + (Number(b) || 0), 0);
          maxByType[ct] = mx;
          sumByType[ct] = sm;
        }
        const uniqueTotal = Object.keys(perTypePerPlatform).reduce((sum, ct) => {
          const add = planningCrossPlatformSharingEnabled ? (maxByType[ct] ?? 0) : (sumByType[ct] ?? 0);
          return sum + (Number(add) || 0);
        }, 0);
        return { postingsTotal, uniqueTotal, perTypePerPlatform, maxByType, sumByType };
      };

      const cleanedRequests: Record<string, Record<string, string>> = (() => {
        const next: Record<string, Record<string, string>> = {};
        for (const [p, byType] of Object.entries(planningPlatformContentRequests || {})) {
          const out: Record<string, string> = {};
          for (const [ct, raw] of Object.entries(byType || {})) {
            const label = prettyContentTypeLabel(ct);
            if (!isEligiblePlanningType(label, eligiblePlanningTypes)) continue;
            const n = Number(String(raw || '').replace(/\D/g, '').slice(0, 2));
            if (!Number.isFinite(n) || n <= 0) continue;
            out[ct] = String(Math.min(99, Math.max(1, Math.floor(n))));
          }
          if (Object.keys(out).length > 0) next[p] = out;
        }
        return next;
      })();

      const totals = computeRequestTotals(cleanedRequests);
      const isOverSupply = hasKnownSupply && totals.uniqueTotal > 0 && totals.uniqueTotal > supplyTotal;
      const isValid = totals.uniqueTotal > 0 && !isOverSupply;
      const overBy = Math.max(0, totals.uniqueTotal - supplyTotal);
      const sharingBreakdown = (() => {
        if (!planningCrossPlatformSharingEnabled) return [];
        const out: Array<{
          contentType: string;
          unique: number;
          sharedSlots: number;
          platformOnlySlots: number;
          sampleSharedPlatforms: string[];
        }> = [];
        const perType = (totals as any).perTypePerPlatform as Record<string, Record<string, number>>;
        const maxByType = (totals as any).maxByType as Record<string, number>;
        for (const [ct, byP] of Object.entries(perType || {})) {
          const unique = Number(maxByType?.[ct] ?? 0) || 0;
          if (unique <= 0) continue;
          const slots: string[][] = [];
          const platforms = Object.keys(byP).filter(Boolean).sort();
          for (let i = 1; i <= unique; i += 1) {
            const slotPlatforms = platforms.filter((p) => (Number(byP[p] ?? 0) || 0) >= i);
            if (slotPlatforms.length > 0) slots.push(slotPlatforms);
          }
          const sharedSlots = slots.filter((s) => s.length > 1).length;
          const platformOnlySlots = Math.max(0, unique - sharedSlots);
          const sampleShared = slots.find((s) => s.length > 1) ?? [];
          out.push({
            contentType: ct,
            unique,
            sharedSlots,
            platformOnlySlots,
            sampleSharedPlatforms: sampleShared,
          });
        }
        return out
          .filter((r) => r.sharedSlots > 0)
          .sort((a, b) => b.sharedSlots - a.sharedSlots || b.unique - a.unique || a.contentType.localeCompare(b.contentType));
      })();
      return (
        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-xs text-gray-600 mb-2">
            Set frequency per content type per platform (aligned with your capacity), then choose same topic across platforms or different, and same day vs staggered vs AI.
          </div>
          <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
            <div className="text-xs font-medium text-gray-700 mb-2">(1) Frequency per content type — match or adjust to your capacity</div>
            <div className="text-[11px] text-gray-500 mb-2">Set how many of each type per week per platform below.</div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700 mt-3 pt-2 border-t border-gray-100">
              <span className="font-medium text-gray-700">(2) Same topic across platforms?</span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={planningCrossPlatformSharingEnabled}
                  disabled={isBusy}
                  onChange={(e) => setPlanningCrossPlatformSharingEnabled(e.target.checked)}
                />
                <span>Yes — reuse one piece across platforms (same topic)</span>
              </label>
              <span className="text-gray-400">|</span>
              <span className="text-gray-500">Uncheck = different content per platform</span>
            </div>
            {planningCrossPlatformSharingEnabled && (
              <p className="text-[11px] text-gray-600 mt-1.5">
                <strong>Unique</strong> = pieces to create. Same piece can go to many platforms. E.g. 2 posts × 4 platforms = <strong>2 unique</strong>, 8 postings; 2 videos × 4 platforms = <strong>2 unique</strong>, 8 postings. Supply is compared to this total.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700 mt-2">
              <span className="font-medium text-gray-700">(3) Publish same day or staggered?</span>
              <label className="flex items-center gap-2">
                <select
                  value={planningCrossPlatformScheduleMode}
                  disabled={isBusy}
                  onChange={(e) => setPlanningCrossPlatformScheduleMode(e.target.value as any)}
                  className="rounded border border-gray-200 px-2 py-1 text-xs"
                >
                  <option value="ai_recommended">Let AI decide</option>
                  <option value="staggered">Staggered (different days)</option>
                  <option value="same_time">Same day on all platforms</option>
                </select>
              </label>
              <span className="text-gray-500">
                Unique pieces/week: <span className="font-semibold text-gray-800">{totals.uniqueTotal || 0}</span> • Platform postings/week: <span className="font-semibold text-gray-800">{totals.postingsTotal || 0}</span> • Supply/week: <span className="font-semibold text-gray-800">{supplyTotal}</span>
              </span>
            </div>
            {planningCrossPlatformSharingEnabled && totals.uniqueTotal > 0 && totals.postingsTotal > totals.uniqueTotal && (
              <div className="mt-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                Sharing enabled: we’ll create <span className="font-semibold">{totals.uniqueTotal}</span> unique piece(s) and reuse them across platforms to fulfill <span className="font-semibold">{totals.postingsTotal}</span> total postings/week.
                <div className="text-emerald-700 mt-1">
                  Unique = per content type (e.g. 2 posts on 4 platforms = 2 unique, 8 postings; 1 post + 1 video on 4 platforms = 2 unique). Sharing is across platforms only — same type can be reused on each platform.
                </div>
                {sharingBreakdown.length > 0 ? (
                  <div className="text-emerald-700 mt-1">
                    Example: {sharingBreakdown.slice(0, 2).map((row) => {
                      const label = prettyContentTypeLabel(row.contentType);
                      const platforms = row.sampleSharedPlatforms
                        .map((p) => platformLabels[p] || p)
                        .join(', ');
                      const sharedPart = row.sharedSlots > 0 ? `${row.sharedSlots} shared` : '';
                      const onlyPart = row.platformOnlySlots > 0 ? `${row.platformOnlySlots} platform-only` : '';
                      const parts = [sharedPart, onlyPart].filter(Boolean).join(' + ');
                      return `${label}: ${parts}${platforms ? ` (shared across ${platforms})` : ''}`;
                    }).join(' • ')}
                  </div>
                ) : null}
              </div>
            )}
            {!isValid && totals.uniqueTotal > 0 && isOverSupply && (() => {
              const byType = (planningCrossPlatformSharingEnabled
                ? (totals as any).maxByType
                : (totals as any).sumByType) as Record<string, number> | undefined;
              const breakdown =
                byType && Object.keys(byType).length > 0
                  ? Object.entries(byType)
                      .filter(([, n]) => Number(n) > 0)
                      .map(([ct, n]) => `${prettyContentTypeLabel(ct)} ${n}`)
                      .join(', ')
                  : null;
              return (
                <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-2">
                  <p className="font-medium">Requested unique pieces/week ({totals.uniqueTotal}) exceeds your supply ({supplyTotal}) by {overBy}.</p>
                  {breakdown ? (
                    <p className="mt-1 text-red-700">Breakdown: {breakdown} → total {totals.uniqueTotal}. Reduce any count below by at least {overBy}.</p>
                  ) : null}
                  <p className="mt-1.5 text-red-800">
                    <strong>How to fix:</strong> In the grid below, reduce one or more counts so unique pieces ≤ {supplyTotal}. For example: change one <strong>1/week</strong> to <strong>0</strong>, or a <strong>2/week</strong> to <strong>1</strong>. You can also increase supply by setting higher capacity or available content earlier in this chat.
                  </p>
                </div>
              );
            })()}
            {!hasKnownSupply && totals.uniqueTotal > 0 && (
              <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Supply/week is unknown here (capacity and available content weren’t detected in the chat UI yet). You can still submit expectations — we’ll validate again once capacity is available.
              </div>
            )}
          </div>
          {!hasCatalog ? (
            <div className="text-xs text-red-600 mb-2">
              Platform intelligence catalog is required (DB-driven). Please ensure platform tables are available.
            </div>
          ) : null}
          {!hasPlatforms ? (
            <div className="text-xs text-gray-500">
              (No platforms detected yet. Please answer the platforms question first, or click Customize and type your answer.)
            </div>
          ) : (
            <div className="space-y-3 mb-2">
              {quickCustomizeMode ? (
                <div className="rounded-md border border-gray-200 bg-white p-2">
                  <div className="text-xs text-gray-600 mb-2">Add a custom content type (optional).</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={quickCustomPlatform || platforms[0] || ''}
                      disabled={isBusy}
                      onChange={(e) => setQuickCustomPlatform(e.target.value)}
                      className="rounded border border-gray-200 px-2 py-1.5 text-xs"
                    >
                      {platforms.map((p) => (
                        <option key={p} value={p}>
                          {platformLabels[p] || p}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={quickCustomContentType}
                      onChange={(e) => setQuickCustomContentType(e.target.value)}
                      placeholder="Content type (e.g., White Papers)"
                      className="flex-1 min-w-[180px] px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                      disabled={isBusy}
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      value={quickCustomContentCount}
                      onChange={(e) => setQuickCustomContentCount(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      placeholder="0"
                      className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                      disabled={isBusy}
                    />
                    <button
                      type="button"
                      disabled={
                        isBusy ||
                        !hasPlatforms ||
                        !normalizeCustomTypeKey(quickCustomContentType) ||
                        !(Number(quickCustomContentCount) > 0)
                      }
                      onClick={() => {
                        const platform = String(quickCustomPlatform || platforms[0] || '').trim();
                        const key = normalizeCustomTypeKey(quickCustomContentType);
                        const n = Number(quickCustomContentCount);
                        if (!platform || !key || !Number.isFinite(n) || n <= 0) return;
                        const digits = String(Math.min(99, Math.max(0, Math.floor(n))));
                        setPlanningPlatformContentRequests((prev) => {
                          const current = { ...(prev?.[platform] || {}) };
                          current[key] = digits;
                          return { ...(prev || {}), [platform]: current };
                        });
                        setQuickCustomContentCount('');
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-white text-gray-700 border border-gray-300 hover:border-indigo-400 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : null}
              {platforms.map((platform) => {
                const platformName = platformLabels[platform] || platform;
                const rawTypes = getAllSupportedContentTypeKeysForPlatform(platform, platformContentTypeRawOptions, platformContentTypeOptions);
                const byType = planningPlatformContentRequests?.[platform] || {};
                const extraTypes = Object.keys(byType).filter((ct) => !rawTypes.includes(ct));
                const allTypes = [...rawTypes, ...extraTypes];
                return (
                  <div key={platform} className="bg-white border border-gray-200 rounded-md p-2">
                    <div className="text-xs font-medium text-gray-700 mb-2">{platformName}</div>
                    {allTypes.length === 0 ? (
                      <div className="text-xs text-gray-500">No DB content types found for this platform.</div>
                    ) : (
                      <div className="space-y-2">
                        {allTypes.map((ct) => {
                          const label = prettyContentTypeLabel(ct);
                          const value = String(byType?.[ct] ?? '');
                          const checked = value.replace(/\D/g, '').length > 0;
                          const checkboxId = `platform-${platform}-${ct}-cb`;
                          return (
                            <div
                              key={ct}
                              className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2"
                            >
                              <input
                                id={checkboxId}
                                type="checkbox"
                                checked={checked}
                                disabled={isBusy}
                                onChange={(e) => {
                                  const nextChecked = e.target.checked;
                                  setPlanningPlatformContentRequests((prev) => {
                                    const current = { ...(prev?.[platform] || {}) };
                                    if (!nextChecked) {
                                      delete current[ct];
                                    } else if (!current[ct]) {
                                      current[ct] = '1';
                                    }
                                    return { ...(prev || {}), [platform]: current };
                                  });
                                }}
                              />
                              <label htmlFor={checkboxId} className="text-xs text-gray-700 w-44 shrink-0 cursor-pointer select-none">{label}</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                value={value}
                                onChange={(e) => {
                                  const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                                  setPlanningPlatformContentRequests((prev) => {
                                    const current = { ...(prev?.[platform] || {}) };
                                    if (!digits) {
                                      delete current[ct];
                                    } else {
                                      current[ct] = digits;
                                    }
                                    return { ...(prev || {}), [platform]: current };
                                  });
                                }}
                                placeholder="0"
                                className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                                disabled={isBusy || !checked}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="text-xs text-gray-500">/week</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setQuickCustomizeText('');
                setSelectedQuickOptions([]);
                setQuickCustomContentType('');
                setQuickCustomContentCount('');
                setQuickCustomizeMode((prev) => !prev);
              }}
              className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
            >
              {quickCustomizeMode ? 'Done' : 'Customize'}
            </button>
            <button
              type="button"
              disabled={isBusy || !hasCatalog || !hasPlatforms || !hasAnyRequest || !isValid}
              onClick={() => submitQuickPickAnswer(config)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
            >
              Submit selection
            </button>
          </div>
        </div>
      );
    }
    if (config.key === 'exclusive_campaigns') {
      const platforms = planningSelectedPlatforms || [];
      const hasPlatforms = platforms.length > 0;
      const hasCatalog = platformCatalogPlatforms && platformCatalogPlatforms.length > 0;
      const canAdd = hasPlatforms && hasCatalog;
      const addRow = () => {
        const firstPlatform = platforms[0] || '';
        const firstType = firstPlatform ? (platformContentTypeRawOptions[firstPlatform]?.[0] || '') : '';
        setPlanningExclusiveCampaigns((prev) => [
          ...(prev || []),
          { platform: firstPlatform, content_type: firstType, count_per_week: '1' },
        ]);
      };
      return (
        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-xs text-gray-600 mb-2">
            Add any platform-exclusive campaigns (per week). If none, submit without adding rows.
          </div>
          {!hasCatalog ? (
            <div className="text-xs text-red-600 mb-2">
              Platform intelligence catalog is required (DB-driven). Please ensure platform tables are available.
            </div>
          ) : null}
          {!hasPlatforms ? (
            <div className="text-xs text-gray-500">
              (No platforms detected yet. Please answer the platforms question first, or click Customize and type your answer.)
            </div>
          ) : (
            <div className="space-y-2 mb-2">
              {(planningExclusiveCampaigns || []).map((row, idx) => {
                const platform = String((row as any)?.platform ?? '');
                const rawTypes = platformContentTypeRawOptions[platform] || [];
                return (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-white border border-gray-200 rounded-md p-2">
                    <select
                      value={platform}
                      disabled={isBusy}
                      onChange={(e) => {
                        const nextPlatform = e.target.value;
                        const nextType = nextPlatform ? (platformContentTypeRawOptions[nextPlatform]?.[0] || '') : '';
                        setPlanningExclusiveCampaigns((prev) => {
                          const copy = [...(prev || [])];
                          copy[idx] = { ...(copy[idx] as any), platform: nextPlatform, content_type: nextType };
                          return copy as any;
                        });
                      }}
                      className="rounded border border-gray-200 px-2 py-2 text-xs"
                    >
                      {platforms.map((p) => (
                        <option key={p} value={p}>
                          {platformLabels[p] || p}
                        </option>
                      ))}
                    </select>
                    <select
                      value={String((row as any)?.content_type ?? '')}
                      disabled={isBusy || !platform}
                      onChange={(e) => {
                        const nextType = e.target.value;
                        setPlanningExclusiveCampaigns((prev) => {
                          const copy = [...(prev || [])];
                          copy[idx] = { ...(copy[idx] as any), content_type: nextType };
                          return copy as any;
                        });
                      }}
                      className="rounded border border-gray-200 px-2 py-2 text-xs"
                    >
                      {rawTypes.map((ct) => (
                        <option key={ct} value={ct}>
                          {prettyContentTypeLabel(ct)}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={2}
                        value={String((row as any)?.count_per_week ?? '')}
                        disabled={isBusy}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                          setPlanningExclusiveCampaigns((prev) => {
                            const copy = [...(prev || [])];
                            copy[idx] = { ...(copy[idx] as any), count_per_week: digits };
                            return copy as any;
                          });
                        }}
                        placeholder="0"
                        className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                      />
                      <span className="text-xs text-gray-500">/week</span>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setPlanningExclusiveCampaigns((prev) => (prev || []).filter((_, i) => i !== idx));
                        }}
                        className="ml-auto px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:border-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {quickCustomizeMode ? (
            <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
              <div className="text-xs text-gray-600 mb-2">Tailored input (optional).</div>
              <textarea
                value={quickCustomizeText}
                onChange={(e) => setQuickCustomizeText(e.target.value)}
                placeholder='Example: "LinkedIn: webinars 1/week; YouTube: long videos 1/week"'
                className="w-full min-h-[72px] px-3 py-2 border border-gray-300 rounded-md text-sm"
                disabled={isBusy}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy || !canAdd}
              onClick={addRow}
              className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
            >
              Add exclusive campaign
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setQuickCustomizeText('');
                setSelectedQuickOptions([]);
                setQuickCustomizeMode((prev) => !prev);
              }}
              className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
            >
              {quickCustomizeMode ? 'Back to options' : 'Customize'}
            </button>
            {quickCustomizeMode ? (
              <button
                type="button"
                disabled={isBusy || !quickCustomizeText.trim()}
                onClick={() => {
                  const text = quickCustomizeText.trim();
                  if (!text) return;
                  setHideQuickPickPanel(true);
                  void sendMessage(text);
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
              >
                Submit custom
              </button>
            ) : (
              <button
                type="button"
                disabled={isBusy || !hasCatalog || !hasPlatforms}
                onClick={() => submitQuickPickAnswer(config)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
              >
                Submit
              </button>
            )}
          </div>
        </div>
      );
    }
    if (config.progressiveStyle && (config.key === 'communication_style' || config.key === 'action_expectation')) {
      const { primaryOptions, secondaryByPrimary, primaryTooltips, secondaryTooltips } = config.progressiveStyle;
      const selectedPrimaries = quickPickPrimaryStyles;
      const secondaries = quickPickSecondaryModifiers;
      let compatibleSecondaries = selectedPrimaries.length > 0
        ? Array.from(new Set(selectedPrimaries.flatMap((p) => secondaryByPrimary[p] ?? [])))
        : [];
      // When "Simple & easy" is primary, don't offer "Deep & thoughtful" as modifier — they describe opposite depth levels
      if (config.key === 'communication_style' && selectedPrimaries.includes('Simple & easy')) {
        compatibleSecondaries = compatibleSecondaries.filter((s) => s !== 'Deep & thoughtful');
      }
      const isCta = config.key === 'action_expectation';
      const primaryLabel = isCta ? 'Choose one or more primary CTA intents.' : 'Choose one or more primary communication directions.';
      const modifiersLabel = isCta ? 'Select actions (optional):' : 'Select modifiers (optional):';
      return (
        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          {config.helperText && (
            <div className="text-xs text-gray-600 mb-2 pb-2 border-b border-gray-200">
              {config.helperText}
            </div>
          )}
          {selectedPrimaries.length === 0 ? (
            <>
              <div className="text-xs text-gray-600 mb-2">
                {primaryLabel}
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {primaryOptions.map((option) => {
                  const selected = selectedPrimaries.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={isBusy}
                      title={primaryTooltips?.[option]}
                      onClick={() => {
                        setQuickPickPrimaryStyles((prev) =>
                          prev.includes(option) ? prev.filter((p) => p !== option) : [...prev, option]
                        );
                      }}
                      className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                        selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-gray-600 mb-2">
                Primary: <span className="font-medium text-gray-800">{selectedPrimaries.join(', ')}</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {primaryOptions.map((option) => {
                  const selected = selectedPrimaries.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={isBusy}
                      title={primaryTooltips?.[option]}
                      onClick={() => {
                        const next = selected
                          ? selectedPrimaries.filter((p) => p !== option)
                          : [...selectedPrimaries, option];
                        setQuickPickPrimaryStyles(next);
                        if (next.length === 0) {
                          setQuickPickSecondaryModifiers([]);
                        } else {
                          let nextCompat = Array.from(new Set(next.flatMap((p) => secondaryByPrimary[p] ?? [])));
                          if (config.key === 'communication_style' && next.includes('Simple & easy')) {
                            nextCompat = nextCompat.filter((s) => s !== 'Deep & thoughtful');
                          }
                          setQuickPickSecondaryModifiers((prev) => prev.filter((s) => nextCompat.includes(s)));
                        }
                      }}
                      className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                        selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setQuickPickPrimaryStyles([]);
                    setQuickPickSecondaryModifiers([]);
                  }}
                  className="px-2.5 py-1.5 rounded-full text-xs border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                >
                  Clear primary
                </button>
              </div>
              {compatibleSecondaries.length > 0 && (
                <>
                  <div className="text-xs text-gray-600 mb-1 mt-2">
                    {modifiersLabel}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {compatibleSecondaries.map((option) => {
                      const selected = secondaries.includes(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          disabled={isBusy}
                          title={secondaryTooltips?.[option]}
                          onClick={() => {
                            setQuickPickSecondaryModifiers((prev) =>
                              prev.includes(option)
                                ? prev.filter((o) => o !== option)
                                : [...prev, option]
                            );
                          }}
                          className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                            selected
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <button
                type="button"
                disabled={isBusy}
                onClick={() => submitQuickPickAnswer(config)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
              >
                Submit selection
              </button>
            </>
          )}
        </div>
      );
    }
    return (
      <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="text-xs text-gray-600 mb-2">
          {config.helperText ?? (config.multi ? 'Select one or more, then submit.' : 'Pick one, then submit.')}
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          {config.options.map((option) => {
            const selected = selectedQuickOptions.includes(option);
            const tooltip = config.optionTooltips?.[option] ?? config.optionDescriptions?.[option];
            return (
              <button
                key={option}
                type="button"
                disabled={isBusy}
                title={tooltip}
                onClick={() => {
                  if (config.multi) {
                    setSelectedQuickOptions((prev) =>
                      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
                    );
                  } else {
                    setSelectedQuickOptions([option]);
                    setQuickCustomizeMode(false);
                    setQuickCustomizeText('');
                  }
                }}
                className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                  selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                }`}
              >
                {option}
              </button>
            );
          })}
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              setQuickCustomizeText('');
              setQuickCustomizeMode((prev) => !prev);
            }}
            className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
              quickCustomizeMode ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-700 border-gray-300 hover:border-amber-400'
            }`}
          >
            {quickCustomizeMode ? 'Back to options' : 'Customize'}
          </button>
        </div>
        {quickCustomizeMode && (
          <input
            type="text"
            value={quickCustomizeText}
            onChange={(e) => setQuickCustomizeText(e.target.value)}
            placeholder={config.key === 'campaign_duration' ? 'e.g., 6 weeks' : 'Add custom option(s)'}
            className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-md text-sm"
            disabled={isBusy}
          />
        )}
        <button
          type="button"
          disabled={
            isBusy ||
            (!quickCustomizeMode && selectedQuickOptions.length === 0) ||
            (quickCustomizeMode && !quickCustomizeText.trim() && selectedQuickOptions.length === 0)
          }
          onClick={() => submitQuickPickAnswer(config)}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
        >
          Submit selection
        </button>
      </div>
    );
  };

  const callCampaignPlanAPI = async (
    message: string,
    mode: 'generate_plan' | 'refine_day' | 'platform_customize',
    options?: {
      durationWeeks?: number;
      targetDay?: string;
      platforms?: string[];
      conversationHistory?: Array<{ type: 'user' | 'ai'; message: string }>;
      currentPlan?: { weeks: any[] };
      scopeWeeks?: number[] | null;
      chatContext?: string;
      vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
      collectedPlanningContextOverride?: Record<string, unknown>;
      /** When provided, the in-flight request's AbortController is assigned here so the UI can cancel */
      planAbortRef?: React.MutableRefObject<AbortController | null>;
    }
  ): Promise<{
    plan?: StructuredPlan;
    day?: RefinedDay;
    platform_content?: PlatformCustomization;
    conversationalResponse?: string;
    validation_result?: any;
    collectedPlanningContext?: Record<string, unknown>;
    startDateConflictWarning?: string;
  }> => {
    const baseContext =
      options?.collectedPlanningContextOverride ??
      (lastCollectedPlanningContextFromApi && Object.keys(lastCollectedPlanningContextFromApi).length > 0 ? lastCollectedPlanningContextFromApi : null) ??
      (collectedPlanningContext && Object.keys(collectedPlanningContext).length > 0 ? (collectedPlanningContext as Record<string, unknown>) : null);
    const fromForm = buildCollectedPlanningContextForApi();
    const mergedCollectedPlanningContext =
      baseContext || fromForm
        ? { ...(baseContext ?? {}), ...(fromForm ?? {}) }
        : undefined;

    if (!resolvedCompanyId) {
      throw new Error('companyId is required to persist campaign_planning_inputs');
    }

    // Timeout scales with weeks: base 5 min + ~45s per week so 4-week plans get ~8 min (avoids "took too long" on theme-based flow)
    const durationWeeks = options?.durationWeeks ?? 12;
    const PLAN_API_TIMEOUT_MS = Math.min(600000, 300000 + durationWeeks * 45000);
    const timeoutMinutes = Math.round(PLAN_API_TIMEOUT_MS / 60000);
    const controller = new AbortController();
    if (options?.planAbortRef) {
      options.planAbortRef.current = controller;
    }
    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException(`Plan request timed out after ${timeoutMinutes} minutes`, 'AbortError'));
    }, PLAN_API_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetchWithAuth('/api/campaigns/ai/plan', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId,
          companyId: resolvedCompanyId,
          mode,
          message,
          durationWeeks: options?.durationWeeks,
          targetDay: options?.targetDay,
          platforms: options?.platforms,
          messages: options?.conversationHistory,
          recommendationContext,
          optimizationContext,
          currentPlan: options?.currentPlan,
          scopeWeeks: options?.scopeWeeks,
          chatContext: options?.chatContext,
          vetScope: options?.vetScope ?? vetScope,
          collectedPlanningContext: mergedCollectedPlanningContext,
        }),
      });
    } finally {
      clearTimeout(timeoutId);
      if (options?.planAbortRef) {
        options.planAbortRef.current = null;
      }
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 422 && (data?.conversationalResponse || data?.validation_result)) {
        return {
          conversationalResponse: data.conversationalResponse || 'Capacity validation failed.',
          validation_result: data.validation_result,
        };
      }
      const raw = data.error || data.message || 'AI plan API error';
      const friendly =
        response.status === 400
          ? 'Your message couldn\'t be processed. Please rephrase and try again.'
          : raw;
      throw new Error(friendly);
    }

    return {
      plan: data.plan,
      day: data.day,
      platform_content: data.platform_content,
      conversationalResponse: data.conversationalResponse,
      validation_result: data.validation_result,
      collectedPlanningContext: data.collectedPlanningContext as Record<string, unknown> | undefined,
      startDateConflictWarning: data.startDateConflictWarning,
    };
  };

  const generateDemoResponse = (userMessage: string, context: string, campaignData: any, learnings: CampaignLearning[]): string => {
    const responses = {
      'campaign-planning': [
        `Based on your campaign "${campaignData?.name || 'current campaign'}" and learnings from ${learnings.length} previous campaigns, I recommend focusing on high-engagement content types. Your past campaigns showed that video content performed 25% better than text posts.`,
        `Looking at your campaign goals and historical data, I suggest creating a content mix of 60% educational, 30% promotional, and 10% entertaining content. This ratio worked well in your previous campaigns.`,
        `I can see from your past campaigns that LinkedIn and Twitter performed best for your audience. Let me help you optimize your content strategy based on this data.`
      ],
      'market-analysis': [
        `Analyzing trends for your campaign "${campaignData?.name || 'current campaign'}" and comparing with your ${learnings.length} previous campaigns, I see opportunities in AI content creation (+45% growth). Your past campaigns in this area showed 30% higher engagement.`,
        `Based on your campaign history, I notice that competitor analysis helped improve your reach by 40% in previous campaigns. Let me analyze current competitors for your industry.`,
        `Your past campaigns showed that posting on Tuesday-Thursday at 2-4 PM generated the highest engagement. I'll factor this into your current campaign analysis.`
      ],
      'content-creation': [
        `For your campaign "${campaignData?.name || 'current campaign'}", I'll create content based on what worked in your ${learnings.length} previous campaigns. Your audience responded best to storytelling posts and how-to guides.`,
        `Looking at your campaign goals and past performance, I suggest creating 3 LinkedIn articles, 5 Twitter posts, and 2 Instagram stories. This mix generated 35% higher engagement in your previous campaigns.`,
        `Based on your campaign data, I'll adapt content for each platform using the strategies that worked best in your past campaigns.`
      ],
      'schedule-review': [
        `Reviewing your campaign schedule against ${learnings.length} previous campaigns, I notice optimal posting times that could increase engagement by 25%. Your past campaigns showed best results on weekdays.`,
        `Based on your campaign history, I suggest adjusting Instagram posts to peak hours (2-4 PM) as this timing worked best in your previous campaigns.`,
        `Your past campaigns showed that spreading content across 3-4 days per week generated 40% higher reach. Let me optimize your current schedule accordingly.`
      ],
      'general': [
        `I'm here to help with your campaign "${campaignData?.name || 'current campaign'}" using insights from your ${learnings.length} previous campaigns. What specific area would you like assistance with?`,
        `I can help with campaign planning, market analysis, content creation, or scheduling optimization, all informed by your past campaign performance data.`,
        `Let me know what you'd like to work on, and I'll provide guidance based on your campaign history and proven strategies.`
      ]
    };

    const contextResponses = responses[context as keyof typeof responses] || responses.general;
    return contextResponses[Math.floor(Math.random() * contextResponses.length)];
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showPlanOverview && replaceMode) {
        const replacementText = newMessage.trim();
        if (!replaceSelection?.text?.trim() || !replacementText) return;
        const weekNumber = replaceSelection.week || reviewWeekNumber;
        const oldText = replaceSelection.text;

        // Apply locally (instant) instead of calling AI
        if (!structuredPlan?.weeks?.length) {
          setUiErrorMessage('No structured plan loaded to apply edits.');
          return;
        }
        const { nextPlan, replacedCount } = applyLocalWeekTextReplacement(structuredPlan, weekNumber, oldText, replacementText);
        if (replacedCount <= 0) {
          setUiErrorMessage('Could not apply edit in plan data. Try selecting only the value (avoid selecting labels like "Audience:").');
          return;
        }
        setStructuredPlan(nextPlan);

        const userMessage: ChatMessage = {
          id: Date.now(),
          type: 'user',
          message: `Edit in Week ${weekNumber}: "${oldText}" → "${replacementText}"`,
          timestamp: new Date().toLocaleTimeString(),
          campaignId
        };
        const aiMessage: ChatMessage = {
          id: Date.now() + 1,
          type: 'ai',
          message: `Applied edit locally in Week ${weekNumber}.`,
          timestamp: new Date().toLocaleTimeString(),
          provider: getProviderName(selectedProvider),
          campaignId
        };
        setMessages((prev) => [...prev, userMessage, aiMessage]);
        try { void saveCampaignMessage(userMessage); void saveCampaignMessage(aiMessage); } catch (_) { /* no-op */ }
        setNewMessage('');
        setInputClearKey((k) => k + 1);
        setReplaceMode(false);
        setReplaceSelection(null);
        setUiErrorMessage(null);
        focusInputSoon();
        return;
      }

      sendMessage();
    }
  };

  const getProviderIcon = (provider: AIProvider) => {
    switch (provider) {
      case 'gpt': return <Zap className="h-4 w-4" />;
      case 'claude': return <Brain className="h-4 w-4" />;
      case 'demo': return <Sparkles className="h-4 w-4" />;
      default: return <Zap className="h-4 w-4" />;
    }
  };

  const getProviderName = (provider: AIProvider) => {
    switch (provider) {
      case 'gpt': return 'GPT-4';
      case 'claude': return 'Claude 3.5 Sonnet';
      case 'demo': return 'Demo AI';
      default: return 'AI Assistant';
    }
  };

  const updatePlanWithRefinedDay = (plan: StructuredPlan, refinedDay: RefinedDay): StructuredPlan => {
    return {
      weeks: plan.weeks.map((week) => {
        if (week.week !== refinedDay.week) return week;
        const daily = week.daily || [];
        const updated = daily.map((day) =>
          day.day.toLowerCase() === refinedDay.day.toLowerCase()
            ? {
                day: refinedDay.day,
                objective: refinedDay.objective,
                content: refinedDay.content,
                platforms: refinedDay.platforms,
              }
            : day
        );
        const found = daily.some((d) => d.day.toLowerCase() === refinedDay.day.toLowerCase());
        return {
          ...week,
          daily: found ? updated : [...updated, { day: refinedDay.day, objective: refinedDay.objective, content: refinedDay.content, platforms: refinedDay.platforms }],
        };
      }),
    };
  };

  const updatePlanWithPlatformCustomization = (
    plan: StructuredPlan,
    customization: PlatformCustomization
  ): StructuredPlan => {
    const targetDay = customization.day.toLowerCase();
    return {
      weeks: plan.weeks.map((week) => ({
        ...week,
        daily: (week.daily || []).map((day) =>
          day.day.toLowerCase() === targetDay
            ? {
                ...day,
                platforms: {
                  ...day.platforms,
                  ...customization.platforms,
                },
              }
            : day
        ),
      })),
    };
  };

  /** Renders platform + content breakdown for full visibility: e.g. "Facebook: 2 posts, 1 story" */
  const renderWeekPlatformContent = (week: StructuredWeek) => {
    const breakdown = week.platform_content_breakdown;
    if (breakdown && Object.keys(breakdown).length > 0) {
      return (
        <div className="space-y-1">
          <div className="text-gray-500 font-medium">Platforms & content types:</div>
          {(() => {
            const platformAlloc = week.platform_allocation || {};
            const platformKeys = [...new Set([...Object.keys(breakdown), ...Object.keys(platformAlloc)])];
            return platformKeys.map((platform) => {
              const directItems = breakdown[platform] || [];
              const sharedFromOthers = Object.entries(breakdown).flatMap(([p, items]) =>
                p === platform ? [] : items.filter((it) => (it.platforms || [p]).includes(platform))
              );
              const seen = new Set<string>();
              const allItems = [...directItems, ...sharedFromOthers].filter((it) => {
                const key = `${it.type}-${it.topics?.[0] ?? it.topic ?? ''}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              if (allItems.length === 0) return null;
              return (
                <div key={platform} className="border-l-2 border-indigo-100 pl-2">
                  <span className="font-medium capitalize text-gray-700">{platform}:</span>
                  <div className="mt-0.5 space-y-1 text-gray-600">
                    {allItems.map((it, idx) => {
                      const topics = it.topics || (it.topic ? [it.topic] : []);
                      const label = it.count > 1 ? `${it.type} (${it.count})` : it.type;
                      const shared = (it.platforms?.length ?? 0) > 1;
                      return (
                        <div key={idx} className="text-xs">
                          <span className="font-medium">{label}</span>
                          {shared && <span className="ml-1 text-indigo-600">(shared)</span>}
                          {topics.length > 0 && (
                            <ul className="list-decimal list-inside mt-0.5 ml-1">{topics.map((t, i) => <li key={i}>{t}</li>)}</ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      );
    }
    const platforms = week.platform_allocation ? Object.entries(week.platform_allocation) : [];
    const contentTypes = week.content_type_mix || [];
    if (platforms.length === 0 && contentTypes.length === 0) return <span className="text-gray-400">—</span>;
    return (
      <div className="space-y-1">
        {platforms.length > 0 && (
          <div>
            <div className="text-gray-500 font-medium">Platforms (items per week):</div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {platforms.map(([p, n]) => (
                <span key={p} className="bg-gray-100 px-2 py-0.5 rounded capitalize">{p}: {n}</span>
              ))}
            </div>
          </div>
        )}
        {contentTypes.length > 0 && (
          <div>
            <div className="text-gray-500 font-medium">Content to create:</div>
            <ul className="list-disc list-inside mt-0.5 text-gray-600">{contentTypes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
      </div>
    );
  };

  const renderResolvedPostingMetadata = (week: StructuredWeek) => {
    const postings = Array.isArray((week as any)?.resolved_postings) ? (week as any).resolved_postings : [];
    if (postings.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="text-gray-500 font-medium text-xs">Resolved postings:</div>
        {postings.map((posting: any, idx: number) => {
          const executionId = String(posting?.execution_id ?? '').trim();
          const narrativeRole = String(posting?.narrative_role ?? '').trim();
          const progressionStep = Number(posting?.progression_step);
          const globalIdx = Number(posting?.global_progression_index);
          const formatFamily = String(posting?.writer_content_brief?.format_requirements?.format_family ?? '').trim();
          const alignmentReason = Array.isArray(posting?.alignment_reason)
            ? posting.alignment_reason.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
            : [];
          const topicLabel = String(posting?.topic ?? '').trim() || `Posting ${idx + 1}`;
          const platformLabel = String(posting?.platform ?? '').trim() || 'unknown platform';
          const contentTypeLabel = String(posting?.content_type ?? '').trim() || 'unknown content type';
          return (
            <div key={String(posting?.posting_id ?? `${week.week}-resolved-${idx}`)} className="rounded border border-gray-200 p-2">
              <div className="text-gray-700 text-xs">
                <span className="font-medium">{topicLabel}</span> • {platformLabel} • {contentTypeLabel}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                {executionId ? (
                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-700">
                    {executionId}
                  </span>
                ) : null}
                {narrativeRole ? (
                  <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-700">
                    {narrativeRole}
                  </span>
                ) : null}
                {(Number.isFinite(progressionStep) || Number.isFinite(globalIdx)) ? (
                  <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">
                    Step {Number.isFinite(progressionStep) ? progressionStep : '—'} / #{Number.isFinite(globalIdx) ? globalIdx : '—'}
                  </span>
                ) : null}
                {formatFamily ? (
                  <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                    {formatFamily}
                  </span>
                ) : null}
                {posting?.format_validation_warning ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                    <AlertCircle className="h-3 w-3" />
                    Format warning
                  </span>
                ) : null}
              </div>
              {alignmentReason.length > 0 ? (
                <details className="mt-1 text-[11px]">
                  <summary className="cursor-pointer text-gray-500">Alignment reason</summary>
                  <ul className="list-disc list-inside text-gray-600 mt-0.5">
                    {alignmentReason.map((reason: string, reasonIdx: number) => (
                      <li key={reasonIdx}>{reason}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderStructuredPlan = (plan: StructuredPlan) => {
    return (
      <div className="space-y-4">
        {plan.weeks.map((week) => {
          const isBlueprint = week.platform_allocation && Object.keys(week.platform_allocation).length > 0;
          const hasEnrichedTopics = Array.isArray((week as any).topics) && (week as any).topics.length > 0;
          const themeLabel = week.phase_label || week.theme || `Week ${week.week}`;
          const platformTargets = Object.entries((week as any)?.platform_allocation || {})
            .map(([platform, count]) => `${platform}: ${count}`)
            .filter(Boolean);
          const contentTypes = Array.isArray((week as any)?.content_type_mix) ? (week as any).content_type_mix : [];
          const topicsWithExecution = hasEnrichedTopics
            ? (((week as any).topics as any[]).map((topic, idx) => ({
                ...topic,
                topicExecution: {
                  platformTargets: platformTargets.length > 0 ? [platformTargets[idx % platformTargets.length]] : ['—'],
                  contentType: contentTypes[idx % Math.max(contentTypes.length, 1)] || '—',
                  ctaType: (week as any)?.cta_type || '—',
                  kpiFocus: (week as any)?.weekly_kpi_focus || '—',
                },
              })))
            : [];
          return (
          <div key={week.week} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-gray-900">Week {week.week}</div>
              <div className="text-xs text-gray-500">{themeLabel}</div>
            </div>
            {isBlueprint ? (
              <div className="space-y-2 text-xs">
                {week.primary_objective && <div className="text-gray-600">{week.primary_objective}</div>}
                {hasEnrichedTopics ? (
                  <div className="space-y-2">
                    {(week as any)?.weeklyContextCapsule && (
                      <div className="rounded border border-indigo-100 bg-indigo-50/50 p-2 text-gray-700">
                        <div><span className="font-medium">Audience:</span> {(week as any).weeklyContextCapsule.audienceProfile || '—'}</div>
                        <div><span className="font-medium">Weekly intent:</span> {(week as any).weeklyContextCapsule.weeklyIntent || '—'}</div>
                        <div><span className="font-medium">Tone:</span> {(week as any).weeklyContextCapsule.toneGuidance || '—'}</div>
                      </div>
                    )}
                    {topicsWithExecution.map((topic, idx) => (
                      <div key={`${week.week}-topic-${idx}`} className="rounded border border-gray-200 p-2">
                        <div className="font-medium text-gray-900">{topic.topicTitle || `Topic ${idx + 1}`}</div>
                        <div className="text-gray-600">{getIntentLabelForContentType(topic?.topicExecution?.contentType ?? (topic as any)?.content_type)}: {topic?.topicContext?.writingIntent || '—'}</div>
                        <div className="text-gray-600">Platform(s): {(topic.topicExecution.platformTargets || []).join(', ')}</div>
                        <div className="text-gray-600">Content type: {topic.topicExecution.contentType || '—'}</div>
                        <div className="text-gray-600">CTA: {topic.topicExecution.ctaType || '—'} • KPI: {topic.topicExecution.kpiFocus || '—'}</div>
                        <div className="text-gray-600">Who: {topic.whoAreWeWritingFor || '—'}</div>
                        <div className="text-gray-600">Problem: {topic.whatProblemAreWeAddressing || '—'}</div>
                        <div className="text-gray-600">Learns: {topic.whatShouldReaderLearn || '—'}</div>
                        <div className="text-gray-600">Action: {topic.desiredAction || '—'}</div>
                        <div className="text-gray-600">Style: {topic.narrativeStyle || '—'}</div>
                        <div className="text-gray-600">
                          {getFormatLineForContentType(
                            topic?.topicExecution?.contentType ?? (topic as any)?.contentType ?? (topic as any)?.content_type,
                            topic?.contentTypeGuidance,
                            topic?.topicExecution?.platformTargets
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  (week.topics_to_cover?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-gray-500 font-medium">Topics to cover:</div>
                    <ul className="list-disc list-inside mt-0.5">{week.topics_to_cover!.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </div>
                  )
                )}
                {!hasEnrichedTopics && renderWeekPlatformContent(week)}
                {!hasEnrichedTopics && week.cta_type && <div>CTA: {week.cta_type}</div>}
                {!hasEnrichedTopics && week.weekly_kpi_focus && <div>KPI: {week.weekly_kpi_focus}</div>}
                {renderResolvedPostingMetadata(week)}
              </div>
            ) : (
            <div className="space-y-3">
              {(week.daily || []).map((day) => (
                <div key={`${week.week}-${day.day}`} className="border-t pt-3">
                  <div className="text-sm font-medium text-gray-800">{day.day}</div>
                  <div className="text-xs text-gray-600 mt-1">Objective: {day.objective}</div>
                  <div className="text-xs text-gray-700 mt-1">{day.content}</div>
                  {(day.hook || day.cta || day.best_time) && (
                    <div className="mt-2 text-xs text-gray-600 space-y-1">
                      {day.hook && <div>Hook: {day.hook}</div>}
                      {day.cta && <div>CTA: {day.cta}</div>}
                      {day.best_time && <div>Best time: {day.best_time}</div>}
                    </div>
                  )}
                  {(day.meta_title || day.meta_description || day.seo_keywords?.length) && (
                    <div className="mt-2 text-xs text-gray-600 space-y-1">
                      {day.meta_title && <div>Meta title: {day.meta_title}</div>}
                      {day.meta_description && <div>Meta description: {day.meta_description}</div>}
                      {day.seo_keywords && day.seo_keywords.length > 0 && (
                        <div>SEO keywords: {day.seo_keywords.join(', ')}</div>
                      )}
                    </div>
                  )}
                  {day.hashtags && day.hashtags.length > 0 && (
                    <div className="mt-2 text-xs text-gray-600">
                      Hashtags: {day.hashtags.map((tag) => `#${tag}`).join(' ')}
                    </div>
                  )}
                  {(day.effort_score !== undefined || day.success_projection !== undefined) && (
                    <div className="mt-2 text-xs text-gray-600">
                      {day.effort_score !== undefined && (
                        <span>Effort: {day.effort_score}</span>
                      )}
                      {day.effort_score !== undefined && day.success_projection !== undefined && (
                        <span> • </span>
                      )}
                      {day.success_projection !== undefined && (
                        <span>Success: {day.success_projection}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {Object.entries(day.platforms || {}).map(([platform, text]) => (
                      <div key={`${week.week}-${day.day}-${platform}`} className="bg-gray-50 rounded p-2">
                        <div className="text-xs font-semibold text-gray-700 capitalize">{platform}</div>
                        <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
          );
        })}
      </div>
    );
  };

  const scheduleStructuredPlan = async () => {
    if (!campaignId || !structuredPlan) {
      setUiErrorMessage('Campaign and structured plan are required to schedule.');
      return;
    }

    try {
      setIsSchedulingPlan(true);
      setUiErrorMessage(null);
      setUiSuccessMessage(null);

      const response = await fetchWithAuth(`/api/campaigns/${campaignId}/schedule-structured-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: structuredPlan }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData.message || errorData.error || 'Schedule API error';
        throw new Error(msg);
      }

      const data = await response.json();
      setUiSuccessMessage(
        `Scheduled ${data.scheduled_count || 0} posts. Skipped ${data.skipped_count || 0}. Use **View submitted plan** above to open your plan.`
      );
      // Refetch so "View committed plan" appears
      const refetchRes = await fetch(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`);
      if (refetchRes.ok) {
        const refetchData = await refetchRes.json();
        setRetrievePlanData(refetchData);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to schedule the plan. Please try again.';
      console.error('Error scheduling structured plan:', error);
      setUiErrorMessage(message);
    } finally {
      setIsSchedulingPlan(false);
      setShowScheduleConfirm(false);
    }
  };

  const loadAiHistory = async (id: string) => {
    try {
      setIsHistoryLoading(true);
      const response = await fetch(`/api/campaigns/${id}/ai-history`);
      if (!response.ok) {
        throw new Error('Failed to load AI history');
      }
      const data = await response.json();
      setAiHistory(data.history || []);
    } catch (error) {
      console.error('Error loading AI history:', error);
      setUiErrorMessage('Failed to load AI history. Please try again.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const loadAuditReport = async (id: string) => {
    try {
      setIsAuditLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/audit-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load audit report');
      }
      const data = await response.json();
      setAuditReport(data);
    } catch (error) {
      console.error('Error loading audit report:', error);
      setAuditReport(null);
    } finally {
      setIsAuditLoading(false);
    }
  };

  const loadHealthReport = async (id: string) => {
    try {
      setIsHealthLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/health-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load health report');
      }
      const data = await response.json();
      setHealthReport(data);
    } catch (error) {
      console.error('Error loading health report:', error);
      setHealthReport(null);
    } finally {
      setIsHealthLoading(false);
    }
  };

  const handleOptimizeWeek = async () => {
    if (!campaignId || !optimizeWeekNumber) return;
    setIsOptimizingWeek(true);
    try {
      const response = await fetch('/api/campaigns/optimize-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: optimizeWeekNumber,
          reason: optimizeReason,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to optimize week');
      }
      const data = await response.json();
      setOptimizeResult(data);
      if (data?.health_report) {
        setHealthReport(data.health_report);
      }
    } catch (error) {
      console.error('Error optimizing week:', error);
      setUiErrorMessage('Failed to optimize week. Please try again.');
    } finally {
      setIsOptimizingWeek(false);
    }
  };

  const loadExecutionPlan = async (id: string, force = false) => {
    try {
      setIsExecutionLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/platform-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          weekNumber: executionWeekNumber,
          force,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load execution plan');
      }
      const data = await response.json();
      setExecutionPlan(data.plan || null);
      if (data.healthReport) {
        setHealthReport(data.healthReport);
      }
    } catch (error) {
      console.error('Error loading execution plan:', error);
      setExecutionPlan(null);
    } finally {
      setIsExecutionLoading(false);
    }
  };

  const handleApproveScheduling = async () => {
    if (!campaignId) return;
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/scheduler-payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId,
          weekNumber: executionWeekNumber,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to build scheduler payload');
      }
      const data = await response.json();
      setSchedulerPayload(data.payload || null);
      if (data.healthReport) {
        setHealthReport(data.healthReport);
      }
    } catch (error) {
      console.error('Error building scheduler payload:', error);
      setUiErrorMessage('Failed to build scheduler payload. Please try again.');
    }
  };

  const loadContentAssets = async (id: string) => {
    try {
      setIsContentLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch(
        `/api/content/list?companyId=${encodeURIComponent(resolvedCompanyId)}&campaignId=${id}&weekNumber=${contentWeekNumber}`
      );
      if (!response.ok) {
        throw new Error('Failed to load content assets');
      }
      const data = await response.json();
      setContentAssets(data.assets || []);
      const planResponse = await fetch('/api/campaigns/platform-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          weekNumber: contentWeekNumber,
        }),
      });
      if (planResponse.ok) {
        const planData = await planResponse.json();
        setExecutionPlan(planData.plan || null);
        if (planData.healthReport) {
          setHealthReport(planData.healthReport);
        }
      }
    } catch (error) {
      console.error('Error loading content assets:', error);
      setContentAssets([]);
    } finally {
      setIsContentLoading(false);
    }
  };

  const handleGenerateContent = async (day: string) => {
    if (!campaignId) return;
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/generate-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId,
          weekNumber: contentWeekNumber,
          day,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to generate content');
      }
      await loadContentAssets(campaignId);
    } catch (error) {
      console.error('Error generating content:', error);
      setUiErrorMessage('Failed to generate content.');
    }
  };

  const handleRegenerateContent = async (assetId: string) => {
    if (!regenerateInstruction) {
      setUiErrorMessage('Please provide an instruction for regeneration.');
      return;
    }
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, assetId, instruction: regenerateInstruction }),
      });
      if (!response.ok) {
        throw new Error('Failed to regenerate content');
      }
      await loadContentAssets(campaignId || '');
    } catch (error) {
      console.error('Error regenerating content:', error);
      setUiErrorMessage('Failed to regenerate content.');
    }
  };

  const handleApproveContent = async (assetId: string) => {
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, assetId }),
      });
      if (!response.ok) {
        throw new Error('Failed to approve content');
      }
      await loadContentAssets(campaignId || '');
    } catch (error) {
      console.error('Error approving content:', error);
      setUiErrorMessage('Failed to approve content.');
    }
  };

  const handleRejectContent = async (assetId: string) => {
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, assetId, reason: 'Needs revisions' }),
      });
      if (!response.ok) {
        throw new Error('Failed to reject content');
      }
      await loadContentAssets(campaignId || '');
    } catch (error) {
      console.error('Error rejecting content:', error);
      setUiErrorMessage('Failed to reject content.');
    }
  };

  const handleTrackingLinkClick = async (trackingUrl: string, platform: string) => {
    try {
      await fetch('/api/tracking/link-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_url: trackingUrl,
          campaign_id: campaignId,
          platform,
        }),
      });
    } catch (error) {
      console.error('Tracking link click failed', error);
    } finally {
      window.location.href = trackingUrl;
    }
  };

  const loadPerformanceInsights = async (id: string) => {
    try {
      setIsPerformanceLoading(true);
      if (!ensureCompanyId()) return;
      const analyticsResponse = await fetch('/api/analytics/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          timeframe: 'latest',
        }),
      });
      if (analyticsResponse.ok) {
        const data = await analyticsResponse.json();
        setAnalyticsReport(data);
      } else {
        setAnalyticsReport(null);
      }
      const learningResponse = await fetch('/api/learning/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (learningResponse.ok) {
        const data = await learningResponse.json();
        setLearningInsights(data);
      } else {
        setLearningInsights(null);
      }
    } catch (error) {
      console.error('Error loading analytics/learning:', error);
      setAnalyticsReport(null);
      setLearningInsights(null);
    } finally {
      setIsPerformanceLoading(false);
    }
  };

  const handleApplyInsightsToWeek = async () => {
    if (!campaignId) return;
    try {
      const response = await fetch('/api/campaigns/optimize-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: performanceWeekNumber,
          reason: 'Apply learning insights',
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to apply insights');
      }
      const data = await response.json();
      if (data.health_report) {
        setHealthReport(data.health_report);
      }
    } catch (error) {
      console.error('Error applying insights:', error);
      setUiErrorMessage('Failed to apply insights.');
    }
  };

  const loadCampaignMemory = async (id: string) => {
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load campaign memory');
      }
      const data = await response.json();
      setCampaignMemory(data);
      const overlapResponse = await fetch('/api/campaigns/validate-uniqueness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          proposedPlan: {
            themes: data.pastThemes,
            topics: data.pastTopics,
            hooks: data.pastHooks,
            messages: data.pastContentSummaries,
          },
        }),
      });
      if (overlapResponse.ok) {
        const overlapData = await overlapResponse.json();
        setMemoryOverlap(overlapData);
      } else {
        setMemoryOverlap(null);
      }
    } catch (error) {
      console.error('Error loading campaign memory:', error);
      setCampaignMemory(null);
      setMemoryOverlap(null);
    }
  };

  const loadBusinessReports = async (id: string) => {
    try {
      setIsBusinessLoading(true);
      if (!ensureCompanyId()) return;
      const forecastResponse = await fetch('/api/campaigns/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, campaignId: id }),
      });
      if (forecastResponse.ok) {
        setForecastReport(await forecastResponse.json());
      }
      const roiResponse = await fetch('/api/campaigns/roi-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: id, costInputs: {} }),
      });
      if (roiResponse.ok) {
        setRoiReport(await roiResponse.json());
      }
      const businessResponse = await fetch('/api/campaigns/business-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, campaignId: id }),
      });
      if (businessResponse.ok) {
        setBusinessReport(await businessResponse.json());
      }
    } catch (error) {
      console.error('Error loading business reports:', error);
      setForecastReport(null);
      setRoiReport(null);
      setBusinessReport(null);
    } finally {
      setIsBusinessLoading(false);
    }
  };

  const handlePlatformIntel = async () => {
    if (!platformIntelAssetId) {
      setUiErrorMessage('Select a content asset to format.');
      return;
    }
    try {
      setIsPlatformIntelLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/platform/format-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          contentAssetId: platformIntelAssetId,
          platform: platformIntelPlatform,
          contentType: platformIntelContentType,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to format content');
      }
      const data = await response.json();
      setPlatformIntelData(data);
    } catch (error) {
      console.error('Error formatting platform content:', error);
      setPlatformIntelData(null);
      setUiErrorMessage('Failed to format content.');
    } finally {
      setIsPlatformIntelLoading(false);
    }
  };

  const extractTargetDay = (text: string): string | undefined => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const lower = text.toLowerCase();
    const match = days.find((day) => lower.includes(day));
    if (!match) return undefined;
    return match.charAt(0).toUpperCase() + match.slice(1);
  };

  const extractPlatforms = (text: string): string[] | undefined => {
    const lower = text.toLowerCase();
    const found = platformExtractCandidates.filter((platform) => {
      if (platform === 'x') return /\bx\b/.test(lower);
      return lower.includes(platform);
    });
    if (found.length === 0) return undefined;
    return found.map((platform) => (platform === 'twitter' ? 'x' : platform));
  };

  /** Parse week numbers from message: "week 1", "weeks 2 and 3", "all weeks" → [1] or [2,3] or null (all) */
  const extractScopeWeeks = (message: string, totalWeeks: number): number[] | null => {
    const lower = message.toLowerCase().trim();
    if (/all\s*weeks|every\s*week|entire\s*plan|whole\s*plan/i.test(lower)) return null;
    const weeks: number[] = [];
    const singleMatch = lower.match(/\bweek\s+(\d+)\b/gi);
    if (singleMatch) {
      for (const m of singleMatch) {
        const num = parseInt(m.replace(/\D/g, ''), 10);
        if (num >= 1 && num <= totalWeeks && !weeks.includes(num)) weeks.push(num);
      }
    }
    const rangeMatch = lower.match(/\bweeks?\s+(\d+)\s*(?:-|to|and|&)\s*(\d+)\b/i);
    if (rangeMatch) {
      const lo = Math.max(1, parseInt(rangeMatch[1], 10));
      const hi = Math.min(totalWeeks, parseInt(rangeMatch[2], 10));
      for (let i = lo; i <= hi; i++) if (!weeks.includes(i)) weeks.push(i);
    }
    return weeks.length > 0 ? weeks.sort((a, b) => a - b) : null;
  };

  const convertStructuredPlanToProgram = (plan: StructuredPlan) => {
    const platformSet = new Set<string>();
    const weeks = plan.weeks.map((week) => {
      const theme = week.phase_label || week.theme || `Week ${week.week}`;
      let content: Array<{ type: string; platform: string; description: string; day: string }> = [];
      if (week.daily?.length) {
        content = week.daily.flatMap((day) =>
          Object.entries(day.platforms || {}).map(([platform, text]) => {
            platformSet.add(platform);
            return { type: 'post', platform, description: text, day: day.day };
          })
        );
      } else if (week.platform_allocation && Object.keys(week.platform_allocation).length > 0) {
        for (const [platform, count] of Object.entries(week.platform_allocation)) {
          platformSet.add(platform);
          for (let i = 0; i < count; i++) {
            content.push({
              type: 'post',
              platform,
              description: `Content for ${theme} (${platform})`,
              day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i % 7],
            });
          }
        }
      }

      return { weekNumber: week.week, theme, content };
    });

    return {
      description: 'AI-generated 12-week content program',
      totalContent: weeks.reduce((sum, week) => sum + week.content.length, 0),
      platforms: Array.from(platformSet).map(
        (p) => p.charAt(0).toUpperCase() + p.slice(1)
      ),
      weeks,
    };
  };

  const renderPlanSummary = (plan: StructuredPlan) => {
    const weekCount = plan.weeks.length;
    const dayCount = plan.weeks.reduce((sum, week) => sum + (week.daily?.length ?? 0), 0);
    return `${weekCount} weeks • ${dayCount} days`;
  };

  const isBusy = isLoading || isSchedulingPlan;
  const isRecsChat = context?.toLowerCase().includes('campaign-recommendations');

  // Topic to show in header and placeholder: picked theme from recommendation card, or key message from chat, or campaign name
  const displayTopic = (() => {
    const fromCard = (recommendationContext as { topic_from_card?: string | null })?.topic_from_card;
    if (typeof fromCard === 'string' && fromCard.trim()) return fromCard.trim();
    const ctx = lastCollectedPlanningContextFromApi ?? prefilledPlanning ?? collectedPlanningContext;
    const km = (ctx as { key_messages?: string | string[] | null })?.key_messages;
    if (typeof km === 'string' && km.trim()) return km.trim().split(/\n/)[0]?.slice(0, 80) ?? '';
    if (Array.isArray(km) && km.length > 0) {
      const first = typeof km[0] === 'string' ? km[0].trim() : '';
      return first ? first.slice(0, 80) : '';
    }
    return campaignData?.name || 'Campaign';
  })();

  if (!isOpen && !standalone) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !standalone) {
      e.stopPropagation();
      onClose?.();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`flex flex-col ${standalone ? 'h-full w-full min-h-0' : `fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex ${isFullscreen ? 'items-stretch justify-stretch p-0' : 'items-center justify-center p-2 sm:p-4'}`}`}
      onClick={standalone ? undefined : handleBackdropClick}
    >
      <div
        className={`bg-white flex flex-col flex-1 min-h-0 ${standalone ? 'h-full w-full shadow-none rounded-none' : `shadow-2xl ${isFullscreen ? 'h-full w-full max-w-none rounded-none' : 'w-[min(95vw,90rem)] h-[min(90vh,calc(100vh-1rem))] min-w-[20rem] min-h-[20rem] rounded-2xl'}`}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`text-white p-4 flex items-center justify-between ${isFullscreen ? 'rounded-none' : 'rounded-t-2xl'} ${isRecsChat ? 'bg-gradient-to-r from-emerald-500 to-teal-600' : 'bg-gradient-to-r from-indigo-500 to-purple-600'}`}>
          <div>
            <h3 className="text-lg font-semibold">Campaign AI Assistant</h3>
            <p className={`text-sm ${isRecsChat ? 'text-emerald-100' : 'text-indigo-100'}`}>{displayTopic}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowLearning(!showLearning)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="View Campaign Learnings"
            >
              <BookOpen className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onMinimize?.(); }}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              aria-label="Minimize"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClose?.(); }}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Campaign Learnings Panel */}
        {showLearning && (
          <div className="bg-blue-50 border-b border-blue-200 p-4">
            <h4 className="font-semibold text-blue-900 mb-2">Campaign Learnings ({campaignLearnings.length})</h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {campaignLearnings.length > 0 ? (
                campaignLearnings.map((learning, index) => (
                  <div key={index} className="text-sm text-blue-800 bg-blue-100 p-2 rounded">
                    <strong>{learning.campaignName}:</strong> {learning.learnings[0] || 'No learnings available'}
                  </div>
                ))
              ) : (
                <div className="text-sm text-blue-600">No previous campaigns to learn from yet.</div>
              )}
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-gray-50 border-b border-gray-200 p-4">
            <div className="space-y-4">
              {/* Provider Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">AI Provider</label>
                <div className="flex gap-2">
                  {[
                    { id: 'demo', name: 'Demo AI', icon: Sparkles, color: 'from-purple-500 to-violet-600', status: 'Always Available' },
                    { id: 'gpt', name: 'GPT-4', icon: Zap, color: 'from-green-500 to-emerald-600', status: 'Use if configured' },
                    { id: 'claude', name: 'Claude 3.5', icon: Brain, color: 'from-orange-500 to-red-600', status: 'Use if configured' }
                  ].map((provider) => {
                    const Icon = provider.icon;
                    return (
                      <button
                        key={provider.id}
                        onClick={() => handleProviderChange(provider.id as AIProvider)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                          selectedProvider === provider.id
                            ? `bg-gradient-to-r ${provider.color} text-white shadow-lg`
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <div className="text-left">
                          <div>{provider.name}</div>
                          <div className={`text-xs ${selectedProvider === provider.id ? 'text-white/80' : 'text-gray-500'}`}>
                            {provider.status}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                
                {/* API Status */}
                <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">Current Configuration</span>
                  </div>
                  <div className="text-sm text-blue-800">
                    {selectedProvider === 'claude' && (
                      <div>
                        <strong>Claude 3.5 Sonnet</strong> selected
                        <br />
                        <span className="text-blue-600">Provider credentials are validated when you send a message.</span>
                      </div>
                    )}
                    {selectedProvider === 'gpt' && (
                      <div>
                        <strong>GPT-4</strong> selected
                        <br />
                        <span className="text-blue-600">Provider credentials are validated when you send a message.</span>
                      </div>
                    )}
                    {selectedProvider === 'demo' && (
                      <div>
                        <strong>Demo Mode</strong> - No API configuration detected
                        <br />
                        <span className="text-orange-600">⚠ Using simulated responses</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="text-xs text-gray-600">
                {selectedProvider === 'demo' ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    Demo mode with campaign learning simulation
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 text-orange-500" />
                    {selectedProvider === 'gpt' ? 'OpenAI' : 'Anthropic'} API with campaign context
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Messages / History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {uiErrorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
              {uiErrorMessage}
            </div>
          )}
          {uiSuccessMessage && (
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg p-3">
              {uiSuccessMessage}
            </div>
          )}

          {/* Load saved or committed plan (with edit) - prominent when committed plan exists */}
          {activeTab === 'chat' && (retrievePlanData?.savedPlan || retrievePlanData?.committedPlan || retrievePlanData?.draftPlan) && (
            <div className={`rounded-lg p-3 flex flex-wrap items-center gap-2 ${retrievePlanData?.committedPlan ? 'bg-emerald-50 border-2 border-emerald-300' : 'bg-indigo-50 border border-indigo-200'}`}>
              {isRetrievePlanLoading ? (
                <span className="text-sm text-indigo-700">Checking for existing plans…</span>
              ) : (
                <>
                  <span className="text-sm font-medium text-indigo-900">
                    {retrievePlanData?.committedPlan ? 'Your submitted plan:' : 'Existing plans:'}
                  </span>
                  {retrievePlanData?.savedPlan && (
                    <button
                      onClick={loadSavedPlanAndEdit}
                      disabled={isParsingSavedPlan}
                      className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {isParsingSavedPlan ? 'Loading…' : 'Load saved plan (Edit)'}
                    </button>
                  )}
                  {retrievePlanData?.committedPlan && (
                    <>
                      <button
                        onClick={() => {
                          const params = new URLSearchParams({ campaignId: campaignId! });
                          if (resolvedCompanyId) params.set('companyId', resolvedCompanyId);
                          window.location.href = `/campaign-planning-hierarchical?${params.toString()}`;
                        }}
                        className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                      >
                        View submitted plan
                      </button>
                      <button
                        onClick={loadCommittedPlanAndEdit}
                        className="px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
                      >
                        Load submitted plan (Edit)
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'history' ? (
            <div className="space-y-4">
              {isHistoryLoading ? (
                <div className="text-sm text-gray-500">Loading history...</div>
              ) : aiHistory.length === 0 ? (
                <div className="text-sm text-gray-500">No AI history yet.</div>
              ) : (
                aiHistory.map((entry) => (
                  <div key={entry.snapshot_hash} className="border rounded-lg p-4 bg-white">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">Plan Snapshot</div>
                      <div className="text-xs text-gray-500">
                        {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-gray-700">
                      Omnivyre: {entry.omnivyre_decision?.recommendation || 'N/A'}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {renderPlanSummary(entry.structured_plan)}
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-gray-700">Scheduled Items</div>
                      {entry.scheduled_posts.length === 0 ? (
                        <div className="text-xs text-gray-500 mt-1">No scheduled posts.</div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {entry.scheduled_posts.map((post) => (
                            <div key={post.id} className="bg-gray-50 rounded p-2 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="capitalize text-gray-700">{post.platform}</span>
                                <span className="text-gray-500">
                                  {post.scheduled_for ? new Date(post.scheduled_for).toLocaleString() : '—'}
                                </span>
                              </div>
                              <div className="text-gray-600 mt-1 line-clamp-2">{post.content}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : activeTab === 'audit' ? (
            <div className="space-y-3">
              {isAuditLoading ? (
                <div className="text-sm text-gray-500">Loading audit report...</div>
              ) : !auditReport ? (
                <div className="text-sm text-gray-500">No audit report available.</div>
              ) : (
                <div className="border rounded-lg p-4 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">Campaign Audit Report</div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        auditReport.status === 'healthy'
                          ? 'bg-green-100 text-green-800'
                          : auditReport.status === 'warning'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {auditReport.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    Confidence score: {auditReport.confidence_score ?? 0}%
                  </div>

                  <div className="border-t pt-3 mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">Campaign Health</div>
                      {isHealthLoading ? (
                        <span className="text-xs text-gray-500">Loading…</span>
                      ) : (
                        <span
                          title={
                            healthReport?.issues
                              ? healthReport.issues
                                  .map((issue: any) => `${issue.level.toUpperCase()}: ${issue.message}`)
                                  .join(' | ')
                              : 'No issues'
                          }
                          className={`text-xs px-2 py-1 rounded-full ${
                            healthReport?.status === 'healthy'
                              ? 'bg-green-100 text-green-800'
                              : healthReport?.status === 'warning'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {healthReport?.status ?? 'unknown'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      Confidence: {healthReport?.confidence ?? 0}%
                    </div>
                  <div className="h-2 w-full bg-gray-100 rounded">
                    <div
                      className={`h-2 rounded ${
                        (healthReport?.confidence ?? 0) >= 80
                          ? 'bg-green-500'
                          : (healthReport?.confidence ?? 0) >= 50
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, healthReport?.confidence ?? 0))}%` }}
                    />
                  </div>
                    <details className="text-xs text-gray-700">
                      <summary className="cursor-pointer font-semibold">Health report JSON</summary>
                      <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                        {JSON.stringify(healthReport, null, 2)}
                      </pre>
                    </details>
                  </div>

                  <div className="border-t pt-3 mt-3 space-y-2">
                    <div className="text-sm font-semibold text-gray-900">Optimize Week</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={optimizeWeekNumber}
                        onChange={(e) => setOptimizeWeekNumber(Number(e.target.value))}
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-xs"
                      />
                      <input
                        type="text"
                        value={optimizeReason}
                        onChange={(e) => setOptimizeReason(e.target.value)}
                        placeholder="Reason for optimization"
                        className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
                      />
                      <button
                        onClick={handleOptimizeWeek}
                        disabled={isOptimizingWeek}
                        className="px-3 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
                      >
                        {isOptimizingWeek ? 'Optimizing…' : 'Optimize'}
                      </button>
                    </div>
                    {optimizeResult && (
                      <div className="text-xs text-gray-600">
                        {optimizeResult.change_summary || 'Optimization complete.'}
                      </div>
                    )}
                  </div>
                  <details className="text-xs text-gray-700">
                    <summary className="cursor-pointer font-semibold">View raw JSON</summary>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(auditReport, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          ) : activeTab === 'execution' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={executionWeekNumber}
                  onChange={(e) => setExecutionWeekNumber(Number(e.target.value))}
                  className="w-20 rounded border border-gray-200 px-2 py-1 text-xs"
                />
                <button
                  onClick={() => loadExecutionPlan(campaignId || '', true)}
                  disabled={isExecutionLoading}
                  className="px-3 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
                >
                  {isExecutionLoading ? 'Loading…' : 'Regenerate week plan'}
                </button>
                <button
                  onClick={handleApproveScheduling}
                  className="px-3 py-1 text-xs rounded bg-green-600 text-white"
                >
                  Approve for scheduling
                </button>
              </div>
              {isExecutionLoading ? (
                <div className="text-sm text-gray-500">Loading execution plan...</div>
              ) : !executionPlan ? (
                <div className="text-sm text-gray-500">No execution plan available.</div>
              ) : (
                <div className="space-y-2">
                  {executionPlan.days?.map((day: any, index: number) => (
                    <div key={`${day.date}-${day.platform}-${index}`} className="border rounded p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-gray-800">{day.date}</div>
                        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 capitalize">
                          {day.platform}
                        </span>
                      </div>
                      <div className="mt-1 text-gray-600">
                        {day.contentType} • {day.suggestedTime}
                      </div>
                      <div className="mt-1 text-gray-500">
                        {day.theme}
                        {day.trendUsed ? ` • Trend: ${day.trendUsed}` : ''}
                      </div>
                      <div className="mt-1 text-gray-500">
                        {day.placeholder ? 'Placeholder required' : 'Ready'} • {day.reasoning}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {schedulerPayload && (
                <details className="text-xs text-gray-700">
                  <summary className="cursor-pointer font-semibold">Scheduler payload</summary>
                  <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                    {JSON.stringify(schedulerPayload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ) : activeTab === 'content' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={contentWeekNumber}
                  onChange={(e) => setContentWeekNumber(Number(e.target.value))}
                  className="w-20 rounded border border-gray-200 px-2 py-1 text-xs"
                />
                <input
                  type="text"
                  value={regenerateInstruction}
                  onChange={(e) => setRegenerateInstruction(e.target.value)}
                  placeholder="Regeneration instruction"
                  className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
                />
              </div>
              {isContentLoading ? (
                <div className="text-sm text-gray-500">Loading content assets...</div>
              ) : contentAssets.length === 0 ? (
                <div className="text-sm text-gray-500">No content assets yet.</div>
              ) : (
                <div className="space-y-2">
                  {contentAssets.map((asset) => (
                    <div key={asset.asset_id} className="border rounded p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-gray-800">
                          {asset.day} • {asset.platform}
                        </div>
                        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                          {asset.status}
                        </span>
                      </div>
                      <div className="mt-1 text-gray-600">
                        {asset.latest_content?.headline || asset.latest_content?.caption || 'No content'}
                      </div>
                      {asset.latest_content?.tracking_link && (
                        <div className="mt-2 text-gray-600">
                          <button
                            onClick={() =>
                              handleTrackingLinkClick(
                                asset.latest_content.tracking_link,
                                asset.platform
                              )
                            }
                            className="text-indigo-600 hover:text-indigo-700 underline"
                          >
                            Open tracking link
                          </button>
                        </div>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleRegenerateContent(asset.asset_id)}
                          className="px-2 py-1 rounded bg-indigo-600 text-white"
                        >
                          Regenerate
                        </button>
                        <button
                          onClick={() => handleApproveContent(asset.asset_id)}
                          className="px-2 py-1 rounded bg-green-600 text-white"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectContent(asset.asset_id)}
                          className="px-2 py-1 rounded bg-red-600 text-white"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {executionPlan?.days?.length && (
                <div className="border-t pt-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Generate for day</div>
                  <div className="flex flex-wrap gap-2">
                    {executionPlan.days.map((day: any) => (
                      <button
                        key={day.date}
                        onClick={() => handleGenerateContent(day.date)}
                        className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs"
                      >
                        {day.date}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'performance' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={performanceWeekNumber}
                  onChange={(e) => setPerformanceWeekNumber(Number(e.target.value))}
                  className="w-20 rounded border border-gray-200 px-2 py-1 text-xs"
                />
                <button
                  onClick={handleApplyInsightsToWeek}
                  className="px-3 py-1 text-xs rounded bg-indigo-600 text-white"
                >
                  Apply insights to week
                </button>
              </div>
              {isPerformanceLoading ? (
                <div className="text-sm text-gray-500">Loading analytics…</div>
              ) : (
                <div className="space-y-3">
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Analytics Report</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(analyticsReport, null, 2)}
                    </pre>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Learning Insights</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(learningInsights, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'memory' ? (
            <div className="space-y-3">
              {!campaignMemory ? (
                <div className="text-sm text-gray-500">No memory available.</div>
              ) : (
                <div className="space-y-2">
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Past Themes</div>
                    <div className="text-gray-600">{campaignMemory.pastThemes?.join(', ') || '—'}</div>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Past Topics</div>
                    <div className="text-gray-600">{campaignMemory.pastTopics?.join(', ') || '—'}</div>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Past Hooks</div>
                    <div className="text-gray-600">{campaignMemory.pastHooks?.join(', ') || '—'}</div>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Past Trends</div>
                    <div className="text-gray-600">
                      {campaignMemory.pastTrendsUsed?.join(', ') || '—'}
                    </div>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Overlap Check</div>
                    <div className="text-gray-600">
                      {memoryOverlap?.status || 'unknown'} • score {memoryOverlap?.overlap?.similarityScore ?? 0}
                    </div>
                    <div className="text-gray-600">
                      {memoryOverlap?.suggestions?.join(' ') || ''}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'business' ? (
            <div className="space-y-3">
              {isBusinessLoading ? (
                <div className="text-sm text-gray-500">Loading business intelligence…</div>
              ) : (
                <div className="space-y-3">
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Forecast</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(forecastReport, null, 2)}
                    </pre>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">ROI</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(roiReport, null, 2)}
                    </pre>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Business Report</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(businessReport, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'platform' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <select
                  value={platformIntelAssetId}
                  onChange={(e) => setPlatformIntelAssetId(e.target.value)}
                  className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
                >
                  <option value="">Select asset</option>
                  {contentAssets.map((asset) => (
                    <option key={asset.asset_id} value={asset.asset_id}>
                      {asset.day} • {asset.platform}
                    </option>
                  ))}
                </select>
                <select
                  value={platformIntelPlatform}
                  onChange={(e) => setPlatformIntelPlatform(e.target.value)}
                  className="rounded border border-gray-200 px-2 py-1 text-xs"
                >
                  {['linkedin', 'instagram', 'x', 'youtube', 'blog', 'tiktok', 'podcast'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select
                  value={platformIntelContentType}
                  onChange={(e) => setPlatformIntelContentType(e.target.value)}
                  className="rounded border border-gray-200 px-2 py-1 text-xs"
                >
                  {['text', 'image', 'video', 'audio', 'carousel', 'blog'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handlePlatformIntel}
                  disabled={isPlatformIntelLoading}
                  className="px-3 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
                >
                  {isPlatformIntelLoading ? 'Loading…' : 'Generate'}
                </button>
              </div>
              {platformIntelData && (
                <div className="space-y-2 text-xs">
                  <div className="border rounded p-2 bg-white">
                    <div className="font-semibold">Formatted Content</div>
                    <div className="text-gray-700">{platformIntelData.variant?.formatted_content || '—'}</div>
                  </div>
                  <div className="border rounded p-2 bg-white">
                    <div className="font-semibold">Promotion Metadata</div>
                    <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-700">
                      {JSON.stringify(platformIntelData.metadata, null, 2)}
                    </pre>
                  </div>
                  <div className="border rounded p-2 bg-white">
                    <div className="font-semibold">Compliance</div>
                    <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-700">
                      {JSON.stringify(platformIntelData.compliance, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`flex w-full ${message.type === 'user' ? 'justify-end' : 'justify-start'} px-1 sm:px-2`}>
                <div className={`px-4 py-3 rounded-lg min-w-0 ${
                  message.type === 'user' 
                    ? (isRecsChat ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white max-w-[90%]' : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white max-w-[90%]')
                    : 'bg-gray-100 text-gray-900 w-full'
                }`}>
                  {message.type === 'ai' &&
                  structuredPlan &&
                  structuredPlanMessageId === message.id ? (
                    <div className="text-sm space-y-3">
                      {renderStructuredPlan(structuredPlan)}
                      <button
                        onClick={() => setShowScheduleConfirm(true)}
                        disabled={isBusy || !campaignId || governanceLocked}
                        className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-white rounded-lg transition-all duration-200 text-sm font-medium disabled:opacity-50 ${isRecsChat ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700' : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700'}`}
                      >
                        <Calendar className="h-4 w-4" />
                        Schedule this plan
                      </button>
                    </div>
                  ) : message.type === 'ai' ? (
                    <>
                      <FormattedAIMessage message={message.message} />
                      {activeTab === 'chat' && message.id === quickPickAiMessageId
                        ? renderQuickPickPanel(quickPickConfig)
                        : null}
                    </>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.message}</p>
                  )}
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {message.attachments.map((attachment, index) => (
                        <div key={index} className="text-xs opacity-75 flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {attachment}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className={`text-xs mt-2 flex items-center gap-1 ${
                    message.type === 'user' ? (isRecsChat ? 'text-emerald-100' : 'text-indigo-100') : 'text-gray-500'
                  }`}>
                    <span>{message.timestamp}</span>
                    {message.provider && (
                      <>
                        <span>•</span>
                        <span className="font-medium">{message.provider}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          
          {isTyping && activeTab === 'chat' && (() => {
            const lastUserMsg = [...messages].filter((m) => m.type === 'user').pop()?.message ?? '';
            const isFinalPlanRequest = modeLoading.generate_plan && isFinalPlanSubmissionMessage(lastUserMsg);
            if (isFinalPlanRequest) {
              const weeksMatch = lastUserMsg.match(/(?:proceed with|use)\s*(\d+)\s*weeks?|(\d+)\s*weeks?/i);
              const weeksNum = weeksMatch
                ? parseInt(weeksMatch[1] || weeksMatch[2] || '0', 10)
                : (campaignData as { duration_weeks?: number } | undefined)?.duration_weeks ?? initialPlan?.weeks?.length ?? 12;
              const resolvedWeeks = Math.min(12, Math.max(2, Number.isFinite(weeksNum) && weeksNum > 0 ? weeksNum : 12));
              const planTiming = getWeeklyPlanTimingByWeeks(resolvedWeeks);
              const finalMessage = `Creating ${resolvedWeeks}-week plan`;
              return (
                <div className="flex justify-start w-full px-1 sm:px-2">
                  <div className="w-full max-w-md">
                    <AIGenerationProgress
                      isActive={true}
                      message={`Creating ${resolvedWeeks}-week plan`}
                      expectedSeconds={planTiming.expectedSeconds}
                      maxSecondsHint={planTiming.maxSecondsHint}
                      onCancel={() => planAbortRef.current?.abort()}
                      rotatingMessages={[
                        'Validating your inputs…',
                        `Structuring ${resolvedWeeks} weeks…`,
                        'Building weekly themes…',
                        'Assigning content types…',
                        finalMessage,
                      ]}
                    />
                  </div>
                </div>
              );
            }
            if (isSchedulingPlan) {
              return (
                <div className="flex justify-start w-full px-1 sm:px-2">
                  <div className="w-full max-w-md">
                    <AIGenerationProgress
                      isActive={true}
                      message="Scheduling structured plan"
                      expectedSeconds={45}
                      maxSecondsHint={90}
                      rotatingMessages={[
                        'Applying schedule…',
                        'Updating calendar…',
                        'Finishing schedule…',
                      ]}
                    />
                  </div>
                </div>
              );
            }
            if (modeLoading.generate_plan || modeLoading.refine_day || modeLoading.platform_customize) {
              const isRefineDay = modeLoading.refine_day;
              const isPlatformCustomize = modeLoading.platform_customize;
              const message = isRefineDay
                ? 'Refining selected day'
                : isPlatformCustomize
                  ? 'Customizing platform content'
                  : 'Refining campaign inputs';
              const rotating = isRefineDay
                ? ['Loading week…', 'Generating day content…', 'Applying refinements…']
                : isPlatformCustomize
                  ? ['Loading platforms…', 'Customizing per platform…', 'Applying changes…']
                  : ['Reading your answers…', 'Structuring next steps…', 'Preparing next question…'];
              return (
                <div className="flex justify-start w-full px-1 sm:px-2">
                  <div className="w-full max-w-md">
                    <AIGenerationProgress
                      isActive={true}
                      message={message}
                      expectedSeconds={isRefineDay ? 60 : isPlatformCustomize ? 45 : 30}
                      maxSecondsHint={120}
                      onCancel={() => planAbortRef.current?.abort()}
                      rotatingMessages={rotating}
                    />
                  </div>
                </div>
              );
            }
            return (
              <div className="flex justify-start w-full px-1 sm:px-2">
                <div className="bg-gray-100 text-gray-900 px-4 py-3 rounded-lg min-w-0">
                  <div className="flex items-center gap-2">
                    {isLoading ? (
                      <Loader2 className={`h-4 w-4 animate-spin ${isRecsChat ? 'text-emerald-500' : 'text-indigo-500'}`} />
                    ) : (
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    )}
                    <span className="text-sm text-gray-600">
                      {selectedProvider === 'demo'
                        ? 'Demo AI is analyzing campaign data...'
                        : selectedProvider === 'gpt'
                        ? 'GPT-4 is learning from past campaigns...'
                        : 'Claude is reasoning with campaign context...'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
          <div ref={messagesEndRef} />
        </div>

        {/* Plan Review — Split: Week cards left, AI chat right. Refine via chat, then Submit. */}
        {showPlanOverview && structuredPlan && (
          <div
            className="absolute inset-0 bg-white z-40 flex flex-col"
            onMouseUp={(e) => {
              if (!replaceMode) return;
              if (typeof window === 'undefined') return;
              const target = e.target as HTMLElement | null;
              if (!target) return;
              if (target.closest('input, textarea, button')) return;
              const selection = window.getSelection?.();
              const selectedText = selection?.toString?.().trim?.() || '';
              if (!selectedText) return;
              // Always clear browser selection highlight in replacement mode
              try { selection?.removeAllRanges?.(); } catch (_) { /* no-op */ }
              if (selectedText.length > 800) {
                setUiErrorMessage('Selection is too long for editing. Please select a shorter snippet (<= 800 chars).');
                return;
              }
              const weekEl = target.closest('[data-week]') as HTMLElement | null;
              const weekAttr = weekEl?.getAttribute('data-week') || '';
              const weekNumber = Number(weekAttr);
              if (!Number.isFinite(weekNumber) || weekNumber < 1) {
                setUiErrorMessage('Select text inside a Week card (left) or Week blueprint (right) to use Edit mode.');
                return;
              }
              setUiErrorMessage(null);
              setReplaceSelection({ week: weekNumber, text: selectedText });
              setReviewWeekNumber(weekNumber);
            }}
          >
            <div className="bg-gradient-to-r from-purple-500 to-violet-600 text-white p-3 flex items-center justify-between shrink-0">
              <h3 className="text-lg font-bold">Review & Refine Plan</h3>
              <p className="text-purple-100 text-sm hidden sm:inline">Make changes through chat on the right, then Submit. To replace text: click Edit, select the portion to change, then type the new words.</p>
              <button onClick={() => setShowPlanOverview(false)} className="p-2 hover:bg-white/20 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 flex min-h-0">
              {/* Left: Week cards */}
              <div className="w-[45%] min-w-[280px] overflow-y-auto p-4 border-r border-gray-200 bg-gray-50">
                <div className="grid grid-cols-1 gap-3">
                  {structuredPlan.weeks.map((week) => {
                    const themeLabel = week.theme || week.phase_label || `Week ${week.week}`;
                    const hasDaily = week.daily && week.daily.length > 0;
                    const hasEnrichedTopics = Array.isArray((week as any).topics) && (week as any).topics.length > 0;
                    const platformTargets = Object.entries((week as any)?.platform_allocation || {})
                      .map(([platform, count]) => `${platform}: ${count}`)
                      .filter(Boolean);
                    const contentTypes = Array.isArray((week as any)?.content_type_mix) ? (week as any).content_type_mix : [];
                    const topicsWithExecution = hasEnrichedTopics
                      ? (((week as any).topics as any[]).map((topic, idx) => ({
                          ...topic,
                          topicExecution: {
                            platformTargets: platformTargets.length > 0
                              ? [platformTargets[idx % platformTargets.length]]
                              : ['—'],
                            contentType: contentTypes[idx % Math.max(contentTypes.length, 1)] || '—',
                            ctaType: (week as any)?.cta_type || '—',
                            kpiFocus: (week as any)?.weekly_kpi_focus || '—',
                          },
                        })))
                      : [];
                    return (
                      <div
                        key={week.week}
                        data-week={week.week}
                        role="button"
                        tabIndex={0}
                        onClick={() => setReviewWeekNumber(week.week)}
                        onKeyDown={(e) => e.key === 'Enter' && setReviewWeekNumber(week.week)}
                        className={`border border-gray-200 rounded-xl p-4 bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
                          reviewWeekNumber === week.week ? 'ring-2 ring-indigo-400' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-gray-900">Week {week.week}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setNewMessage(`Generate the daily plan for Week ${week.week}.`); setTimeout(() => inputRef.current?.focus(), 100); }}
                            disabled={isBusy}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 disabled:opacity-50"
                            title="Generate daily plan"
                          >
                            <Sparkles className="h-3 w-3" />
                            AI daily
                          </button>
                        </div>
                        <div className="text-xs text-gray-600 font-medium mb-1">{themeLabel}</div>
                        {week.primary_objective && <div className="text-xs text-gray-600 mb-1">{week.primary_objective}</div>}
                        {hasEnrichedTopics ? (
                          <div className="mt-2 space-y-2 text-xs">
                            {(week as any)?.weeklyContextCapsule && (
                              <div className="rounded border border-indigo-100 bg-indigo-50/50 p-2 text-gray-700">
                                <div><span className="font-medium">Audience:</span> {(week as any).weeklyContextCapsule.audienceProfile || '—'}</div>
                                <div><span className="font-medium">Weekly intent:</span> {(week as any).weeklyContextCapsule.weeklyIntent || '—'}</div>
                                <div><span className="font-medium">Tone:</span> {(week as any).weeklyContextCapsule.toneGuidance || '—'}</div>
                              </div>
                            )}
                            <div className="space-y-2">
                              {topicsWithExecution.map((topic, idx) => (
                                <div key={`${week.week}-topic-${idx}`} className="rounded border border-gray-200 p-2">
                                  <div className="font-medium text-gray-900">{topic.topicTitle || `Topic ${idx + 1}`}</div>
                                  <div className="text-gray-600">{getIntentLabelForContentType(topic?.topicExecution?.contentType ?? (topic as any)?.content_type)}: {topic?.topicContext?.writingIntent || '—'}</div>
                                  <div className="text-gray-600">Platform(s): {(topic.topicExecution.platformTargets || []).join(', ')}</div>
                                  <div className="text-gray-600">Content type: {topic.topicExecution.contentType || '—'}</div>
                                  <div className="text-gray-600">CTA: {topic.topicExecution.ctaType || '—'} • KPI: {topic.topicExecution.kpiFocus || '—'}</div>
                                  <div className="text-gray-600">Who: {topic.whoAreWeWritingFor || '—'}</div>
                                  <div className="text-gray-600">Problem: {topic.whatProblemAreWeAddressing || '—'}</div>
                                  <div className="text-gray-600">Learns: {topic.whatShouldReaderLearn || '—'}</div>
                                  <div className="text-gray-600">Action: {topic.desiredAction || '—'}</div>
                                  <div className="text-gray-600">Style: {topic.narrativeStyle || '—'}</div>
                                  <div className="text-gray-600">
                                    {getFormatLineForContentType(
                                      topic?.topicExecution?.contentType ?? (topic as any)?.contentType ?? (topic as any)?.content_type,
                                      topic?.contentTypeGuidance,
                                      topic?.topicExecution?.platformTargets
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {hasDaily && <span className="text-green-600">✓ {week.daily!.length} days</span>}
                          </div>
                        ) : (
                          <>
                            {(week.topics_to_cover?.length ?? 0) > 0 && (
                              <div className="mb-2">
                                <div className="text-gray-500 font-medium text-xs">Topics to cover:</div>
                                <ul className="list-disc list-inside text-xs text-gray-700">{week.topics_to_cover!.map((t, i) => <li key={i}>{t}</li>)}</ul>
                              </div>
                            )}
                            <div className="text-xs space-y-1 mb-1">
                              {renderWeekPlatformContent(week)}
                              {week.cta_type && <div className="text-gray-500">CTA: {week.cta_type} • KPI: {week.weekly_kpi_focus || '—'}</div>}
                              {hasDaily && <span className="text-green-600">✓ {week.daily!.length} days</span>}
                            </div>
                          </>
                        )}
                        {renderResolvedPostingMetadata(week)}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Right: Week blueprint + Chat */}
              <div className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden">
                <div className="border-b bg-white px-4 pt-3 pb-2">
                  <div className="flex gap-2 overflow-x-auto whitespace-nowrap">
                    {structuredPlan.weeks.map((w) => (
                      <button
                        key={`right-week-tab-${w.week}`}
                        type="button"
                        onClick={() => setReviewWeekNumber(w.week)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                          reviewWeekNumber === w.week
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        Week {w.week}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3 space-y-1.5">
                    <p>To replace text in a week: click <strong>Edit</strong>, select the portion you want to change (in the plan), then type the new wording and send.</p>
                    <p className="text-xs">Edit via natural language, e.g. &quot;Week 1 Facebook topic: Professional neglecting personal lives&quot;, &quot;Same post on Facebook and LinkedIn&quot;, &quot;Week 3 LinkedIn: 2 posts, 1 article&quot;</p>
                  </div>
                  {messages
                    .filter((m) => {
                      // Hide legacy AI-based replacement instruction blobs in the overlay
                      if (m.type === 'user') {
                        const t = (m.message || '').trim();
                        if (t.startsWith('Apply a precise text replacement in the structured weekly blueprint')) return false;
                        if (t.includes('Replace EXACT text:') && t.includes('With EXACT text:')) return false;
                      }
                      return true;
                    })
                    .map((m) => (
                      <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${m.type === 'user' ? (isRecsChat ? 'bg-emerald-600 text-white' : 'bg-indigo-500 text-white') : 'bg-gray-100 text-gray-900'}`}>
                          {m.type === 'ai' && structuredPlan && structuredPlanMessageId === m.id
                            ? (
                              <div className="whitespace-pre-wrap" data-week={reviewWeekNumber}>
                                {renderStructuredPlan({
                                  ...structuredPlan,
                                  weeks: structuredPlan.weeks.filter((w) => w.week === reviewWeekNumber),
                                })}
                              </div>
                            )
                            : <div className="whitespace-pre-wrap">{formatPlanMarkersForDisplay(m.message)}</div>}
                        </div>
                      </div>
                    ))}
                  {isTyping && <div className="flex justify-start"><div className="bg-gray-100 px-3 py-2 rounded-lg text-sm text-gray-600">Thinking…</div></div>}
                  <div ref={messagesEndRef} />
                </div>
                <div className="sticky bottom-0 bg-white border-t shrink-0">
                  <div className="p-3 sm:p-4 space-y-2">
                    {uiErrorMessage && (
                      <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">
                        {uiErrorMessage}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setReplaceMode((v) => !v);
                          setReplaceSelection(null);
                          setUiErrorMessage(null);
                          setTimeout(() => inputRef.current?.focus(), 0);
                        }}
                        disabled={isBusy}
                        className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                          replaceMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        } disabled:opacity-50`}
                        title="Edit mode: highlight text, then type edited text"
                      >
                        Edit
                      </button>
                      {replaceMode && replaceSelection?.text && (
                        <div className="flex-1 min-w-0 flex items-center gap-2 text-xs text-gray-700">
                          <div className="truncate">
                            <span className="font-medium">Week {replaceSelection.week}:</span> “{replaceSelection.text}”
                          </div>
                          <button
                            type="button"
                            onClick={() => setReplaceSelection(null)}
                            className="shrink-0 px-2 py-1 rounded bg-white border border-gray-200 hover:bg-gray-50"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        key={inputClearKey}
                        ref={(el) => { inputRef.current = el; }}
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder={
                          replaceMode
                            ? `Type the edited text and press Enter (Week ${replaceSelection?.week ?? reviewWeekNumber}).`
                            : "e.g. Week 1 Facebook topic: Professional neglecting personal lives. Week 3 LinkedIn: 2 posts, 1 article."
                        }
                        className="flex-1 px-3 py-2 border rounded-lg text-sm"
                        disabled={isBusy}
                      />
                      <button
                        onClick={() => {
                          if (replaceMode) {
                            const replacementText = newMessage.trim();
                            if (!replaceSelection?.text?.trim() || !replacementText) return;
                            const weekNumber = replaceSelection.week || reviewWeekNumber;
                            const oldText = replaceSelection.text;
                            if (!structuredPlan?.weeks?.length) {
                              setUiErrorMessage('No structured plan loaded to apply edits.');
                              return;
                            }
                            const { nextPlan, replacedCount } = applyLocalWeekTextReplacement(structuredPlan, weekNumber, oldText, replacementText);
                            if (replacedCount <= 0) {
                              setUiErrorMessage('Could not apply edit in plan data. Try selecting only the value (avoid selecting labels like "Audience:").');
                              return;
                            }
                            setStructuredPlan(nextPlan);

                            const userMessage: ChatMessage = {
                              id: Date.now(),
                              type: 'user',
                              message: `Edit in Week ${weekNumber}: "${oldText}" → "${replacementText}"`,
                              timestamp: new Date().toLocaleTimeString(),
                              campaignId
                            };
                            const aiMessage: ChatMessage = {
                              id: Date.now() + 1,
                              type: 'ai',
                              message: `Applied edit locally in Week ${weekNumber}.`,
                              timestamp: new Date().toLocaleTimeString(),
                              provider: getProviderName(selectedProvider),
                              campaignId
                            };
                            setMessages((prev) => [...prev, userMessage, aiMessage]);
                            try { void saveCampaignMessage(userMessage); void saveCampaignMessage(aiMessage); } catch (_) { /* no-op */ }
                            setNewMessage('');
                            setInputClearKey((k) => k + 1);
                            setReplaceMode(false);
                            setReplaceSelection(null);
                            setUiErrorMessage(null);
                            focusInputSoon();
                            return;
                          }
                          sendMessage();
                        }}
                        disabled={isBusy || (!newMessage.trim()) || (replaceMode && !replaceSelection?.text?.trim())}
                        className={`px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 ${isRecsChat ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                      >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                      </button>
                    </div>
                  </div>
                  <div className="px-4 pb-4 flex justify-between items-center gap-3">
                    <button onClick={() => setShowPlanOverview(false)} className="text-gray-600 hover:text-gray-800 text-sm">Close</button>
                    <div className="flex flex-wrap gap-2">
                      {context === 'campaign-planning' && onProgramGenerated && campaignId && (
                        <button
                          onClick={() => saveDraftAndViewOnCampaign()}
                          disabled={isSavingDraftForView}
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                        >
                          {isSavingDraftForView ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Save & view on campaign
                        </button>
                      )}
                      <button onClick={() => { setShowPlanOverview(false); saveAIContentForPlan(serializeStructuredPlanToText(structuredPlan), structuredPlan); }} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg text-sm font-medium">Save for Later</button>
                      <button onClick={() => commitPlan()} className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg font-medium">Submit This Plan</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showPlanPreview && !showPlanOverview && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] mx-4 flex flex-col">
              <div className="bg-gradient-to-r from-purple-500 to-violet-600 text-white p-4 rounded-t-2xl flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">Content Plan Preview</h3>
                  <p className="text-purple-100 text-sm">Review your campaign plan before committing</p>
                </div>
                <button
                  onClick={() => setShowPlanPreview(false)}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6">
                <div className="prose max-w-none">
                  <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
                    {selectedPlan}
                  </div>
                </div>
              </div>
              
              <div className="border-t border-gray-200 p-4 bg-gray-50 rounded-b-2xl">
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => setShowPlanPreview(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowPlanPreview(false);
                        commitPlan(selectedPlan);
                      }}
                      className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 font-medium"
                    >
                      Submit This Plan
                    </button>
                    <button
                      onClick={() => {
                        setShowPlanPreview(false);
                        saveAIContentForPlan(selectedPlan);
                      }}
                      className="px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all duration-200 font-medium"
                    >
                      Save for Later
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Submit Plan modal removed — submit is direct */}

        {/* Schedule Plan Confirmation */}
        {showScheduleConfirm && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 mb-2">Schedule This Plan</h3>
                <p className="text-gray-600">
                  This will create scheduled posts for each day and platform in your plan.
                </p>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowScheduleConfirm(false)}
                  disabled={isSchedulingPlan}
                  className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={scheduleStructuredPlan}
                  disabled={isSchedulingPlan || governanceLocked}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSchedulingPlan ? 'Scheduling...' : 'Confirm & Schedule'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          {(() => {
            if (!shouldRenderQuickPickInInput) return null;
            const config = quickPickConfig;
            if (!config || hideQuickPickPanel) return null;
            if (config.key === 'available_content') {
              const hasAnyInput = Object.values(quickCapacityCounts).some((v) => {
                const n = Number(String(v).trim());
                return Number.isFinite(n) && n > 0;
              });
              const canSubmit = hasAnyInput || (quickCustomizeMode && quickCustomizeText.trim().length > 0);
              return (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="text-xs text-gray-600 mb-2">
                    Enter counts for any existing content you already have. If none, click <span className="font-semibold">None</span>.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    {config.options.map((option) => (
                      <label key={option} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
                        <span className="text-xs text-gray-700 w-20 shrink-0">{option}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={3}
                          value={quickCapacityCounts[option] ?? ''}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, '').slice(0, 3);
                            setQuickCapacityCounts((prev) => ({ ...prev, [option]: value }));
                          }}
                          placeholder="0"
                          className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                          disabled={isBusy}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={async () => {
                        setHideQuickPickPanel(true);
                        await sendMessage('No');
                      }}
                      className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-emerald-400"
                    >
                      None
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setQuickCustomizeMode(false);
                        setQuickCustomizeText('');
                        setSelectedQuickOptions([]);
                        setHideQuickPickPanel(true);
                        focusInputSoon();
                      }}
                      className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
                    >
                      Customize
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || !canSubmit}
                      onClick={() => submitQuickPickAnswer(config)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              );
            }
            if (config.key === 'tentative_start') {
              const canSubmitDate =
                quickDateYear.trim().length === 4 &&
                quickDateMonth.trim().length >= 1 &&
                quickDateDay.trim().length >= 1;
              return (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="text-xs text-gray-600 mb-2">
                    Select date fields and submit (YYYY-MM-DD).
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={quickDateYear}
                      onChange={(e) => setQuickDateYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="YYYY"
                      className="w-24 px-2 py-2 border border-gray-300 rounded-md text-sm"
                      disabled={isBusy}
                    />
                    <span className="text-gray-500">-</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      value={quickDateMonth}
                      onChange={(e) => setQuickDateMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      placeholder="MM"
                      className="w-16 px-2 py-2 border border-gray-300 rounded-md text-sm"
                      disabled={isBusy}
                    />
                    <span className="text-gray-500">-</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      value={quickDateDay}
                      onChange={(e) => setQuickDateDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      placeholder="DD"
                      className="w-16 px-2 py-2 border border-gray-300 rounded-md text-sm"
                      disabled={isBusy}
                    />
                    <button
                      type="button"
                      disabled={isBusy || !canSubmitDate}
                      onClick={() => submitQuickPickAnswer(config)}
                      className="px-3 py-2 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              );
            }
            if (config.key === 'content_capacity') {
              const hasCapacityInput = Object.values(quickCapacityCounts).some((v) => {
                const n = Number(String(v).trim());
                return Number.isFinite(n) && n > 0;
              });
              return (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="text-xs text-gray-600 mb-2">
                    Enter weekly count for each content type, then submit.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    {config.options.map((option) => (
                      <label key={option} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
                        <span className="text-xs text-gray-700 w-20 shrink-0">{option}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          value={quickCapacityCounts[option] ?? ''}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, '').slice(0, 2);
                            setQuickCapacityCounts((prev) => ({ ...prev, [option]: value }));
                          }}
                          placeholder="0"
                          className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                          disabled={isBusy}
                        />
                        <span className="text-xs text-gray-500">/week</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setQuickCustomizeMode(false);
                        setQuickCustomizeText('');
                        setSelectedQuickOptions([]);
                        setHideQuickPickPanel(true);
                        focusInputSoon();
                      }}
                      className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
                    >
                      Customize
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || !hasCapacityInput}
                      onClick={() => submitQuickPickAnswer(config)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
                    >
                      Submit selection
                    </button>
                  </div>
                </div>
              );
            }
            if (config.key === 'platform_content_types') {
              const platforms = planningSelectedPlatforms || [];
              const hasPlatforms = platforms.length > 0;
              const hasAnySelection = Object.values(quickPlatformContentTypes).some((arr) => (arr?.length ?? 0) > 0);
              return (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="text-xs text-gray-600 mb-2">
                    Select content types per platform, then submit.
                  </div>
                  {!hasPlatforms ? (
                    <div className="text-xs text-gray-500">
                      (No platforms detected yet. Please answer the platforms question first, or click Customize and type your answer.)
                    </div>
                  ) : (
                    <div className="space-y-3 mb-2">
                      {platforms.map((platform) => {
                        const platformName = platformLabels[platform] || platform;
                        const options = platformContentTypeOptions[platform] || [];
                        const selected = quickPlatformContentTypes[platform] || [];
                        return (
                          <div key={platform} className="bg-white border border-gray-200 rounded-md p-2">
                            <div className="text-xs font-medium text-gray-700 mb-2">{platformName}</div>
                            <div className="flex flex-wrap gap-2">
                              {options.map((opt, idx) => {
                                const isSelected = selected.includes(opt);
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => {
                                      setQuickPlatformContentTypes((prev) => {
                                        const curr = prev[platform] || [];
                                        const next = curr.includes(opt) ? curr.filter((x) => x !== opt) : [...curr, opt];
                                        return { ...prev, [platform]: next };
                                      });
                                    }}
                                    className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                                      isSelected
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                                    }`}
                                    title={`${idx + 1}. ${opt}`}
                                  >
                                    {idx + 1}. {opt}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setQuickCustomizeMode(false);
                        setQuickCustomizeText('');
                        setSelectedQuickOptions([]);
                        setHideQuickPickPanel(true);
                        focusInputSoon();
                      }}
                      className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
                    >
                      Customize
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || !hasAnySelection}
                      onClick={() => submitQuickPickAnswer(config)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
                    >
                      Submit selection
                    </button>
                  </div>
                </div>
              );
            }
            if (config.key === 'platform_content_requests') {
              const platforms = planningSelectedPlatforms || [];
              const hasPlatforms = platforms.length > 0;
              const hasCatalog = platformCatalogPlatforms && platformCatalogPlatforms.length > 0;
              const hasAnyRequest = Object.values(planningPlatformContentRequests || {}).some((byType) =>
                Object.values(byType || {}).some((v) => {
                  const n = Number(String(v || '').replace(/\D/g, '').slice(0, 2));
                  return Number.isFinite(n) && n > 0;
                })
              );
              const normalizeCtForPrefs = (raw: string): string => {
                const n = String(raw || '').toLowerCase().trim();
                if (!n) return '';
                if (n === 'feed_post' || n === 'tweet') return 'post';
                if (n.includes('blog') || n.includes('article')) return 'article';
                if (n.includes('slide')) return 'slideware';
                if (n.includes('carousel')) return 'carousel';
                if (n.includes('image')) return 'image';
                if (n.includes('song') || n.includes('audio')) return 'song';
                if (n.includes('thread')) return 'thread';
                if (n.includes('space')) return 'space';
                if (n.includes('short')) return 'short';
                if (n.includes('live')) return 'live';
                if (n.includes('reel')) return 'reel';
                if (n.includes('story')) return 'story';
                if (n.includes('video')) return 'video';
                if (n.includes('post')) return 'post';
                return n.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
              };
              return (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="text-xs text-gray-600 mb-2">
                    Select content types per platform and enter weekly counts (per week), then submit.
                  </div>
                  {!hasCatalog ? (
                    <div className="text-xs text-red-600 mb-2">
                      Platform intelligence catalog is required (DB-driven). Please ensure platform tables are available.
                    </div>
                  ) : null}
                  {!hasPlatforms ? (
                    <div className="text-xs text-gray-500">
                      (No platforms detected yet. Please answer the platforms question first, or click Customize and type your answer.)
                    </div>
                  ) : (
                    <div className="space-y-3 mb-2">
                      {platforms.map((platform) => {
                        const platformName = platformLabels[platform] || platform;
                        const rawTypesAll = getAllSupportedContentTypeKeysForPlatform(platform, platformContentTypeRawOptions, platformContentTypeOptions);
                        const byType = planningPlatformContentRequests?.[platform] || {};
                        const selectedKeys = Object.keys(byType || {}).filter((ct) => {
                          const digits = String((byType as any)?.[ct] ?? '').replace(/\D/g, '');
                          return digits.length > 0;
                        });
                        const hasExistingSelection = selectedKeys.length > 0;
                        const showAll = Boolean(showAllPlatformRequestTypes?.[platform]);
                        const prefs = planningPlatformContentTypePrefs?.[platform] || null;
                        const allowed =
                          prefs && prefs.length > 0
                            ? new Set(prefs.map((p) => String(p || '').toLowerCase().trim()).filter(Boolean))
                            : null;
                        const rawTypes = rawTypesAll.filter((ct) => {
                          if (!allowed) return true;
                          const canon = normalizeCtForPrefs(ct);
                          return canon ? allowed.has(canon) : false;
                        });
                        const effectiveTypes =
                          hasExistingSelection && !showAll
                            ? rawTypes.filter((ct) => selectedKeys.includes(ct))
                            : rawTypes;
                        return (
                          <div key={platform} className="bg-white border border-gray-200 rounded-md p-2">
                            <div className="text-xs font-medium text-gray-700 mb-2">{platformName}</div>
                            <div className="flex items-center gap-2 mb-2">
                              {hasExistingSelection ? (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    setShowAllPlatformRequestTypes((prev) => ({ ...(prev || {}), [platform]: !showAll }))
                                  }
                                  className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:border-indigo-400"
                                >
                                  {showAll ? 'Show only selected' : 'Add more types'}
                                </button>
                              ) : null}
                              {allowed ? (
                                <span className="text-[11px] text-gray-500">(Filtered by your earlier content-type selection)</span>
                              ) : null}
                            </div>
                            {effectiveTypes.length === 0 ? (
                              <div className="text-xs text-gray-500">No content types available for this platform.</div>
                            ) : (
                              <div className="space-y-2">
                                {effectiveTypes.map((ct) => {
                                  const label = prettyContentTypeLabel(ct);
                                  const value = String(byType?.[ct] ?? '');
                                  const checked = value.replace(/\D/g, '').length > 0;
                                  const checkboxId2 = `platform-${platform}-${ct}-cb-2`;
                                  return (
                                    <div
                                      key={ct}
                                      className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2"
                                    >
                                      <input
                                        id={checkboxId2}
                                        type="checkbox"
                                        checked={checked}
                                        disabled={isBusy}
                                        onChange={(e) => {
                                          const nextChecked = e.target.checked;
                                          setPlanningPlatformContentRequests((prev) => {
                                            const current = { ...(prev?.[platform] || {}) };
                                            if (!nextChecked) {
                                              delete current[ct];
                                            } else if (!current[ct]) {
                                              current[ct] = '1';
                                            }
                                            return { ...(prev || {}), [platform]: current };
                                          });
                                        }}
                                      />
                                      <label htmlFor={checkboxId2} className="text-xs text-gray-700 w-44 shrink-0 cursor-pointer select-none">{label}</label>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={2}
                                        value={value}
                                        onChange={(e) => {
                                          const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                                          setPlanningPlatformContentRequests((prev) => {
                                            const current = { ...(prev?.[platform] || {}) };
                                            if (!digits) {
                                              delete current[ct];
                                            } else {
                                              current[ct] = digits;
                                            }
                                            return { ...(prev || {}), [platform]: current };
                                          });
                                        }}
                                        placeholder="0"
                                        className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                                        disabled={isBusy || !checked}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      <span className="text-xs text-gray-500">/week</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setQuickCustomizeMode(false);
                        setQuickCustomizeText('');
                        setSelectedQuickOptions([]);
                        setHideQuickPickPanel(true);
                        focusInputSoon();
                      }}
                      className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
                    >
                      Customize
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || !hasCatalog || !hasPlatforms || !hasAnyRequest}
                      onClick={() => submitQuickPickAnswer(config)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
                    >
                      Submit selection
                    </button>
                  </div>
                </div>
              );
            }
            if (config.key === 'exclusive_campaigns') {
              const platforms = planningSelectedPlatforms || [];
              const hasPlatforms = platforms.length > 0;
              const hasCatalog = platformCatalogPlatforms && platformCatalogPlatforms.length > 0;
              const canAdd = hasPlatforms && hasCatalog;
              const addRow = () => {
                const firstPlatform = platforms[0] || '';
                const firstType = firstPlatform ? (platformContentTypeRawOptions[firstPlatform]?.[0] || '') : '';
                setPlanningExclusiveCampaigns((prev) => [
                  ...(prev || []),
                  { platform: firstPlatform, content_type: firstType, count_per_week: '1' },
                ]);
              };
              return (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="text-xs text-gray-600 mb-2">
                    Add any platform-exclusive campaigns (per week). If none, submit without adding rows.
                  </div>
                  {!hasCatalog ? (
                    <div className="text-xs text-red-600 mb-2">
                      Platform intelligence catalog is required (DB-driven). Please ensure platform tables are available.
                    </div>
                  ) : null}
                  {!hasPlatforms ? (
                    <div className="text-xs text-gray-500 mb-2">
                      (No platforms detected yet. Please answer the platforms question first, or click Customize and type your answer.)
                    </div>
                  ) : null}
                  <div className="space-y-2 mb-2">
                    {(planningExclusiveCampaigns || []).map((row, idx) => {
                      const platform = String((row as any)?.platform || '');
                      const contentType = String((row as any)?.content_type || '');
                      const rawTypes = platform ? platformContentTypeRawOptions[platform] || [] : [];
                      return (
                        <div key={`${idx}-${platform}-${contentType}`} className="bg-white border border-gray-200 rounded-md p-2 flex flex-wrap items-center gap-2">
                          <select
                            value={platform}
                            disabled={isBusy || !canAdd}
                            onChange={(e) => {
                              const nextPlatform = e.target.value;
                              const nextType = platformContentTypeRawOptions[nextPlatform]?.[0] || '';
                              setPlanningExclusiveCampaigns((prev) =>
                                (prev || []).map((r, i) =>
                                  i === idx ? { ...r, platform: nextPlatform, content_type: nextType } : r
                                )
                              );
                            }}
                            className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                          >
                            {platforms.map((p) => (
                              <option key={p} value={p}>
                                {platformLabels[p] || p}
                              </option>
                            ))}
                          </select>
                          <select
                            value={contentType}
                            disabled={isBusy || !canAdd || rawTypes.length === 0}
                            onChange={(e) => {
                              const nextType = e.target.value;
                              setPlanningExclusiveCampaigns((prev) =>
                                (prev || []).map((r, i) => (i === idx ? { ...r, content_type: nextType } : r))
                              );
                            }}
                            className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                          >
                            {rawTypes.map((ct) => (
                              <option key={ct} value={ct}>
                                {prettyContentTypeLabel(ct)}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={2}
                            value={String((row as any)?.count_per_week ?? '')}
                            onChange={(e) => {
                              const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                              setPlanningExclusiveCampaigns((prev) =>
                                (prev || []).map((r, i) => (i === idx ? { ...r, count_per_week: digits } : r))
                              );
                            }}
                            placeholder="0"
                            className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                            disabled={isBusy || !canAdd}
                          />
                          <span className="text-xs text-gray-500">/week</span>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setPlanningExclusiveCampaigns((prev) => (prev || []).filter((_, i) => i !== idx));
                            }}
                            className="ml-auto px-2.5 py-1.5 rounded-md text-xs border border-gray-300 bg-white text-gray-700 hover:border-red-300"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy || !canAdd}
                      onClick={addRow}
                      className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
                    >
                      Add exclusive campaign
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setQuickCustomizeMode(false);
                        setQuickCustomizeText('');
                        setSelectedQuickOptions([]);
                        setHideQuickPickPanel(true);
                        focusInputSoon();
                      }}
                      className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
                    >
                      Customize
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || !hasCatalog || !hasPlatforms}
                      onClick={() => submitQuickPickAnswer(config)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              );
            }
            if (config.progressiveStyle && (config.key === 'communication_style' || config.key === 'action_expectation')) {
              const { primaryOptions, secondaryByPrimary } = config.progressiveStyle;
              const selectedPrimaries = quickPickPrimaryStyles;
              const secondaries = quickPickSecondaryModifiers;
              let compatibleSecondaries = selectedPrimaries.length > 0
                ? Array.from(new Set(selectedPrimaries.flatMap((p) => secondaryByPrimary[p] ?? [])))
                : [];
              if (config.key === 'communication_style' && selectedPrimaries.includes('Simple & easy')) {
                compatibleSecondaries = compatibleSecondaries.filter((s) => s !== 'Deep & thoughtful');
              }
              const isCta = config.key === 'action_expectation';
              const primaryLabel = isCta ? 'Choose one or more primary CTA intents.' : 'Choose one or more primary communication directions.';
              const modifiersLabel = isCta ? 'Select actions (optional):' : 'Select modifiers (optional):';
              return (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  {config.helperText && (
                    <div className="text-xs text-gray-600 mb-2 pb-2 border-b border-gray-200">{config.helperText}</div>
                  )}
                  {selectedPrimaries.length === 0 ? (
                    <>
                      <div className="text-xs text-gray-600 mb-2">{primaryLabel}</div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {primaryOptions.map((option) => {
                          const selected = selectedPrimaries.includes(option);
                          return (
                            <button
                              key={option}
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setQuickPickPrimaryStyles((prev) =>
                                  prev.includes(option) ? prev.filter((p) => p !== option) : [...prev, option]
                                );
                              }}
                              className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                                selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                              }`}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs text-gray-600 mb-2">
                        Primary: <span className="font-medium text-gray-800">{selectedPrimaries.join(', ')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {primaryOptions.map((option) => {
                          const selected = selectedPrimaries.includes(option);
                          return (
                            <button
                              key={option}
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                const next = selected
                                  ? selectedPrimaries.filter((p) => p !== option)
                                  : [...selectedPrimaries, option];
                                setQuickPickPrimaryStyles(next);
                                if (next.length === 0) {
                                  setQuickPickSecondaryModifiers([]);
                                } else {
                                  let nextCompat = Array.from(new Set(next.flatMap((p) => secondaryByPrimary[p] ?? [])));
                                  if (config.key === 'communication_style' && next.includes('Simple & easy')) {
                                    nextCompat = nextCompat.filter((s) => s !== 'Deep & thoughtful');
                                  }
                                  setQuickPickSecondaryModifiers((prev) => prev.filter((s) => nextCompat.includes(s)));
                                }
                              }}
                              className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                                selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                              }`}
                            >
                              {option}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setQuickPickPrimaryStyles([]);
                            setQuickPickSecondaryModifiers([]);
                          }}
                          className="px-2.5 py-1.5 rounded-full text-xs border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                        >
                          Clear primary
                        </button>
                      </div>
                      {compatibleSecondaries.length > 0 && (
                        <>
                          <div className="text-xs text-gray-600 mb-1 mt-2">{modifiersLabel}</div>
                          <div className="flex flex-wrap gap-2 mb-2">
                            {compatibleSecondaries.map((option) => {
                              const selected = secondaries.includes(option);
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => {
                                    setQuickPickSecondaryModifiers((prev) =>
                                      prev.includes(option)
                                        ? prev.filter((o) => o !== option)
                                        : [...prev, option]
                                    );
                                  }}
                                  className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                                    selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                                  }`}
                                >
                                  {option}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => submitQuickPickAnswer(config)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
                      >
                        Submit selection
                      </button>
                    </>
                  )}
                </div>
              );
            }
            return (
              <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="text-xs text-gray-600 mb-2">
                  {config.helperText ?? (config.multi ? 'Select one or more, then submit.' : 'Pick one, then submit.')}
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {config.options.map((option) => {
                    const selected = selectedQuickOptions.includes(option);
                    const tooltip = config.optionTooltips?.[option] ?? config.optionDescriptions?.[option];
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={isBusy}
                        title={tooltip}
                        onClick={() => {
                          if (config.multi) {
                            setSelectedQuickOptions((prev) =>
                              prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
                            );
                          } else {
                            setSelectedQuickOptions([option]);
                            setQuickCustomizeMode(false);
                            setQuickCustomizeText('');
                          }
                        }}
                        className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                          selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setQuickCustomizeMode(false);
                      setQuickCustomizeText('');
                      setSelectedQuickOptions([]);
                      setHideQuickPickPanel(true);
                      focusInputSoon();
                    }}
                    className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                      quickCustomizeMode ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-700 border-gray-300 hover:border-amber-400'
                    }`}
                  >
                    Customize
                  </button>
                </div>
                {quickCustomizeMode && (
                  <input
                    type="text"
                    value={quickCustomizeText}
                    onChange={(e) => setQuickCustomizeText(e.target.value)}
                    placeholder={config.key === 'campaign_duration' ? 'e.g., 6 weeks' : 'Add custom option(s)'}
                    className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-md text-sm"
                    disabled={isBusy}
                  />
                )}
                <button
                  type="button"
                  disabled={
                    isBusy ||
                    (!quickCustomizeMode && selectedQuickOptions.length === 0) ||
                    (quickCustomizeMode && !quickCustomizeText.trim() && selectedQuickOptions.length === 0)
                  }
                  onClick={() => submitQuickPickAnswer(config)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
                >
                  Submit selection
                </button>
              </div>
            );
          })()}
          {(() => {
            const lastPlanMessage = [...messages].reverse().find((m) => m.type === 'ai' && isWeeklyPlanMessage(m.message));
            const hasViewedPlan = lastPlanMessage && hasViewedPlanMessageId === lastPlanMessage.id;
            const hasPlanActions = Boolean(lastPlanMessage || structuredPlan || hasGeneratedPlanInSession);
            return (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {hasPlanActions && (
              <>
                <span className="hidden sm:inline text-gray-300 mx-1">|</span>
                <button
                  onClick={() => viewPlan(lastPlanMessage?.message, lastPlanMessage?.id ?? structuredPlanMessageId ?? undefined)}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-sm font-medium transition-colors disabled:opacity-50"
                  title="View plan first"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View Plan
                </button>
                  <button
                    onClick={() => commitPlan(structuredPlan ? undefined : lastPlanMessage?.message)}
                    disabled={isBusy || governanceLocked || (!structuredPlan && !hasViewedPlan)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium transition-colors disabled:opacity-50"
                  title={hasViewedPlan ? 'Submit to create campaign structure' : 'View plan first'}
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Submit Plan
                </button>
                <button
                  onClick={() => saveAIContentForPlan(lastPlanMessage?.message ?? '', structuredPlan ?? undefined)}
                  disabled={isBusy || !structuredPlan}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 text-sm font-medium transition-colors disabled:opacity-50"
                  title="Save chat for campaign planning (draft/edit)"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save for Later
                </button>
              </>
            )}
          </div>
            );
          })()}
          
          <div className="flex items-center gap-2">
            <input
              key={inputClearKey}
              ref={(el) => { inputRef.current = el; }}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={`Virality helps you promote "${displayTopic}"...`}
              className={`flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent transition-all duration-200 ${isRecsChat ? 'focus:ring-emerald-500' : 'focus:ring-indigo-500'}`}
              disabled={isBusy}
            />
            <ChatVoiceButton
              onTranscription={(text) => setNewMessage(text)}
              disabled={isBusy}
              context="campaign-chat"
              className="p-3 rounded-lg"
            />
            <button
              onClick={() => sendMessage()}
              disabled={!newMessage.trim() || isBusy}
              className={`p-3 disabled:opacity-50 text-white rounded-lg transition-all duration-200 ${isRecsChat ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700' : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700'}`}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
