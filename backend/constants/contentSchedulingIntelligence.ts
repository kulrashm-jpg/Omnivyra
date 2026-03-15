/**
 * Research-based optimal posting windows per platform × content type.
 *
 * Scores are 0-100. Day/time data is derived from aggregated social media
 * engagement studies (Sprout Social, HubSpot, Buffer research, 2022-2024).
 *
 * Used by intelligentSlotScheduler as the deterministic baseline before
 * LLM holiday/cultural adjustments are applied.
 */

export type DayWindow = {
  day: string;        // 'Monday' … 'Sunday'
  score: number;      // 0-100 engagement score
  optimalTime: string; // 'HH:MM' local time
  rationale: string;
};

export type PlatformContentTypeSchedule = {
  platform: string;
  contentType: string;
  windows: DayWindow[];  // Sorted score desc
  /** Content types that require creator pre-production — avoid Monday (tight weekend turnaround) */
  avoidDays?: string[];
  /**
   * 'avoid'  — don't publish on/day-before a major holiday
   * 'boost'  — holidays increase relevance (e.g. seasonal carousel)
   * 'neutral' — holiday doesn't affect performance
   */
  holidayBehavior: 'avoid' | 'boost' | 'neutral';
  engagementPeakNote: string;
};

/** Lookup key: `${platform}:${contentType}` */
const SCHEDULES: PlatformContentTypeSchedule[] = [
  // ─── LinkedIn ─────────────────────────────────────────────
  {
    platform: 'linkedin', contentType: 'post',
    windows: [
      { day: 'Tuesday',   score: 95, optimalTime: '09:00', rationale: 'Professional mindset peak; decision-makers most active before 10am' },
      { day: 'Wednesday', score: 92, optimalTime: '09:00', rationale: 'Mid-week high attention; top B2B engagement window' },
      { day: 'Thursday',  score: 88, optimalTime: '10:00', rationale: 'Strong professional engagement before end-of-week distractions' },
      { day: 'Monday',    score: 75, optimalTime: '08:00', rationale: 'Week-start mindset; catch early planners' },
      { day: 'Friday',    score: 62, optimalTime: '09:00', rationale: 'Declining attention but still usable; avoid afternoon' },
      { day: 'Saturday',  score: 30, optimalTime: '10:00', rationale: 'Low professional activity; only for thought leadership' },
      { day: 'Sunday',    score: 20, optimalTime: '20:00', rationale: 'Minimal; some pre-week catch-up reading' },
    ],
    holidayBehavior: 'avoid',
    engagementPeakNote: 'Tue–Thu 8–10am local time. Avoid Friday afternoon and weekends.',
  },
  {
    platform: 'linkedin', contentType: 'article',
    windows: [
      { day: 'Tuesday',   score: 92, optimalTime: '10:00', rationale: 'Long reads consumed after morning stand-ups; peak professional scroll' },
      { day: 'Wednesday', score: 88, optimalTime: '12:00', rationale: 'Lunch-break reading window; mid-week focus' },
      { day: 'Thursday',  score: 80, optimalTime: '09:00', rationale: 'Thought leadership performs well before week closes' },
      { day: 'Monday',    score: 65, optimalTime: '10:00', rationale: 'Moderate; professionals catching up on industry news' },
      { day: 'Friday',    score: 45, optimalTime: '09:00', rationale: 'Lower; people are wrapping week, not reading long form' },
      { day: 'Saturday',  score: 25, optimalTime: '11:00', rationale: 'Casual readers only' },
      { day: 'Sunday',    score: 20, optimalTime: '11:00', rationale: 'Very low professional audience' },
    ],
    avoidDays: ['Monday'],
    holidayBehavior: 'avoid',
    engagementPeakNote: 'Tue 10am or Wed 12pm. Long-form needs uninterrupted reading time.',
  },
  {
    platform: 'linkedin', contentType: 'video',
    windows: [
      { day: 'Wednesday', score: 90, optimalTime: '09:00', rationale: 'Mid-week video content peaks; LinkedIn algorithm favors native video mid-week' },
      { day: 'Tuesday',   score: 85, optimalTime: '10:00', rationale: 'High professional engagement window' },
      { day: 'Thursday',  score: 80, optimalTime: '09:00', rationale: 'Good visibility before end-of-week drop' },
      { day: 'Monday',    score: 60, optimalTime: '09:00', rationale: 'Acceptable; commuters may watch' },
      { day: 'Friday',    score: 40, optimalTime: '09:00', rationale: 'Avoid; attention is fragmented' },
      { day: 'Saturday',  score: 20, optimalTime: '11:00', rationale: 'Very low B2B' },
      { day: 'Sunday',    score: 15, optimalTime: '11:00', rationale: 'Minimal' },
    ],
    avoidDays: ['Friday', 'Saturday', 'Sunday'],
    holidayBehavior: 'avoid',
    engagementPeakNote: 'Wed–Tue 9–10am. Native video gets 5× organic reach vs external links.',
  },
  {
    platform: 'linkedin', contentType: 'carousel',
    windows: [
      { day: 'Tuesday',   score: 93, optimalTime: '09:00', rationale: 'Carousel swipes peak Tue–Wed; document posts rank highly in feed' },
      { day: 'Wednesday', score: 90, optimalTime: '10:00', rationale: 'Peak carousel engagement day on LinkedIn' },
      { day: 'Thursday',  score: 82, optimalTime: '09:00', rationale: 'Strong mid-late week for educational carousels' },
      { day: 'Monday',    score: 65, optimalTime: '08:00', rationale: 'Moderate; works for motivational carousels' },
      { day: 'Friday',    score: 45, optimalTime: '09:00', rationale: 'Lower engagement; avoid unless time-sensitive' },
      { day: 'Saturday',  score: 25, optimalTime: '10:00', rationale: 'Low' },
      { day: 'Sunday',    score: 18, optimalTime: '10:00', rationale: 'Very low' },
    ],
    holidayBehavior: 'neutral',
    engagementPeakNote: 'Carousel/document posts get 3× more reach. Tue–Wed morning.',
  },
  {
    platform: 'linkedin', contentType: 'newsletter',
    windows: [
      { day: 'Tuesday',   score: 90, optimalTime: '08:00', rationale: 'Email newsletters opened highest Tue morning; professionals check inboxes before 9am' },
      { day: 'Wednesday', score: 85, optimalTime: '08:00', rationale: 'Second-best newsletter open day' },
      { day: 'Thursday',  score: 72, optimalTime: '08:00', rationale: 'Good for end-of-week digest formats' },
      { day: 'Monday',    score: 60, optimalTime: '07:00', rationale: 'Works for weekly planning newsletters' },
      { day: 'Friday',    score: 40, optimalTime: '08:00', rationale: 'Low open rate; people are heads-down finishing week' },
      { day: 'Saturday',  score: 15, optimalTime: '10:00', rationale: 'Very low professional open rate' },
      { day: 'Sunday',    score: 20, optimalTime: '09:00', rationale: 'Pre-week planners; works for Sunday prep newsletters' },
    ],
    holidayBehavior: 'avoid',
    engagementPeakNote: 'Tuesday 8am is the gold standard for B2B newsletters.',
  },

  // ─── Instagram ────────────────────────────────────────────
  {
    platform: 'instagram', contentType: 'post',
    windows: [
      { day: 'Wednesday', score: 95, optimalTime: '11:00', rationale: 'Highest Instagram engagement globally; mid-morning scroll peak' },
      { day: 'Thursday',  score: 90, optimalTime: '11:00', rationale: 'Consistent top-3 engagement day' },
      { day: 'Friday',    score: 88, optimalTime: '10:00', rationale: 'Pre-weekend browsing surge; lifestyle content peaks' },
      { day: 'Tuesday',   score: 82, optimalTime: '11:00', rationale: 'Strong engagement for brand content' },
      { day: 'Monday',    score: 75, optimalTime: '12:00', rationale: 'Lunch browse spike; good for motivational content' },
      { day: 'Saturday',  score: 70, optimalTime: '10:00', rationale: 'Good for lifestyle, food, consumer brands' },
      { day: 'Sunday',    score: 60, optimalTime: '11:00', rationale: 'Leisure browsing; softer content performs better' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Wed–Fri 10am–1pm. Lifestyle/consumer brands do well weekends too.',
  },
  {
    platform: 'instagram', contentType: 'reel',
    windows: [
      { day: 'Tuesday',   score: 95, optimalTime: '09:00', rationale: 'Reels algorithm pushes early-week content for mid-week discovery peak' },
      { day: 'Thursday',  score: 92, optimalTime: '12:00', rationale: 'Reels consume peak at lunch; algorithm rewards Thu posts' },
      { day: 'Friday',    score: 90, optimalTime: '17:00', rationale: 'End-of-week entertainment browsing; reels get high views' },
      { day: 'Wednesday', score: 85, optimalTime: '10:00', rationale: 'Good mid-week reel slot' },
      { day: 'Saturday',  score: 80, optimalTime: '11:00', rationale: 'Weekend leisure viewing spikes for reels' },
      { day: 'Sunday',    score: 72, optimalTime: '13:00', rationale: 'Afternoon viewing; works for entertainment content' },
      { day: 'Monday',    score: 65, optimalTime: '09:00', rationale: 'Lower but usable; motivational content works' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Reels get 22% more interactions than standard videos. Tue/Thu/Fri peak.',
  },
  {
    platform: 'instagram', contentType: 'carousel',
    windows: [
      { day: 'Wednesday', score: 94, optimalTime: '11:00', rationale: 'Educational carousels save rate peaks mid-week' },
      { day: 'Monday',    score: 88, optimalTime: '12:00', rationale: 'Week-start motivation carousels perform very well' },
      { day: 'Thursday',  score: 85, optimalTime: '10:00', rationale: 'Strong engagement; people save how-to content Thu' },
      { day: 'Friday',    score: 80, optimalTime: '11:00', rationale: 'Pre-weekend planning content; tips/guides work well' },
      { day: 'Tuesday',   score: 78, optimalTime: '11:00', rationale: 'Consistent mid-week engagement' },
      { day: 'Saturday',  score: 65, optimalTime: '10:00', rationale: 'Lifestyle carousels perform on weekends' },
      { day: 'Sunday',    score: 55, optimalTime: '12:00', rationale: 'Moderate; inspiration content works' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Carousels get 3× saves vs single images. Mon/Wed 11am–12pm.',
  },
  {
    platform: 'instagram', contentType: 'story',
    windows: [
      { day: 'Friday',    score: 95, optimalTime: '17:00', rationale: 'Story views peak Friday evening; high swipe-up rates' },
      { day: 'Thursday',  score: 88, optimalTime: '16:00', rationale: 'Strong afternoon story engagement' },
      { day: 'Wednesday', score: 85, optimalTime: '12:00', rationale: 'Mid-week stories get consistent views' },
      { day: 'Saturday',  score: 82, optimalTime: '11:00', rationale: 'Weekend storytelling; casual content works great' },
      { day: 'Tuesday',   score: 75, optimalTime: '17:00', rationale: 'After-work story browsing' },
      { day: 'Monday',    score: 70, optimalTime: '18:00', rationale: 'Evening story catch-up after Monday work day' },
      { day: 'Sunday',    score: 65, optimalTime: '19:00', rationale: 'Sunday evening relaxation browsing' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Stories need real-time feel. Thu–Fri afternoon/evening is peak.',
  },
  {
    platform: 'instagram', contentType: 'video',
    windows: [
      { day: 'Thursday',  score: 92, optimalTime: '12:00', rationale: 'Native video lunch-scroll peak' },
      { day: 'Tuesday',   score: 88, optimalTime: '09:00', rationale: 'Morning video engagement before day starts' },
      { day: 'Friday',    score: 85, optimalTime: '10:00', rationale: 'Pre-weekend; entertainment content high views' },
      { day: 'Wednesday', score: 82, optimalTime: '11:00', rationale: 'Consistent mid-week video performance' },
      { day: 'Saturday',  score: 78, optimalTime: '14:00', rationale: 'Weekend leisure; long-form video performs well' },
      { day: 'Monday',    score: 65, optimalTime: '12:00', rationale: 'Moderate; lunch break viewing' },
      { day: 'Sunday',    score: 60, optimalTime: '15:00', rationale: 'Afternoon leisure viewing' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Thu 12pm and Tue 9am are the Instagram video sweet spots.',
  },

  // ─── TikTok ───────────────────────────────────────────────
  {
    platform: 'tiktok', contentType: 'video',
    windows: [
      { day: 'Tuesday',   score: 95, optimalTime: '19:00', rationale: 'For You page algorithm pushes content posted Tue evening; peak discovery' },
      { day: 'Thursday',  score: 93, optimalTime: '19:00', rationale: 'TikTok views peak Thu 7-9pm; strong algorithm window' },
      { day: 'Friday',    score: 90, optimalTime: '17:00', rationale: 'TGIF browsing surge; entertainment peaks Friday evening' },
      { day: 'Saturday',  score: 88, optimalTime: '11:00', rationale: 'Weekend leisure viewing is highest for TikTok' },
      { day: 'Wednesday', score: 82, optimalTime: '07:00', rationale: 'Early morning content gets fed through the day' },
      { day: 'Sunday',    score: 78, optimalTime: '16:00', rationale: 'Sunday afternoon binge session' },
      { day: 'Monday',    score: 70, optimalTime: '19:00', rationale: 'After-work content; moderate engagement' },
    ],
    avoidDays: ['Monday'],
    holidayBehavior: 'boost',
    engagementPeakNote: 'TikTok is most active Tue/Thu 7-9pm and weekends. Early morning posts get full-day exposure.',
  },
  {
    platform: 'tiktok', contentType: 'reel',
    windows: [
      { day: 'Tuesday',   score: 94, optimalTime: '19:00', rationale: 'Reels on TikTok (short-form) peak Tue evening' },
      { day: 'Friday',    score: 92, optimalTime: '18:00', rationale: 'End-of-week entertainment surge' },
      { day: 'Saturday',  score: 90, optimalTime: '12:00', rationale: 'Peak weekend leisure time' },
      { day: 'Thursday',  score: 88, optimalTime: '20:00', rationale: 'Pre-weekend energy builds Thu night' },
      { day: 'Sunday',    score: 75, optimalTime: '15:00', rationale: 'Relaxed afternoon browsing' },
      { day: 'Wednesday', score: 70, optimalTime: '07:00', rationale: 'Morning post for all-day exposure' },
      { day: 'Monday',    score: 60, optimalTime: '18:00', rationale: 'After work; lower than rest of week' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Tue/Fri evening and weekends dominate TikTok reel performance.',
  },
  {
    platform: 'tiktok', contentType: 'short',
    windows: [
      { day: 'Thursday',  score: 95, optimalTime: '19:00', rationale: 'Short-form video peak Thu evening for TikTok' },
      { day: 'Tuesday',   score: 92, optimalTime: '19:00', rationale: 'Consistent top performer' },
      { day: 'Saturday',  score: 90, optimalTime: '11:00', rationale: 'Weekend binge session' },
      { day: 'Friday',    score: 88, optimalTime: '17:00', rationale: 'TGIF early evening' },
      { day: 'Sunday',    score: 75, optimalTime: '14:00', rationale: 'Afternoon relaxation' },
      { day: 'Wednesday', score: 68, optimalTime: '07:00', rationale: 'Morning; all-day exposure' },
      { day: 'Monday',    score: 55, optimalTime: '18:00', rationale: 'Lowest of the week' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Thu/Tue 7-9pm are TikTok gold for short-form. Weekends strong.',
  },

  // ─── Twitter / X ──────────────────────────────────────────
  {
    platform: 'x', contentType: 'post',
    windows: [
      { day: 'Wednesday', score: 92, optimalTime: '09:00', rationale: 'Peak Twitter/X engagement; news and commentary peak Wed morning' },
      { day: 'Tuesday',   score: 88, optimalTime: '09:00', rationale: 'Second highest; professional conversations peak' },
      { day: 'Thursday',  score: 85, optimalTime: '09:00', rationale: 'Strong for industry commentary and announcements' },
      { day: 'Friday',    score: 80, optimalTime: '09:00', rationale: 'TGIF engagement; works for casual/humorous content' },
      { day: 'Monday',    score: 72, optimalTime: '09:00', rationale: 'Week kick-off; news-oriented content works' },
      { day: 'Saturday',  score: 55, optimalTime: '10:00', rationale: 'Lower professional content; entertainment works' },
      { day: 'Sunday',    score: 45, optimalTime: '10:00', rationale: 'Lowest engagement day overall' },
    ],
    holidayBehavior: 'neutral',
    engagementPeakNote: 'Wed–Thu 9am–3pm. Twitter is always-on; breaking news gets extra boost.',
  },
  {
    platform: 'x', contentType: 'thread',
    windows: [
      { day: 'Tuesday',   score: 94, optimalTime: '10:00', rationale: 'Threads get highest save/bookmark rates Tue; readers have time to engage' },
      { day: 'Wednesday', score: 90, optimalTime: '09:00', rationale: 'Educational threads peak mid-week when professionals research' },
      { day: 'Thursday',  score: 82, optimalTime: '10:00', rationale: 'Strong for end-of-week summaries and insights' },
      { day: 'Monday',    score: 75, optimalTime: '09:00', rationale: 'Week-start "learn something new" motivation' },
      { day: 'Friday',    score: 60, optimalTime: '09:00', rationale: 'Lower; people read but don\'t engage as deeply' },
      { day: 'Saturday',  score: 40, optimalTime: '10:00', rationale: 'Low professional audience' },
      { day: 'Sunday',    score: 35, optimalTime: '11:00', rationale: 'Minimal; casual audience only' },
    ],
    holidayBehavior: 'avoid',
    engagementPeakNote: 'Tue–Wed morning for threads. They need uninterrupted reading time.',
  },
  {
    platform: 'twitter', contentType: 'post',    // canonical alias
    windows: [
      { day: 'Wednesday', score: 92, optimalTime: '09:00', rationale: 'Same as X — peak Twitter engagement mid-week morning' },
      { day: 'Tuesday',   score: 88, optimalTime: '09:00', rationale: 'Strong professional commentary window' },
      { day: 'Thursday',  score: 85, optimalTime: '09:00', rationale: 'Good for announcements and industry insight' },
      { day: 'Friday',    score: 80, optimalTime: '09:00', rationale: 'TGIF casual tone works well' },
      { day: 'Monday',    score: 72, optimalTime: '09:00', rationale: 'News/planning content' },
      { day: 'Saturday',  score: 55, optimalTime: '10:00', rationale: 'Entertainment > professional' },
      { day: 'Sunday',    score: 45, optimalTime: '10:00', rationale: 'Lowest day' },
    ],
    holidayBehavior: 'neutral',
    engagementPeakNote: 'Wed–Thu 9am–3pm peak. Same optimal windows as X.',
  },

  // ─── YouTube ──────────────────────────────────────────────
  {
    platform: 'youtube', contentType: 'video',
    windows: [
      { day: 'Thursday',  score: 95, optimalTime: '14:00', rationale: 'YouTube algorithm favors Thu posts for weekend discovery; publish Thu for max weekend views' },
      { day: 'Friday',    score: 92, optimalTime: '14:00', rationale: 'Pre-weekend publish; people browse YouTube Sat/Sun' },
      { day: 'Saturday',  score: 85, optimalTime: '10:00', rationale: 'Direct weekend viewing; great for tutorial and entertainment content' },
      { day: 'Wednesday', score: 78, optimalTime: '14:00', rationale: 'Good mid-week slot; gets some weekend pickup' },
      { day: 'Sunday',    score: 72, optimalTime: '11:00', rationale: 'Direct Sunday viewing; pre-week content works' },
      { day: 'Tuesday',   score: 65, optimalTime: '14:00', rationale: 'Moderate; content needs stronger hook to compete' },
      { day: 'Monday',    score: 50, optimalTime: '14:00', rationale: 'Lowest YouTube day; most subscribers are busy' },
    ],
    avoidDays: ['Monday', 'Tuesday'],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Publish Thu–Fri 2pm to capture weekend viewing surge. YouTube rewards patience.',
  },
  {
    platform: 'youtube', contentType: 'short',
    windows: [
      { day: 'Friday',    score: 94, optimalTime: '17:00', rationale: 'YouTube Shorts spike Friday evening; discovery feed is most active' },
      { day: 'Saturday',  score: 92, optimalTime: '12:00', rationale: 'Weekend casual viewing for shorts' },
      { day: 'Thursday',  score: 88, optimalTime: '15:00', rationale: 'Pre-weekend momentum for short content' },
      { day: 'Tuesday',   score: 80, optimalTime: '07:00', rationale: 'Early morning shorts get all-day exposure via Shorts feed' },
      { day: 'Wednesday', score: 78, optimalTime: '07:00', rationale: 'Good mid-week exposure' },
      { day: 'Sunday',    score: 75, optimalTime: '13:00', rationale: 'Afternoon relaxation browsing' },
      { day: 'Monday',    score: 60, optimalTime: '07:00', rationale: 'Morning commute; moderate short-form' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Shorts are platform-agnostic in timing — algorithm distributes them. Fri/Sat peak.',
  },

  // ─── Facebook ─────────────────────────────────────────────
  {
    platform: 'facebook', contentType: 'post',
    windows: [
      { day: 'Wednesday', score: 90, optimalTime: '13:00', rationale: 'Facebook engagement peaks Wed 1-3pm; older demographics active post-lunch' },
      { day: 'Thursday',  score: 88, optimalTime: '13:00', rationale: 'Strong community content engagement mid-late week' },
      { day: 'Friday',    score: 85, optimalTime: '13:00', rationale: 'Pre-weekend; casual content and community posts peak' },
      { day: 'Tuesday',   score: 78, optimalTime: '12:00', rationale: 'Good for brand awareness content' },
      { day: 'Saturday',  score: 72, optimalTime: '10:00', rationale: 'Consumer and lifestyle brands perform well weekends' },
      { day: 'Monday',    score: 65, optimalTime: '13:00', rationale: 'Moderate; week-start content competes with news feed refresh' },
      { day: 'Sunday',    score: 55, optimalTime: '12:00', rationale: 'Lower; casual Sunday audience' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Wed–Fri 1-3pm for community and brand content. Weekends for consumer brands.',
  },
  {
    platform: 'facebook', contentType: 'video',
    windows: [
      { day: 'Friday',    score: 92, optimalTime: '15:00', rationale: 'Facebook video views highest Fri afternoon; pre-weekend entertainment' },
      { day: 'Saturday',  score: 88, optimalTime: '12:00', rationale: 'Weekend leisure; Facebook Watch gets peak traffic' },
      { day: 'Thursday',  score: 82, optimalTime: '14:00', rationale: 'Good mid-late week video engagement' },
      { day: 'Wednesday', score: 78, optimalTime: '13:00', rationale: 'Lunch-break video watching' },
      { day: 'Sunday',    score: 70, optimalTime: '14:00', rationale: 'Afternoon relaxation viewing' },
      { day: 'Tuesday',   score: 65, optimalTime: '13:00', rationale: 'Moderate; still worth using for video content' },
      { day: 'Monday',    score: 50, optimalTime: '13:00', rationale: 'Lowest; avoid for primary video releases' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Fri–Sat for Facebook video. Native video gets 3× more reach than links.',
  },

  // ─── Reddit ───────────────────────────────────────────────
  {
    platform: 'reddit', contentType: 'post',
    windows: [
      { day: 'Monday',    score: 90, optimalTime: '09:00', rationale: 'Reddit peaks Mon–Tue morning; users catch up on community discussions after weekend' },
      { day: 'Tuesday',   score: 88, optimalTime: '10:00', rationale: 'Strong community engagement; AMA and discussion posts do well' },
      { day: 'Wednesday', score: 82, optimalTime: '10:00', rationale: 'Consistent mid-week Reddit engagement' },
      { day: 'Thursday',  score: 78, optimalTime: '10:00', rationale: 'Good for niche community content' },
      { day: 'Friday',    score: 65, optimalTime: '10:00', rationale: 'Declining engagement as users wind down' },
      { day: 'Saturday',  score: 55, optimalTime: '12:00', rationale: 'Lower; more casual browsing less discussion' },
      { day: 'Sunday',    score: 50, optimalTime: '14:00', rationale: 'Lowest engagement; avoid for important posts' },
    ],
    holidayBehavior: 'neutral',
    engagementPeakNote: 'Mon–Tue 9-10am. Reddit users are most active on weekday mornings.',
  },

  // ─── Pinterest ────────────────────────────────────────────
  {
    platform: 'pinterest', contentType: 'post',
    windows: [
      { day: 'Saturday',  score: 95, optimalTime: '20:00', rationale: 'Pinterest peaks Sat evening; users plan weekends and save inspiration' },
      { day: 'Sunday',    score: 92, optimalTime: '20:00', rationale: 'Pre-week planning and inspiration browsing' },
      { day: 'Friday',    score: 85, optimalTime: '21:00', rationale: 'Friday evening inspiration browsing' },
      { day: 'Monday',    score: 78, optimalTime: '21:00', rationale: 'Week-start planning; home, food, fashion do well' },
      { day: 'Wednesday', score: 72, optimalTime: '14:00', rationale: 'Mid-week inspiration content' },
      { day: 'Thursday',  score: 68, optimalTime: '20:00', rationale: 'Pre-weekend planning' },
      { day: 'Tuesday',   score: 60, optimalTime: '14:00', rationale: 'Moderate; consistent but not peak' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Pinterest is evening/weekend platform. Sat–Sun 8-10pm and weekday evenings.',
  },
  {
    platform: 'pinterest', contentType: 'carousel',
    windows: [
      { day: 'Saturday',  score: 95, optimalTime: '20:00', rationale: 'Idea Pins (carousel) peak weekends; planning season content' },
      { day: 'Sunday',    score: 90, optimalTime: '19:00', rationale: 'Strong Sunday planning and inspiration' },
      { day: 'Friday',    score: 82, optimalTime: '20:00', rationale: 'Pre-weekend inspiration' },
      { day: 'Monday',    score: 75, optimalTime: '20:00', rationale: 'Week-start planning content' },
      { day: 'Wednesday', score: 65, optimalTime: '14:00', rationale: 'Mid-week moderate' },
      { day: 'Thursday',  score: 60, optimalTime: '19:00', rationale: 'Decent; pre-weekend' },
      { day: 'Tuesday',   score: 55, optimalTime: '14:00', rationale: 'Lowest mid-week for Pinterest' },
    ],
    holidayBehavior: 'boost',
    engagementPeakNote: 'Same as Pinterest posts — weekends and evenings dominate.',
  },
];

/** Build lookup map keyed by `platform:contentType` */
const scheduleMap = new Map<string, PlatformContentTypeSchedule>();
for (const s of SCHEDULES) {
  scheduleMap.set(`${s.platform}:${s.contentType}`, s);
}

/** Default fallback schedule for unknown platform × content type combinations */
const DEFAULT_WINDOWS: DayWindow[] = [
  { day: 'Tuesday',   score: 85, optimalTime: '10:00', rationale: 'General mid-week engagement peak' },
  { day: 'Wednesday', score: 88, optimalTime: '10:00', rationale: 'Highest general engagement day' },
  { day: 'Thursday',  score: 82, optimalTime: '10:00', rationale: 'Strong mid-week slot' },
  { day: 'Monday',    score: 70, optimalTime: '09:00', rationale: 'Week-start momentum' },
  { day: 'Friday',    score: 65, optimalTime: '09:00', rationale: 'Pre-weekend; moderate' },
  { day: 'Saturday',  score: 45, optimalTime: '11:00', rationale: 'Consumer brands; lower B2B' },
  { day: 'Sunday',    score: 35, optimalTime: '11:00', rationale: 'Lowest general engagement' },
];

export function getSchedule(platform: string, contentType: string): PlatformContentTypeSchedule {
  const key = `${platform.toLowerCase()}:${contentType.toLowerCase()}`;
  return (
    scheduleMap.get(key) ??
    scheduleMap.get(`${platform.toLowerCase()}:post`) ?? {
      platform,
      contentType,
      windows: DEFAULT_WINDOWS,
      holidayBehavior: 'neutral' as const,
      engagementPeakNote: 'Use research-based defaults for this platform/content type.',
    }
  );
}

/**
 * Get the top N optimal days for a platform × content type combination,
 * sorted by engagement score descending.
 */
export function getOptimalDays(platform: string, contentType: string, topN = 7): DayWindow[] {
  const schedule = getSchedule(platform, contentType);
  return [...schedule.windows].sort((a, b) => b.score - a.score).slice(0, topN);
}

/**
 * Get the optimal posting time for a given platform × content type × day combination.
 */
export function getOptimalTime(platform: string, contentType: string, day: string): string {
  const schedule = getSchedule(platform, contentType);
  const window = schedule.windows.find((w) => w.day === day);
  return window?.optimalTime ?? '09:00';
}

/**
 * Compact description of all slots for an LLM prompt.
 * Returns a string like "linkedin/post: Tue 09:00 (score 95) — …"
 */
export function describeScheduleForPrompt(platform: string, contentType: string): string {
  const s = getSchedule(platform, contentType);
  const topDays = [...s.windows].sort((a, b) => b.score - a.score).slice(0, 3);
  const dayList = topDays.map((d) => `${d.day} ${d.optimalTime} (score ${d.score})`).join(', ');
  return `${platform}/${contentType}: best days are ${dayList}. ${s.engagementPeakNote}`;
}
