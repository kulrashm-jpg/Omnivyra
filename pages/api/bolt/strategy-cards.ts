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
import {
  refineCampaignTopicForHeadlines,
  refineStrategicCardTitle,
  refineGeneratedText,
} from '../../../backend/services/editorialTextRefinementService';

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
    const {
      companyId, topic, goal, goals: goalsRaw,
      // Campaign Brief — all optional. Older callers won't send these; the
      // generator falls back to topic + goals + audience-only flow.
      description, tone: toneRaw, audienceText: audienceTextRaw,
      audience, strategicFocus, offerings, contentFormat, duration,
    } = req.body || {};

    // Resolve goals: accept array (new) or string (legacy), always produce string[]
    const goalsArray: string[] = Array.isArray(goalsRaw) && goalsRaw.length > 0
      ? (goalsRaw as string[]).filter((g) => typeof g === 'string' && g.trim())
      : typeof goal === 'string' && goal.trim()
        ? [goal.trim()]
        : [];
    const combinedGoalStr = goalsArray.join(' + ');

    // Brief-derived inputs. `audienceText` is the new free-form field; fall
    // back to the legacy `audience` string for callers that haven't migrated.
    const briefDescription = typeof description === 'string' ? description.trim() : '';
    const toneArray: string[] = Array.isArray(toneRaw)
      ? (toneRaw as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : [];
    const resolvedAudience = (typeof audienceTextRaw === 'string' && audienceTextRaw.trim())
      ? audienceTextRaw.trim()
      : (typeof audience === 'string' ? audience.trim() : '');

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
    // Words that must never be the LAST word of a topic fed into a title template
    // ("Why Most Teams Struggle With {topic}") — they leave the sentence hanging.
    // Covers conjunctions, prepositions, articles, auxiliary/linking verbs, and
    // possessives. Compared case-insensitively; trailing punctuation is stripped
    // before the lookup.
    const DANGLING_TRAILING_WORDS = new Set<string>([
      'and','or','but','nor','so','yet','for',
      'of','to','in','on','at','by','with','from','into','onto',
      'about','across','against','along','among','around','before',
      'behind','below','beneath','beside','between','beyond','during',
      'except','inside','near','off','outside','over','past','through',
      'throughout','toward','towards','under','underneath','until','up','upon',
      'the','a','an',
      'is','are','was','were','be','been','being',
      'have','has','had','do','does','did',
      'can','could','will','would','shall','should','may','might','must',
      'my','your','our','their','his','her','its',
    ]);
    function stripDanglingTrailingWords(s: string): string {
      const parts = s.trim().split(/\s+/).filter(Boolean);
      while (parts.length > 1) {
        const last = parts[parts.length - 1]!.replace(/[.,;:!?\-—]+$/, '').toLowerCase();
        if (DANGLING_TRAILING_WORDS.has(last)) {
          parts.pop();
        } else {
          break;
        }
      }
      return parts.join(' ').replace(/[.,;:!?\-—]+$/, '').trim();
    }

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
        if (q.length >= 5) {
          const quoted = q.length <= 45
            ? q
            : (() => { const c = q.slice(0, 45); const ls2 = c.lastIndexOf(' '); return ls2 > 5 ? c.slice(0, ls2) : c; })();
          return stripDanglingTrailingWords(quoted);
        }
      }
      // 1b. Colon-headline collapse. Editorial topics shaped "Hook: Detail"
      //     (e.g. "From Data to Decisions: Transform your marketing") read
      //     as garbage when slotted whole into "The {topic} Myth, Debunked".
      //     Pick the side that's the stronger standalone noun phrase: the
      //     segment with more real words wins; ties favour the left (the
      //     hook is usually the subject). Drops the ": ..." tail entirely
      //     so the result is a clean phrase, not a compound title. Runs
      //     after quoted-phrase extraction so an explicit quote still wins.
      if (s.includes(':')) {
        const segments = s.split(':').map((seg) => seg.trim()).filter(Boolean);
        if (segments.length >= 2) {
          const wc = (seg: string) => seg.split(/\s+/).filter(Boolean).length;
          const best = [...segments].sort((a, b) => wc(b) - wc(a))[0];
          if (best && wc(best) >= 2) s = best;
        }
      }

      // 1c. Strip a leading preposition / dangling connective. A topic that
      //     opens with "From / To / With / For / In / On / At / By / Of /
      //     Into / About" is a sentence fragment, not a noun phrase, and
      //     produces "How to Win With From Data to Decisions". Removing the
      //     opener yields the actual subject ("Data to Decisions").
      const LEADING_PREPOSITION = /^(from|to|with|for|in|on|at|by|of|into|about|toward|towards|via)\s+/i;
      let prepGuard = 0;
      while (LEADING_PREPOSITION.test(s) && prepGuard < 3) {
        s = s.replace(LEADING_PREPOSITION, '').trim();
        prepGuard += 1;
      }
      if (s.length < 4) s = t.trim(); // over-stripped — fallback handles it

      // 2. Stop before clause-break signals
      const clauseBreak = s.search(/,\s*(consider|including|focusing|this could|this includes|which|where|among|for the|for all)/i);
      const base = clauseBreak > 10 ? s.slice(0, clauseBreak).trim() : s;
      // 3. Soft cap at ~45 chars. Cut on a word boundary, strip trailing dangling
      //    words (of/and/to/the/…) so the phrase reads as a complete thought.
      //    If stripping drops the phrase to <2 real words, extend past 45 to the
      //    next word boundary (up to ~70 chars) and try again — better to go a bit
      //    longer than produce titles like "The Future Belongs to Promoting New
      //    Feature Of Creating And".
      if (base.length <= 45) return stripDanglingTrailingWords(base);
      const cut = base.slice(0, 45);
      const ls = cut.lastIndexOf(' ');
      let candidate = ls > 10 ? cut.slice(0, ls) : cut;
      candidate = stripDanglingTrailingWords(candidate);
      if (candidate.split(/\s+/).length < 2) {
        const extendTo = base.indexOf(' ', 45);
        if (extendTo > 0 && extendTo <= 70) {
          candidate = stripDanglingTrailingWords(base.slice(0, extendTo));
        }
        if (candidate.split(/\s+/).length < 2) {
          // Last resort: keep the first three words as-is.
          candidate = base.split(/\s+/).slice(0, 3).join(' ');
        }
      }
      return candidate;
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
      if (!looksLikeQuestionOrFragment(compact)) return refineCampaignTopicForHeadlines(compact);
      // Fallback: derive a readable noun phrase from goals + (new) Brief
      // audience. `resolvedAudience` already prefers the new free-form text
      // over the legacy chip-joined string, so this works either way.
      if (goalsArray.length > 0 && resolvedAudience) {
        return refineCampaignTopicForHeadlines(`${goalsArray[0]} for ${resolvedAudience.split(',')[0].trim()}`);
      }
      if (goalsArray.length > 0) return refineCampaignTopicForHeadlines(goalsArray[0]);
      return 'Your Campaign';
    })();

    // ── 3 fundamentally different strategic archetypes ──────────────────────
    // Each archetype defines a distinct phase progression, card framing, and
    // week-theme approach so the 3 cards are genuinely different strategies —
    // not seed-shifted variations of the same sequence.
    const STRATEGY_ARCHETYPES = [
      {
        name: 'Educator',
        phases: ['Awareness', 'Education', 'Solution', 'Conversion'],
        titleAngle: 0,    // trend angle
        summary: (t: string, w: number) =>
          refineGeneratedText(`${w}-week journey: introduce ${t}, build understanding, present your solution, and drive action.`),
      },
      {
        name: 'Challenger',
        phases: ['Problem', 'Proof', 'Solution', 'Conversion'],
        titleAngle: 3,    // contrarian angle
        summary: (t: string, w: number) =>
          refineGeneratedText(`${w}-week arc: expose the real problem with ${t}, back it with proof, reveal the fix, and convert.`),
      },
      {
        name: 'Visionary',
        phases: ['Awareness', 'Problem', 'Education', 'Proof'],
        titleAngle: 4,    // future angle
        summary: (t: string, w: number) =>
          refineGeneratedText(`${w}-week campaign: paint the future of ${t}, challenge the status quo, educate deeply, and prove results.`),
      },
    ];

    // Phase metadata for objectives and content focus
    const PHASE_META: Record<string, { objective: string; content_focus: string; cta: string }> = {
      Awareness:   { objective: 'Build brand visibility and introduce your topic to a new audience',   content_focus: 'Educational content, industry insights, thought leadership',   cta: 'Follow · Subscribe' },
      Education:   { objective: 'Establish authority and teach your audience key concepts',             content_focus: 'How-to guides, frameworks, deep-dives',                          cta: 'Save · Share' },
      Problem:     { objective: 'Amplify pain points and spark recognition in your audience',           content_focus: 'Pain point stories, misconception-busting content',              cta: 'Comment · Engage' },
      Solution:    { objective: 'Position your offering as the clear answer to the problem',            content_focus: 'Solution reveals, product walkthroughs, comparisons',            cta: 'Learn More · Sign Up' },
      Proof:       { objective: 'Build trust through evidence, results, and social proof',              content_focus: 'Case studies, testimonials, data results',                       cta: 'Book a Call · Start Trial' },
      Conversion:  { objective: 'Drive decisive action and close the consideration loop',               content_focus: 'Offers, urgency plays, objection handling',                      cta: 'Buy Now · Schedule Demo' },
    };

    // Generate week themes for each archetype in parallel — each uses a different
    // diversity_seed AND a different phase progression, ensuring distinct results.
    const [setA, setB, setC] = await Promise.all(
      STRATEGY_ARCHETYPES.map((arch, i) =>
        generateRichThemesForCampaignWeeks(titleTopic, weeks, undefined, i * 2)
      )
    );

    // Remap each set's phase_labels to match its archetype's progression
    // so cards don't just have different week titles but different strategic arcs.
    function remapPhases(
      themes: Awaited<ReturnType<typeof generateRichThemesForCampaignWeeks>>,
      archetype: typeof STRATEGY_ARCHETYPES[number]
    ) {
      return themes.map((t, i) => {
        const phase = archetype.phases[i % archetype.phases.length];
        const meta = PHASE_META[phase] ?? { objective: phase, content_focus: '', cta: '' };
        return {
          ...t,
          phase_label: phase,
          objective: meta.objective,
          content_focus: meta.content_focus,
          cta_focus: meta.cta,
        };
      });
    }

    const themeSets = [
      remapPhases(setA, STRATEGY_ARCHETYPES[0]),
      remapPhases(setB, STRATEGY_ARCHETYPES[1]),
      remapPhases(setC, STRATEGY_ARCHETYPES[2]),
    ];

    function buildCard(themes: typeof themeSets[0], idx: number): BoltStrategyCard {
      const arch = STRATEGY_ARCHETYPES[idx];
      const phaseLabels = themes.map((t) => t.phase_label ?? '').filter(Boolean);
      const uniquePhases = Array.from(new Set(phaseLabels));

      const title = refineStrategicCardTitle(
        generateThemeFromTopic(titleTopic, undefined, arch.titleAngle),
        cleanTopic,
        idx
      );
      const angle = uniquePhases.slice(0, 4).join(' → ') || cleanTopic;
      const summary = arch.summary(titleTopic, weeks);

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
        // Prefer the new Brief audience field (free-form text) over the
        // legacy chip-joined string when both arrive — older callers send
        // only the legacy field.
        targetAudience: resolvedAudience,
        campaignGoal: combinedGoalStr,
        campaignGoals: goalsArray,
      };
    }

    const cards: BoltStrategyCard[] = [
      buildCard(themeSets[0], 0),
      buildCard(themeSets[1], 1),
      buildCard(themeSets[2], 2),
    ];

    return res.status(200).json({ cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
