import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { logger } from './logger';

const MAX_PENDING_PROMPTS_PER_COMPANY = 5;
const PROMPT_COOLDOWN_HOURS = 24;

type PromptType = 'data_request' | 'confirmation' | 'followup';

type PromptStatus = 'pending' | 'shown' | 'responded' | 'dismissed';

export type PromptGenerationGap = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  gap_type: string;
};

type OpenGapRow = PromptGenerationGap & {
  status: string;
  detected_at: string;
  metadata: Record<string, unknown> | null;
};

type ExistingPromptRow = {
  intelligence_gap_id: string;
};

type RecentPromptRow = {
  intelligence_gap_id: string;
  unified_person_id: string | null;
  created_at: string;
};

type PromptGapLookupRow = {
  id: string;
  gap_type: string;
};

type PromptTemplate = {
  promptType: PromptType;
  title: string;
  message: string;
};

type PromptInsertRow = {
  company_id: string;
  unified_person_id: string | null;
  intelligence_gap_id: string;
  prompt_type: PromptType;
  title: string;
  message: string;
  status: PromptStatus;
};

export type PromptGenerationResult = {
  attempted: number;
  promptsCreated: number;
  duplicatesAvoided: number;
  skippedDueToLimit: number;
  skippedDueToCooldown: number;
};

function templateForGapType(gapType: string): PromptTemplate {
  if (gapType === 'missing_revenue') {
    return {
      promptType: 'data_request',
      title: 'Revenue outcome missing',
      message: 'A lead was created but no revenue data was recorded. Please update the outcome.',
    };
  }

  return {
    promptType: 'data_request',
    title: 'Missing journey data',
    message: 'An expected step in the customer journey was not recorded. Please update the missing outcome.',
  };
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function safeNumber(value: unknown): number {
  if (value == null || value === '') {
    return 0;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoreForGap(gap: OpenGapRow): number {
  return safeNumber(normalizeMetadata(gap.metadata).score);
}

function cooldownKey(gapType: string, unifiedPersonId: string | null): string {
  return `${gapType.trim().toLowerCase()}::${unifiedPersonId ?? 'null'}`;
}

function sortGapsByScore(left: OpenGapRow, right: OpenGapRow): number {
  const scoreDelta = scoreForGap(right) - scoreForGap(left);
  if (scoreDelta !== 0) return scoreDelta;

  const leftTime = Date.parse(left.detected_at);
  const rightTime = Date.parse(right.detected_at);
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function uniqueCompanyIds(gaps: PromptGenerationGap[]): string[] {
  return Array.from(
    new Set(
      gaps
        .map((gap) => gap.company_id?.trim())
        .filter((companyId): companyId is string => Boolean(companyId))
    )
  );
}

async function countPendingPrompts(companyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('intelligence_prompts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Failed to count pending intelligence prompts: ${error.message}`);
  }

  return count ?? 0;
}

async function loadExistingPromptGapIds(companyId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('intelligence_prompts')
    .select('intelligence_gap_id')
    .eq('company_id', companyId);

  if (error) {
    throw new Error(`Failed to load existing intelligence prompts: ${error.message}`);
  }

  return new Set(
    ((data ?? []) as ExistingPromptRow[])
      .map((row) => row.intelligence_gap_id)
      .filter(Boolean)
  );
}

async function loadOpenPromptCandidates(companyId: string): Promise<OpenGapRow[]> {
  const existingPromptGapIds = await loadExistingPromptGapIds(companyId);
  const { data, error } = await supabase
    .from('intelligence_gaps')
    .select('id, company_id, unified_person_id, gap_type, status, detected_at, metadata')
    .eq('company_id', companyId)
    .eq('status', 'open');

  if (error) {
    throw new Error(`Failed to load open intelligence gaps for prompt generation: ${error.message}`);
  }

  return ((data ?? []) as OpenGapRow[])
    .filter((gap) => !existingPromptGapIds.has(gap.id))
    .sort(sortGapsByScore);
}

async function loadCooldownKeys(companyId: string, since: string): Promise<Set<string>> {
  const { data: prompts, error: promptsError } = await supabase
    .from('intelligence_prompts')
    .select('intelligence_gap_id, unified_person_id, created_at')
    .eq('company_id', companyId)
    .gte('created_at', since);

  if (promptsError) {
    throw new Error(`Failed to load recent intelligence prompts: ${promptsError.message}`);
  }

  const recentPrompts = (prompts ?? []) as RecentPromptRow[];
  const gapIds = Array.from(new Set(recentPrompts.map((prompt) => prompt.intelligence_gap_id).filter(Boolean)));
  if (gapIds.length === 0) {
    return new Set();
  }

  const { data: promptGaps, error: promptGapsError } = await supabase
    .from('intelligence_gaps')
    .select('id, gap_type')
    .in('id', gapIds);

  if (promptGapsError) {
    throw new Error(`Failed to load recent prompt gap types: ${promptGapsError.message}`);
  }

  const gapTypeById = new Map(
    ((promptGaps ?? []) as PromptGapLookupRow[]).map((gap) => [gap.id, gap.gap_type])
  );
  const keys = new Set<string>();

  for (const prompt of recentPrompts) {
    const gapType = gapTypeById.get(prompt.intelligence_gap_id);
    if (!gapType) {
      continue;
    }
    keys.add(cooldownKey(gapType, prompt.unified_person_id));
  }

  return keys;
}

export async function generatePromptsForGaps(
  gaps: PromptGenerationGap[]
): Promise<PromptGenerationResult> {
  if (gaps.length === 0) {
    return {
      attempted: 0,
      promptsCreated: 0,
      duplicatesAvoided: 0,
      skippedDueToLimit: 0,
      skippedDueToCooldown: 0,
    };
  }

  const companyIds = uniqueCompanyIds(gaps);
  const cooldownSince = new Date(Date.now() - PROMPT_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  const rows: PromptInsertRow[] = [];
  let considered = 0;
  let skippedDueToLimit = 0;
  let skippedDueToCooldown = 0;

  for (const companyId of companyIds) {
    const [pendingPrompts, candidates, cooldownKeys] = await Promise.all([
      countPendingPrompts(companyId),
      loadOpenPromptCandidates(companyId),
      loadCooldownKeys(companyId, cooldownSince),
    ]);

    considered += candidates.length;

    const availableSlots = Math.max(0, MAX_PENDING_PROMPTS_PER_COMPANY - pendingPrompts);
    if (availableSlots === 0) {
      skippedDueToLimit += candidates.length;
      if (candidates.length > 0) {
        logger.info('prompts_skipped_due_to_limit', {
          companyId,
          pendingPrompts,
          maxPendingPrompts: MAX_PENDING_PROMPTS_PER_COMPANY,
          skipped: candidates.length,
        });
      }
      continue;
    }

    let companyRows = 0;
    let companySkippedDueToLimit = 0;
    let companySkippedDueToCooldown = 0;
    for (const gap of candidates) {
      if (companyRows >= availableSlots) {
        companySkippedDueToLimit += 1;
        skippedDueToLimit += 1;
        continue;
      }

      if (cooldownKeys.has(cooldownKey(gap.gap_type, gap.unified_person_id))) {
        companySkippedDueToCooldown += 1;
        skippedDueToCooldown += 1;
        continue;
      }

      const template = templateForGapType(gap.gap_type);
      rows.push({
        company_id: gap.company_id,
        unified_person_id: gap.unified_person_id,
        intelligence_gap_id: gap.id,
        prompt_type: template.promptType,
        title: template.title,
        message: template.message,
        status: 'pending',
      });
      companyRows += 1;
    }

    if (companySkippedDueToCooldown > 0) {
      logger.info('prompts_skipped_due_to_cooldown', {
        companyId,
        cooldownHours: PROMPT_COOLDOWN_HOURS,
        skipped: companySkippedDueToCooldown,
      });
    }

    if (companySkippedDueToLimit > 0) {
      logger.info('prompts_skipped_due_to_limit', {
        companyId,
        pendingPrompts,
        maxPendingPrompts: MAX_PENDING_PROMPTS_PER_COMPANY,
        availableSlots,
        skipped: companySkippedDueToLimit,
      });
    }
  }

  if (rows.length === 0) {
    return {
      attempted: considered,
      promptsCreated: 0,
      duplicatesAvoided: 0,
      skippedDueToLimit,
      skippedDueToCooldown,
    };
  }

  const { data, error } = await supabase
    .from('intelligence_prompts')
    .upsert(rows, {
      onConflict: 'intelligence_gap_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) {
    throw new Error(`Failed to generate intelligence prompts: ${error.message}`);
  }

  const promptsCreated = data?.length ?? 0;
  const duplicatesAvoided = rows.length - promptsCreated;

  if (promptsCreated > 0) {
    logger.info('prompts_created', {
      attempted: considered,
      promptsCreated,
      duplicatesAvoided,
      maxPendingPromptsPerCompany: MAX_PENDING_PROMPTS_PER_COMPANY,
      cooldownHours: PROMPT_COOLDOWN_HOURS,
    });
  }

  if (promptsCreated > 0 || duplicatesAvoided > 0) {
    logger.info('intelligence_prompts_generated', {
      attempted: considered,
      promptsCreated,
      duplicatesAvoided,
      skippedDueToLimit,
      skippedDueToCooldown,
    });
  }

  return {
    attempted: considered,
    promptsCreated,
    duplicatesAvoided,
    skippedDueToLimit,
    skippedDueToCooldown,
  };
}
