import type { CompetitorCandidate } from '../competitorEngineService';
import type {
  CompanyProfile,
  UserGuidanceStrategicSection,
  UserGuidedIntelligence,
} from './types';

const GUIDANCE_VERSION = 1;
const MAX_COMPETITOR_GUIDANCE = 40;
const MAX_AUDIT_EVENTS = 50;
const STRATEGIC_FIELD_MAP: Record<UserGuidanceStrategicSection, keyof CompanyProfile> = {
  positioning: 'brand_positioning',
  differentiation: 'competitive_advantages',
  messaging: 'key_messages',
  audience_framing: 'target_audience',
  strategic_narrative: 'content_strategy',
  authority_framing: 'unique_value',
  transformation_framing: 'transformation_mechanism',
};

function cleanText(value: unknown, max = 600): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function guidanceKey(value: unknown): string | null {
  const text = cleanText(value, 160);
  if (!text) return null;
  return text.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

function normalizedGuidanceName(value: unknown): string | null {
  const text = cleanText(value, 120);
  if (!text) return null;
  return text.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

export function normalizeUserGuidedIntelligence(
  value: unknown,
  options?: { action?: string; target?: string | null; previous?: UserGuidedIntelligence | null; now?: Date },
): UserGuidedIntelligence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as UserGuidedIntelligence;
  const nowIso = (options?.now ?? new Date()).toISOString();
  const competitorsByKey = new Map<string, NonNullable<UserGuidedIntelligence['competitors']>[number]>();

  for (const competitor of Array.isArray(raw.competitors) ? raw.competitors : []) {
    const name = normalizedGuidanceName(competitor?.name);
    const key = guidanceKey(name);
    if (!name || !key) continue;
    const state = competitor.state;
    if (!['user_added', 'pinned', 'rejected', 'removed', 'restored'].includes(state)) continue;
    competitorsByKey.set(key, {
      name,
      domain: cleanText(competitor.domain, 160),
      state,
      source: cleanText(competitor.source, 60) ?? 'user_guided',
      rationale: cleanText(competitor.rationale, 500),
      original_source: cleanText(competitor.original_source, 80),
      original_rank: Number.isFinite(competitor.original_rank) ? Number(competitor.original_rank) : null,
      competitor_intelligence: competitor.competitor_intelligence ?? null,
      updated_at: cleanText(competitor.updated_at, 40) ?? nowIso,
    });
  }

  const messaging: UserGuidedIntelligence['messaging'] = {};
  for (const section of Object.keys(STRATEGIC_FIELD_MAP) as UserGuidanceStrategicSection[]) {
    const field = raw.messaging?.[section];
    if (!field) continue;
    messaging[section] = {
      ai_value: cleanText(field.ai_value, 1200),
      approved_value: cleanText(field.approved_value, 1200),
      edited_value: cleanText(field.edited_value, 1200),
      status: ['ai_suggested', 'approved', 'edited', 'rejected', 'regenerate_requested'].includes(String(field.status))
        ? field.status
        : 'edited',
      guidance: cleanText(field.guidance, 500),
      updated_at: cleanText(field.updated_at, 40) ?? nowIso,
    };
  }

  const guidanceNotes = (Array.isArray(raw.guidance_notes) ? raw.guidance_notes : [])
    .map((note) => {
      const text = cleanText(note?.text, 500);
      if (!text) return null;
      return {
        id: cleanText(note.id, 80) ?? `guidance-${Date.now()}`,
        text,
        category: note.category ?? 'identity',
        status: note.status === 'archived' ? 'archived' as const : 'active' as const,
        created_at: cleanText(note.created_at, 40) ?? nowIso,
      };
    })
    .filter((note): note is NonNullable<typeof note> => Boolean(note));

  const previousAudit = Array.isArray(options?.previous?.audit) ? options.previous.audit : [];
  const incomingAudit = Array.isArray(raw.audit) ? raw.audit : previousAudit;
  const audit = [
    ...incomingAudit,
    ...(options?.action
      ? [{ action: options.action, target: options.target ?? null, created_at: nowIso }]
      : []),
  ].slice(-MAX_AUDIT_EVENTS);

  // Cumulative competitor "understanding" — keep the incoming statement, else preserve the
  // previously-saved one so a partial guidance update never wipes it.
  const cuSource = (raw.competitor_understanding ?? options?.previous?.competitor_understanding) ?? null;
  const cuStatement = cleanText(cuSource?.statement, 2000);
  const competitor_understanding = cuStatement
    ? {
        statement: cuStatement,
        updated_at: cleanText(cuSource?.updated_at, 40) ?? nowIso,
        edited_by_user: Boolean(cuSource?.edited_by_user),
      }
    : null;

  const result: UserGuidedIntelligence = {
    version: GUIDANCE_VERSION,
    updated_at: nowIso,
    competitors: Array.from(competitorsByKey.values()).slice(0, MAX_COMPETITOR_GUIDANCE),
    competitor_understanding,
    messaging,
    guidance_notes: guidanceNotes,
    audit,
  };

  return result.competitors?.length || competitor_understanding || Object.keys(messaging).length || guidanceNotes.length || audit.length
    ? result
    : null;
}

export function rejectedCompetitorGuidance(profile: CompanyProfile | null | undefined): Set<string> {
  const rejected = new Set<string>();
  for (const competitor of profile?.report_settings?.user_guidance?.competitors ?? []) {
    if (competitor.state !== 'rejected' && competitor.state !== 'removed') continue;
    const key = guidanceKey(competitor.name);
    if (key) rejected.add(key);
  }
  return rejected;
}

export function buildUserGuidedCompetitorCandidates(profile: CompanyProfile | null | undefined): CompetitorCandidate[] {
  const guidance = profile?.report_settings?.user_guidance;
  if (!guidance?.competitors?.length) return [];
  return guidance.competitors
    .filter((competitor) => ['pinned', 'user_added', 'restored'].includes(competitor.state))
    .map((competitor): CompetitorCandidate | null => {
      const name = normalizedGuidanceName(competitor.name);
      if (!name) return null;
      return {
        name,
        domain: cleanText(competitor.domain, 160),
        source: 'manual',
        classification: 'direct_competitor',
        rationale: competitor.rationale || 'User-guided strategic competitor signal.',
        description: competitor.rationale || competitor.competitor_intelligence?.rationale || null,
        targetCustomer: competitor.competitor_intelligence?.audience_overlap ?? null,
        useCase: competitor.competitor_intelligence?.ecosystem_role ?? null,
        businessModel: competitor.competitor_intelligence?.monetization_adjacency ?? null,
        productSignals: ['user-guided', competitor.state],
        confidenceScore: competitor.state === 'pinned' ? 0.98 : 0.9,
        competitorIntelligence: {
          ...(competitor.competitor_intelligence ?? {}),
          reasoning: competitor.rationale || competitor.competitor_intelligence?.reasoning || 'User marked this competitor as strategically relevant.',
        },
      };
    })
    .filter((candidate): candidate is CompetitorCandidate => Boolean(candidate));
}

export function applyUserGuidedCompetitorSteering(
  profile: CompanyProfile | null | undefined,
  candidates: CompetitorCandidate[],
): CompetitorCandidate[] {
  const rejected = rejectedCompetitorGuidance(profile);
  const userCandidates = buildUserGuidedCompetitorCandidates(profile);
  const userKeys = new Set(userCandidates.map((candidate) => guidanceKey(candidate.domain) ?? guidanceKey(candidate.name)).filter(Boolean));
  const filtered = candidates.filter((candidate) => {
    const key = guidanceKey(candidate.domain) ?? guidanceKey(candidate.name);
    if (!key) return true;
    if (userKeys.has(key)) return true;
    return !rejected.has(key);
  });
  return [...userCandidates, ...filtered];
}

export function applyApprovedStrategicGuidance(profile: CompanyProfile): CompanyProfile {
  const messaging = profile.report_settings?.user_guidance?.messaging;
  if (!messaging) return profile;
  const next: CompanyProfile = { ...profile };
  for (const section of Object.keys(STRATEGIC_FIELD_MAP) as UserGuidanceStrategicSection[]) {
    const approved = messaging[section];
    const value = approved?.edited_value ?? approved?.approved_value;
    if (!value || (approved.status !== 'edited' && approved.status !== 'approved')) continue;
    const field = STRATEGIC_FIELD_MAP[section];
    (next as Record<string, unknown>)[field] = value;
  }
  return next;
}

export function buildUserGuidanceContextBlock(profile: CompanyProfile | null | undefined): string {
  const guidance = profile?.report_settings?.user_guidance;
  if (!guidance) return '';
  const lines: string[] = [];
  const pinned = (guidance.competitors ?? []).filter((competitor) => ['pinned', 'user_added', 'restored'].includes(competitor.state));
  const rejected = (guidance.competitors ?? []).filter((competitor) => ['rejected', 'removed'].includes(competitor.state));
  if (pinned.length > 0) {
    lines.push(`High-trust competitor signals: ${pinned.map((competitor) => competitor.name).join(', ')}.`);
  }
  if (rejected.length > 0) {
    lines.push(`Competitors/patterns marked irrelevant: ${rejected.map((competitor) => competitor.name).join(', ')}.`);
  }
  for (const section of Object.keys(STRATEGIC_FIELD_MAP) as UserGuidanceStrategicSection[]) {
    const field = guidance.messaging?.[section];
    const value = field?.edited_value ?? field?.approved_value ?? field?.guidance;
    if (!value) continue;
    lines.push(`${section.replace(/_/g, ' ')} guidance: ${value}`);
  }
  for (const note of guidance.guidance_notes ?? []) {
    if (note.status === 'archived') continue;
    lines.push(`Founder guidance: ${note.text}`);
  }
  if (lines.length === 0) return '';
  return [
    'USER-GUIDED INTELLIGENCE:',
    ...lines.slice(0, 12),
    'Use user guidance as steering context, not as evidence for invented company facts. Preserve approved identity unless regeneration explicitly asks otherwise.',
  ].join('\n');
}
