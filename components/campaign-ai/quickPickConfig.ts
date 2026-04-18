import type { QuickPickConfig } from './types';
import { PLANNING_CONTENT_TYPE_LABELS } from './planningCatalog';

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

const CTA_INTENT_PRIMARY = [
  'Awareness',
  'Engagement',
  'Community Building',
  'Lead Generation',
  'Conversion / Sales',
] as const;

const CTA_ACTIONS_BY_INTENT: Record<string, string[]> = {
  Awareness: ['Like / react', 'Share with a friend/team', 'Save for later', 'Just understand the topic better'],
  Engagement: ['Comment with an opinion', 'Share with a friend/team', 'Like / react', 'Connect'],
  'Community Building': ['Follow / subscribe', 'Join newsletter', 'Connect', 'DM us'],
  'Lead Generation': ['Download a resource', 'Visit website', 'Join newsletter', 'DM us'],
  'Conversion / Sales': ['Book a call / demo', 'Visit website', 'DM us', 'Download a resource'],
};

const DURATION_PLAN_LABELS: Record<number, string> = {
  4: 'Starter',
  6: 'Growth',
  8: 'Pro',
  12: 'Enterprise',
};

const DURATION_OPTIONS = [4, 6, 8, 12] as const;
const ABSOLUTE_MAX_WEEKS = 12;

export function getQuickPickConfig(
  question: string,
  platformOptions: string[],
  maxDurationWeeks?: number | null
): QuickPickConfig | null {
  const q = question.toLowerCase();
  if (
    q.includes('capacity validation failed') ||
    q.includes('override capacity') ||
    q.includes('reduce counts') ||
    q.includes('reply with an updated request')
  ) {
    return {
      key: 'capacity_override',
      multi: false,
      options: ['Override & proceed', 'Use suggested counts'],
      helperText:
        'Choose how to proceed. "Override & proceed" continues with your current counts; "Use suggested counts" applies the recommended reduction.',
    };
  }
  if (
    q.includes('how many weeks') ||
    q.includes('campaign run') ||
    q.includes('duration') ||
    q.includes('create your week plan now')
  ) {
    const isCreatePlanStep = q.includes('create your week plan now');
    const max = maxDurationWeeks != null ? Math.min(maxDurationWeeks, ABSOLUTE_MAX_WEEKS) : ABSOLUTE_MAX_WEEKS;
    const options = DURATION_OPTIONS
      .filter((w) => w <= max)
      .map((w) => {
        const lbl = DURATION_PLAN_LABELS[w];
        return `${w} weeks${lbl ? ` (${lbl})` : ''}`;
      });
    options.push('Else share');
    return {
      key: 'campaign_duration',
      multi: false,
      options,
      helperText: isCreatePlanStep
        ? "You're all set — pick a duration and click Submit to create your plan."
        : `What is the duration of your campaign? (Max ${max} weeks for your plan)`,
    };
  }
  if (
    q.includes('core message') ||
    q.includes('key messages') ||
    q.includes('audience to remember') ||
    q.includes('one thing you want people to remember')
  ) {
    return {
      key: 'key_messages',
      multi: false,
      options: [],
      helperText: 'Type your core message(s). What should people remember after reading?',
    };
  }
  if (q.includes('how do you want your content to sound') || q.includes('how should your posts sound')) {
    return null;
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
          Awareness: 'Goal: people notice and remember you.',
          'Lead Generation': 'Goal: get sign-ups, demos, or contacts.',
          Engagement: 'Goal: more likes, comments, shares.',
          Authority: 'Goal: show expertise (e.g. download, read more).',
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
    return { key: 'available_content', multi: true, options: Array.from(PLANNING_CONTENT_TYPE_LABELS) };
  }
  if (
    q.includes('which platforms') ||
    q.includes('which social media platforms') ||
    q.includes('social media platforms do you want') ||
    q.includes('choose from your configured platforms') ||
    q.includes('platforms will you focus') ||
    q.includes('where will you post')
  ) {
    return { key: 'platforms', multi: true, options: platformOptions.length > 0 ? platformOptions : [] };
  }
  if (
    (q.includes('content types') && q.includes('count per week')) ||
    q.includes('set how often') ||
    q.includes('same topic across platforms') ||
    q.includes('publish same day on all platforms') ||
    q.includes('let AI decide')
  ) {
    return { key: 'platform_content_requests', multi: true, options: [] };
  }
  if (q.includes('platform-exclusive campaigns') || q.includes('anything only for one platform')) {
    return { key: 'exclusive_campaigns', multi: true, options: [] };
  }
  if (
    (q.includes('content types') && q.includes('platform')) ||
    q.includes('which content types will you use') ||
    q.includes('for each platform you selected')
  ) {
    return { key: 'platform_content_types', multi: true, options: [] };
  }
  if (q.includes('campaign types')) {
    return {
      key: 'campaign_types',
      multi: true,
      options: ['Brand awareness', 'Lead generation', 'Authority positioning', 'Engagement growth', 'Product promotion'],
    };
  }
  if ((q.includes('start') && q.includes('date')) || q.includes('yyyy-mm-dd')) {
    return { key: 'tentative_start', multi: false, options: [] };
  }
  if (
    q.includes('same content across all platforms') ||
    (q.includes('shared') && q.includes('unique')) ||
    q.includes('unique content for each platform') ||
    (q.includes('shared') && q.includes('platform')) ||
    (q.includes('unique') && q.includes('platform'))
  ) {
    return {
      key: 'cross_platform_sharing',
      multi: false,
      options: ['Shared (same content across all platforms)', 'Unique (different content per platform)'],
      helperText: 'Pick one. Shared = post the same content everywhere; Unique = create different content for each platform.',
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
    q.includes('how many pieces per week') ||
    (q.includes('how many') && q.includes('per week') && (q.includes('posts') || q.includes('videos') || q.includes('blogs'))) ||
    q.includes('create per week') ||
    q.includes('creator-dependent pieces') ||
    q.includes('how many can you create per week') ||
    q.includes('how many can you and your team create every week')
  ) {
    return { key: 'content_capacity', multi: true, options: Array.from(PLANNING_CONTENT_TYPE_LABELS) };
  }
  if (q.includes('success metrics') || (q.includes('metrics') && q.includes('track'))) {
    return { key: 'success_metrics', multi: true, options: ['Reach', 'Engagement', 'Leads', 'Bookings', 'Followers'] };
  }

  if (false) {
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

  return null;
}

export function parseUserAnswerToFormState(
  configKey: string,
  userText: string,
  canonicalPlanningTypeLabel: (label: string) => string
): Partial<{
  quickCapacityCounts: Record<string, string>;
  quickCapacityCreationMode: '' | 'manual' | 'ai-assisted' | 'full-ai';
  quickDateYear: string;
  quickDateMonth: string;
  quickDateDay: string;
  selectedQuickOptions: string[];
  quickPickPrimaryStyles: string[];
  quickPickSecondaryModifiers: string[];
  quickCustomizeMode: boolean;
  quickCustomizeText: string;
  quickPlatformContentTypes: Record<string, string[]>;
}> {
  const t = (userText || '').trim();
  const out: Record<string, any> = {};
  if (configKey === 'content_capacity' || configKey === 'available_content') {
    const counts: Record<string, string> = {};
    const labelToKey: [RegExp, string][] = [
      [/\b(\d{1,3})\s*(?:posts?|feed\s*posts?|text\s*posts?)(?:\s*\/\s*week)?\b/i, 'Text posts'],
      [/\b(\d{1,3})\s*videos?(?:\s*\/\s*week)?\b/i, 'Videos'],
      [/\b(\d{1,3})\s*reels?(?:\s*\/\s*week)?\b/i, 'Reels'],
      [/\b(\d{1,3})\s*shorts?(?:\s*\/\s*week)?\b/i, 'Shorts'],
      [/\b(\d{1,3})\s*long\s*videos?(?:\s*\/\s*week)?\b/i, 'Long Videos'],
      [/\b(\d{1,3})\s*blogs?(?:\s*\/\s*week)?\b/i, 'Blogs'],
      [/\b(\d{1,3})\s*articles?(?:\s*\/\s*week)?\b/i, 'Articles'],
      [/\b(\d{1,3})\s*white\s*papers?(?:\s*\/\s*week)?\b/i, 'White Papers'],
      [/\b(\d{1,3})\s*carousels?(?:\s*\/\s*week)?\b/i, 'Carousels'],
      [/\b(\d{1,3})\s*images?(?:\s*\/\s*week)?\b/i, 'Images'],
      [/\b(\d{1,3})\s*stories?(?:\s*\/\s*week)?\b/i, 'Stories'],
      [/\b(\d{1,3})\s*threads?(?:\s*\/\s*week)?\b/i, 'Threads'],
    ];
    for (const [re, label] of labelToKey) {
      const m = t.match(re);
      if (m && m[1]) counts[label] = String(parseInt(m[1], 10));
    }
    if (Object.keys(counts).length > 0) out.quickCapacityCounts = counts;
    if (configKey === 'content_capacity') {
      if (/\bcreation:\s*manual\b/i.test(t)) out.quickCapacityCreationMode = 'manual';
      else if (/\bcreation:\s*(?:ai-?assisted|AI-?assisted)\b/i.test(t)) out.quickCapacityCreationMode = 'ai-assisted';
      else if (/\bcreation:\s*(?:full\s*AI|full\s*ai)\b/i.test(t)) out.quickCapacityCreationMode = 'full-ai';
    }
  } else if (configKey === 'tentative_start') {
    const dateMatch = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (dateMatch) {
      out.quickDateYear = dateMatch[1];
      out.quickDateMonth = String(parseInt(dateMatch[2], 10));
      out.quickDateDay = String(parseInt(dateMatch[3], 10));
    }
  } else if (configKey === 'platforms') {
    const platformKeys = ['linkedin', 'instagram', 'facebook', 'twitter', 'x', 'youtube', 'tiktok', 'threads'];
    const lower = t.toLowerCase();
    const found = platformKeys.filter((p) => (p === 'x' ? /\bx\b|twitter/.test(lower) : lower.includes(p)));
    if (found.length > 0) out.selectedQuickOptions = found;
  } else if (configKey === 'campaign_duration') {
    const weeksMatch = t.match(/(\d+)\s*weeks?/i) ?? t.match(/(\d+)/);
    if (weeksMatch) {
      out.quickCustomizeMode = true;
      out.quickCustomizeText = weeksMatch[0];
    } else {
      const opts = ['4 weeks', '6 weeks', '8 weeks', '12 weeks'];
      const found = opts.find((o) => t.toLowerCase().includes(o));
      if (found) out.selectedQuickOptions = [found];
    }
  } else if (configKey === 'communication_style') {
    const primaryMatch = t.match(/primary:\s*([^.]+)/i);
    const secondaryMatch = t.match(/secondary:\s*([^.]+)/i);
    if (primaryMatch) out.quickPickPrimaryStyles = primaryMatch[1].split(/[,;]/).map((p) => p.trim()).filter(Boolean);
    if (secondaryMatch) out.quickPickSecondaryModifiers = secondaryMatch[1].split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  } else if (configKey === 'action_expectation') {
    const primaryMatch = t.match(/primary\s*intent:\s*([^.]+)/i);
    const actionsMatch = t.match(/actions?:\s*([^.]+)/i);
    if (primaryMatch) out.quickPickPrimaryStyles = primaryMatch[1].split(/[,;]/).map((p) => p.trim()).filter(Boolean);
    if (actionsMatch) out.quickPickSecondaryModifiers = actionsMatch[1].split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  } else if (configKey === 'target_audience' || configKey === 'content_depth' || configKey === 'topic_continuity' || configKey === 'campaign_types' || configKey === 'success_metrics') {
    const parts = t.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) out.selectedQuickOptions = parts;
  } else if (configKey === 'cross_platform_sharing') {
    const lower = t.toLowerCase();
    if (/\bshared\b|same content across|same across all/.test(lower) || (lower.includes('shared') && !lower.includes('unique'))) {
      out.selectedQuickOptions = ['Shared (same content across all platforms)'];
    } else if (/\bunique\b|different content per|unique per platform|each platform/.test(lower) || (lower.includes('unique') && !lower.includes('shared'))) {
      out.selectedQuickOptions = ['Unique (different content per platform)'];
    }
  } else if (configKey === 'platform_content_types') {
    const platformParts = t.split(';').map((p) => p.trim()).filter(Boolean);
    const byPlatform: Record<string, string[]> = {};
    for (const part of platformParts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx > 0) {
        const platform = part.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, '');
        const rawTypes = part.slice(colonIdx + 1).split(',').map((x) => x.trim()).filter(Boolean);
        const types = rawTypes.map((x) => canonicalPlanningTypeLabel(x) || x);
        if (platform && types.length) byPlatform[platform] = types;
      }
    }
    if (Object.keys(byPlatform).length > 0) out.quickPlatformContentTypes = byPlatform;
  }
  return out;
}
