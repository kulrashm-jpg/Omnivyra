/**
 * POST /api/bolt/strategy-cards
 *
 * Generates 3 BOLT (Text) campaign strategy card options for the user to pick from.
 * Each card represents a distinct campaign angle / weekly-theme set.
 *
 * Body: { companyId, topic, goal?, audience?, contentFormat?, duration?, themeSource? }
 * Response: { cards: BoltStrategyCard[] }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { generateRichThemesForCampaignWeeks } from '../../../backend/services/strategicThemeEngine';
import { generateThemeFromTopic } from '../../../backend/services/themeAngleEngine';

export interface BoltStrategyCard {
  id: string;
  title: string;
  angle: string;
  summary: string;
  contentFocus: string;
  phaseLabels: string[];
  weekThemes: Array<{ week: number; title: string; phase_label?: string; objective?: string; content_focus?: string; cta_focus?: string }>;
  contentFormat: string;
  duration: number;
  targetAudience: string;
  campaignGoal: string;       // joined string (backward compat)
  campaignGoals: string[];    // individual goals array
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, topic, goal, goals: goalsRaw, audience, strategicFocus, offerings, contentFormat, duration } = req.body || {};

    // Resolve goals: accept array (new) or string (legacy), always produce string[]
    const goalsArray: string[] = Array.isArray(goalsRaw) && goalsRaw.length > 0
      ? (goalsRaw as string[]).filter((g) => typeof g === 'string' && g.trim())
      : typeof goal === 'string' && goal.trim()
        ? [goal.trim()]
        : [];
    const combinedGoalStr = goalsArray.join(' + ');

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return res.status(400).json({ error: 'topic is required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim(), requireCampaignId: false });
    if (!access) return;

    const weeks = Math.max(1, Math.min(12, Number(duration) || 4));
    const cleanTopic = topic.trim();

    // ── Compact topic label for template substitution.
    // Templates insert {topic} verbatim — a long, question-like, or preamble topic
    // produces unreadable titles like "What Teams Get Wrong About To Assist You".
    // Strategy:
    //  0. Strip AI clarification preambles ("To assist you, could you clarify your X").
    //  0b. Strip infinitive openers ("To improve our X" → "our X" → strip "our" → "X").
    //  1. Extract a quoted phrase if present (often the real campaign title).
    //  2. Stop at the first clause-break comma/conjunction.
    //  3. Hard-cap at 45 chars on a word boundary.
    function compactTopic(t: string): string {
      let s = t.trim();

      // 0. Strip AI clarification preambles with an extractable topic after them.
      //    e.g. "To better assist you, could you clarify your SaaS launch?" → "SaaS launch"
      const aiPreamble = s.match(
        /^(?:to\s+[\w\s]{2,25}you[,.]?\s+)?could\s+you\s+(?:please\s+)?(?:clarify|specify|describe|explain|provide|share)\s+(?:your|the|a\s+)?([\w\s,''"-]{4,})/i
      );
      if (aiPreamble?.[1]) {
        const extracted = aiPreamble[1].replace(/[?!.]+$/, '').trim();
        if (extracted.length >= 4) s = extracted;
      }

      // 0b. Strip leading infinitive + pronoun clause ("To [verb] you/me/us, rest")
      const infPronoun = s.match(/^To\s+\w+\s+(?:you|me|us|them)[,.:]\s+(.+)/i);
      if (infPronoun?.[1] && infPronoun[1].length >= 4) s = infPronoun[1];

      // 0c. Strip bare infinitive opener ("To [verb] [some words],")
      //     leaving the meaningful noun phrase that follows
      //     e.g. "To improve our SaaS pipeline" → "our SaaS pipeline" → strip "our" → "SaaS pipeline"
      const infOpener = s.match(/^To\s+\w+\s+([\w\s,''"-]{4,})/i);
      if (infOpener?.[1] && infOpener[1].length >= 4 && !aiPreamble) {
        const rest = infOpener[1].replace(/^(?:our|your|my|their|the|a|an)\s+/i, '').trim();
        if (rest.length >= 4) s = rest;
      }

      // If after stripping the string still starts like a question, it had no real topic.
      // Derive a fallback from goals / audience rather than produce garbage titles.
      if (/^(could|can|would|should)\s+you\b|^clarify\b/i.test(s) || s.length < 4) {
        s = t.trim(); // revert — handled below via effectiveTopic fallback
      }

      // 1. Quoted phrase extraction (handles ' " " ' delimiters)
      const quotedMatch = s.match(/['"'\u2018\u2019\u201C\u201D]([^\u2018\u2019\u201C\u201D'"]{5,80})['"'\u2018\u2019\u201C\u201D]/);
      if (quotedMatch?.[1]) {
        const q = quotedMatch[1].split(':')[0].split('—')[0].trim();
        if (q.length >= 5) return q.length <= 45 ? q : (() => { const c = q.slice(0, 45); const ls2 = c.lastIndexOf(' '); return ls2 > 5 ? c.slice(0, ls2) : c; })();
      }
      // 2. Stop before clause-break signals
      const clauseBreak = s.search(/,\s*(consider|including|focusing|this could|this includes|which|where|among|for the|for all)/i);
      const base = clauseBreak > 10 ? s.slice(0, clauseBreak).trim() : s;
      // 3. Hard cap at 45 chars on a word boundary
      if (base.length <= 45) return base;
      const cut = base.slice(0, 45);
      const ls = cut.lastIndexOf(' ');
      return (ls > 10 ? cut.slice(0, ls) : cut).replace(/[,;:]+$/, '').trim();
    }

    // Detect if a compacted topic is still a question / fragment — not usable in templates.
    function looksLikeQuestionOrFragment(t: string): boolean {
      return (
        /^(to\s+\w+\s+(you|me|us)|could\s+you|can\s+you|would\s+you|should\s+you|please\s+clarify)/i.test(t) ||
        /could\s+you\s+clarify/i.test(t) ||
        t.length < 4
      );
    }

    const titleTopic = (() => {
      const compact = compactTopic(cleanTopic);
      if (!looksLikeQuestionOrFragment(compact)) return compact;
      // Fallback: derive a readable noun phrase from goals + audience
      if (goalsArray.length > 0 && typeof audience === 'string' && audience.trim()) {
        return `${goalsArray[0]} for ${audience.trim().split(',')[0].trim()}`;
      }
      if (goalsArray.length > 0) return goalsArray[0];
      return 'Your Campaign';
    })();

    // ── Week themes use the compact topic — NOT the full/enriched string.
    // Passing a long topic into the angle templates causes it to appear
    // verbatim in every week title, making card header and arc indistinguishable.
    const [setA, setB, setC] = await Promise.all([
      generateRichThemesForCampaignWeeks(titleTopic, weeks),
      generateRichThemesForCampaignWeeks(titleTopic, weeks),
      generateRichThemesForCampaignWeeks(titleTopic, weeks),
    ]);

    // ── 3 distinct card-level headlines from different editorial angle seeds.
    // Seed offsets (0, 3, 6) select different entries in the 6-angle wheel so
    // each card presents a genuinely different strategic framing of the topic.
    const cardTitles = [0, 3, 5].map((seed) =>
      generateThemeFromTopic(titleTopic, undefined, seed)
    );

    // ── Phase metadata lookup (mirrors PHASE_METADATA in strategicThemeEngine)
    const PHASE_META: Record<string, { objective: string; content_focus: string; cta: string }> = {
      Awareness:   { objective: 'Build brand visibility and introduce your topic to a new audience',   content_focus: 'Educational content, industry insights, thought leadership',   cta: 'Follow · Subscribe' },
      Education:   { objective: 'Establish authority and teach your audience key concepts',             content_focus: 'How-to guides, frameworks, deep-dives',                          cta: 'Save · Share' },
      Problem:     { objective: 'Amplify pain points and spark recognition in your audience',           content_focus: 'Pain point stories, misconception-busting content',              cta: 'Comment · Engage' },
      Solution:    { objective: 'Position your offering as the clear answer to the problem',            content_focus: 'Solution reveals, product walkthroughs, comparisons',            cta: 'Learn More · Sign Up' },
      Proof:       { objective: 'Build trust through evidence, results, and social proof',              content_focus: 'Case studies, testimonials, data results',                       cta: 'Book a Call · Start Trial' },
      Conversion:  { objective: 'Drive decisive action and close the consideration loop',               content_focus: 'Offers, urgency plays, objection handling',                      cta: 'Buy Now · Schedule Demo' },
    };

    function buildCard(themes: typeof setA, idx: number): BoltStrategyCard {
      const phaseLabels = themes.map((t) => t.phase_label ?? '').filter(Boolean);
      const uniquePhases = Array.from(new Set(phaseLabels));

      // card title: a short editorial headline distinct from any week title
      const title = cardTitles[idx] ?? generateThemeFromTopic(titleTopic, undefined, idx * 2);

      // angle: the arc progression shown as a brief label
      const angle = uniquePhases.slice(0, 4).join(' → ') || cleanTopic;

      // summary: campaign-level arc overview — describes the WHOLE journey,
      // not just week 1. E.g. "A 4-week arc from Awareness to Conversion:
      // build visibility, establish authority, tackle objections, drive action."
      const arcDesc = uniquePhases
        .slice(0, 4)
        .map((phase) => PHASE_META[phase]?.objective ?? phase)
        .join('; ');
      const summary = arcDesc
        ? `${weeks}-week arc: ${arcDesc}.`
        : `A ${weeks}-week campaign focused on ${cleanTopic}.`;

      return {
        id: `card-${idx}`,
        title,
        angle,
        summary,
        contentFocus: themes.map((t) => t.title).join(' → '),
        phaseLabels: uniquePhases.slice(0, 4),
        weekThemes: themes,
        contentFormat: typeof contentFormat === 'string' ? contentFormat : 'post',
        duration: weeks,
        targetAudience: typeof audience === 'string' ? audience : '',
        campaignGoal: combinedGoalStr,
        campaignGoals: goalsArray,
      };
    }

    const cards: BoltStrategyCard[] = [
      buildCard(setA, 0),
      buildCard(setB, 1),
      buildCard(setC, 2),
    ];

    return res.status(200).json({ cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
