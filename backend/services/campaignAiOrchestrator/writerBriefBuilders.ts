import type { DeterministicWriterContentBrief } from './types';
import {
  deterministicFormatRequirements,
  ensureWriterFormatRequirements,
} from './contentFormatHelpers';
export {
  alignDailyExecutionItemsAsSingleSource,
  attachResolvedPostingsToWeeks,
  normalizeResolvedPostingToDailyItem,
  normalizeToDailyExecutionItem,
  warnDailyExecutionNormalization,
} from './dailyExecutionResolutionHelpers';
export { buildPostingExecutionMapForWeek, attachPostingExecutionMapsToWeeks } from './postingExecutionMapHelpers';

export function buildDeterministicWriterBrief(input: {
  slot: any;
  week: any;
  content_type: string;
}): DeterministicWriterContentBrief {
  const ensureNonEmpty = (v: unknown): string => {
    const t = String(v ?? '').trim();
    return t;
  };
  const oneSentence = (text: string): string => {
    const t = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    const m = t.match(/^(.+?[.!?])\s+/);
    const s = (m?.[1] ?? t).trim();
    const clipped = s.length > 220 ? `${s.slice(0, 217).trimEnd()}...` : s;
    return clipped.endsWith('.') || clipped.endsWith('!') || clipped.endsWith('?') ? clipped : `${clipped}.`;
  };
  const uniq = (arr: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of arr) {
      const t = String(raw ?? '').trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  };

  const slot = input.slot ?? {};
  const week = input.week ?? {};
  const intent = (slot?.intent && typeof slot.intent === 'object') ? slot.intent : {};

  const title = ensureNonEmpty(slot?.topic) || 'Topic';

  const tone =
    ensureNonEmpty(week?.week_extras?.writer_brief?.tone_guidance) ||
    ensureNonEmpty(week?.weeklyContextCapsule?.toneGuidance) ||
    'professional + clarity';

  const rawRole = ensureNonEmpty(intent?.strategic_role);
  const rawAngle = ensureNonEmpty(intent?.writing_angle);
  const roleOrAngle = (rawRole || rawAngle).toLowerCase();
  const intent_type =
    roleOrAngle.includes('demand') || roleOrAngle.includes('conversion')
      ? 'conversion'
      : roleOrAngle.includes('authority')
        ? 'authority'
        : roleOrAngle.includes('audience expansion') || roleOrAngle.includes('awareness')
          ? 'awareness'
          : roleOrAngle.includes('community') || roleOrAngle.includes('engagement')
            ? 'engagement'
            : roleOrAngle.includes('education')
              ? 'educational'
              : 'educational';

  const briefSummary = ensureNonEmpty(intent?.brief_summary ?? intent?.briefSummary);
  const outcomePromise = ensureNonEmpty(intent?.outcome_promise ?? intent?.outcomePromise);
  const core_message = oneSentence([briefSummary, outcomePromise].filter(Boolean).join(' ')) || oneSentence(outcomePromise || briefSummary || title);

  const alignmentSourceValue = ensureNonEmpty(intent?.recommendation_alignment?.source_value ?? intent?.recommendation_alignment?.sourceValue);
  const painPoint = ensureNonEmpty(intent?.pain_point ?? intent?.painPoint);
  const key_points = uniq([painPoint, outcomePromise, alignmentSourceValue]);

  const targetAudience = ensureNonEmpty(intent?.target_audience ?? intent?.targetAudience);
  const objective = ensureNonEmpty(intent?.objective);
  const theme =
    ensureNonEmpty(week?.theme) ||
    ensureNonEmpty(week?.weeklyContextCapsule?.campaignTheme) ||
    ensureNonEmpty(week?.week_extras?.writer_brief?.theme);

  const must_include = uniq([
    targetAudience ? `Address audience: ${targetAudience}` : '',
    theme ? `Align with weekly theme: ${theme}` : 'Align with weekly theme',
    objective ? `Support objective: ${objective}` : 'Support objective alignment',
  ]);

  const avoid = ['generic marketing claims', 'unrelated topics', 'breaking progression flow'];

  const ctaType = ensureNonEmpty(intent?.cta_type ?? intent?.ctaType);
  const cta_instruction =
    ctaType === 'Direct Conversion CTA'
      ? 'Include a direct action request (book, sign up, or request demo).'
      : ctaType === 'Authority CTA'
        ? 'Reinforce expertise; invite the reader to follow the framework.'
        : ctaType === 'Engagement CTA'
          ? 'Prompt interaction (comment, reply, share a perspective).'
          : ctaType === 'Soft CTA'
            ? 'Invite the reader to continue learning (low-friction next step).'
            : 'No explicit CTA required; end with a clear takeaway.';

  const ct = String(input.content_type || '').toLowerCase().trim();
  const structure_hint =
    ct.includes('article') || ct.includes('blog')
      ? 'Intro → Problem → Insight → Action → CTA'
      : ct.includes('video') || ct.includes('reel') || ct.includes('short')
        ? 'Hook → Explanation → Example → CTA'
        : ct.includes('post') || ct.includes('feed_post') || ct.includes('tweet') || ct.includes('thread')
          ? 'Hook → Insight → Value → CTA'
          : 'Problem → Insight → Action';

  const audienceStage =
    ensureNonEmpty(intent?.audience_stage ?? intent?.audienceStage) ||
    ensureNonEmpty(week?.audience_awareness_target);
  const stepRaw = Number(slot?.global_progression_index ?? slot?.progression_step);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? Math.floor(stepRaw) : 0;
  const progression_note = `Step ${step || '?'} in narrative progression. Supports audience stage: ${audienceStage || 'unknown'}.`;

  return {
    title,
    tone,
    intent_type,
    core_message,
    key_points,
    must_include,
    avoid,
    cta_instruction,
    structure_hint,
    progression_note,
    format_requirements: deterministicFormatRequirements(input.content_type),
  };
}

export function attachDeterministicWriterBriefsToExecutionSlots(weeks: any[]): void {
  if (!Array.isArray(weeks) || weeks.length === 0) return;
  for (const week of weeks) {
    const execItems: any[] = Array.isArray((week as any)?.execution_items) ? (week as any).execution_items : [];
    if (execItems.length === 0) continue;
    for (const exec of execItems) {
      const content_type = String(exec?.content_type ?? exec?.contentType ?? '').trim() || 'post';
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      for (const slot of slots) {
        if (!slot || typeof slot !== 'object') continue;
        if (!(slot as any).writer_content_brief || typeof (slot as any).writer_content_brief !== 'object') {
          (slot as any).writer_content_brief = buildDeterministicWriterBrief({ slot, week, content_type });
        } else {
          // Additive extension: do not overwrite existing brief; attach format_requirements if missing.
          const brief = (slot as any).writer_content_brief as any;
          if (!brief.format_requirements || typeof brief.format_requirements !== 'object') {
            brief.format_requirements = deterministicFormatRequirements(content_type);
          }
        }
      }
    }
  }

  // Lightweight validation: warn if any slot still missing a writer_content_brief.
  for (const week of weeks) {
    const execItems: any[] = Array.isArray((week as any)?.execution_items) ? (week as any).execution_items : [];
    if (execItems.length === 0) continue;
    let totalSlots = 0;
    let missing = 0;
    let missingFormat = 0;
    for (const exec of execItems) {
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      for (const slot of slots) {
        totalSlots += 1;
        if (!slot || typeof slot !== 'object') {
          missing += 1;
          missingFormat += 1;
          continue;
        }
        const has = (slot as any).writer_content_brief && typeof (slot as any).writer_content_brief === 'object';
        if (!has) missing += 1;
        const hasFormat =
          has &&
          (slot as any).writer_content_brief.format_requirements &&
          typeof (slot as any).writer_content_brief.format_requirements === 'object';
        if (!hasFormat) missingFormat += 1;
      }
    }
    if (missing > 0) {
      const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
      console.warn('[weekly-writer-brief][missing]', { week: weekNo || null, missing, totalSlots });
    }
    if (missingFormat > 0) {
      const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
      console.warn('[weekly-writer-brief][missing-format-requirements]', { week: weekNo || null, missingFormat, totalSlots });
    }
  }
}
