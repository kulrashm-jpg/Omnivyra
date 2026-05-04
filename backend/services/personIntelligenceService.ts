import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { normalizeMetadata } from './intelligenceResponseMapper';

export class PersonIntelligenceNotFoundError extends Error {
  statusCode = 404;

  constructor(message = 'Unified person not found') {
    super(message);
    this.name = 'PersonIntelligenceNotFoundError';
  }
}

export class PersonIntelligenceInvalidIdError extends Error {
  statusCode = 400;

  constructor(message = 'Invalid unified person id') {
    super(message);
    this.name = 'PersonIntelligenceInvalidIdError';
  }
}

type PersonRow = {
  id: string;
  company_id: string;
  primary_email: string | null;
  primary_phone: string | null;
  external_keys: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type TouchpointRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  source: string;
  unified_source: Record<string, unknown> | null;
  touchpoint_type: string;
  reference_table: string;
  reference_id: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ExpectedEventRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  trigger_touchpoint_id: string;
  expected_event_type: string;
  due_at: string;
  status: string;
  completed_touchpoint_id: string | null;
  created_at: string;
  updated_at: string;
};

type GapRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  expected_event_instance_id: string;
  gap_type: string;
  priority: string;
  status: string;
  detected_at: string;
  resolved_at: string | null;
  metadata: Record<string, unknown> | null;
};

type PromptRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  intelligence_gap_id: string;
  prompt_type: string;
  title: string;
  message: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type AttributionRow = {
  id: string;
  company_id: string;
  unified_person_id: string;
  revenue_touchpoint_id: string;
  attributed_touchpoint_id: string;
  attribution_type: string;
  created_at: string;
};

const PERSON_TOUCHPOINT_LIMIT = 250;
const PERSON_EXPECTED_EVENT_LIMIT = 100;
const PERSON_GAP_LIMIT = 100;
const PERSON_PROMPT_LIMIT = 100;
const PERSON_ATTRIBUTION_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PersonIntelligenceScope = {
  personId: string;
  companyId: string;
};

export type PersonIntelligenceResult = {
  person: {
    id: string;
    company_id: string;
    primary_email: string | null;
    primary_phone: string | null;
    external_keys: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
  touchpoints: Array<{
    id: string;
    source: string;
    unified_source: Record<string, unknown>;
    touchpoint_type: string;
    reference_table: string;
    reference_id: string;
    occurred_at: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  expected_events: ExpectedEventRow[];
  gaps: Array<Omit<GapRow, 'metadata'> & { metadata: Record<string, unknown> }>;
  prompts: PromptRow[];
  attribution: Array<AttributionRow & {
    revenue_touchpoint: TouchpointRow | null;
    attributed_touchpoint: TouchpointRow | null;
  }>;
};

function normalizeId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new PersonIntelligenceInvalidIdError('person id is required');
  }
  if (!UUID_PATTERN.test(normalized)) {
    throw new PersonIntelligenceInvalidIdError();
  }
  return normalized;
}

function normalizePerson(row: PersonRow): PersonIntelligenceResult['person'] {
  return {
    id: row.id,
    company_id: row.company_id,
    primary_email: row.primary_email,
    primary_phone: row.primary_phone,
    external_keys: normalizeMetadata(row.external_keys),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeTouchpoint(row: TouchpointRow): PersonIntelligenceResult['touchpoints'][number] {
  return {
    id: row.id,
    source: row.source,
    unified_source: normalizeMetadata(row.unified_source),
    touchpoint_type: row.touchpoint_type,
    reference_table: row.reference_table,
    reference_id: row.reference_id,
    occurred_at: row.occurred_at,
    metadata: normalizeMetadata(row.metadata),
    created_at: row.created_at,
  };
}

function normalizeGap(row: GapRow): PersonIntelligenceResult['gaps'][number] {
  return {
    ...row,
    metadata: normalizeMetadata(row.metadata),
  };
}

async function loadPerson(personId: string): Promise<PersonRow> {
  const { data, error } = await supabase
    .from('unified_persons')
    .select('id, company_id, primary_email, primary_phone, external_keys, created_at, updated_at')
    .eq('id', personId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load unified person: ${error.message}`);
  }

  if (!data) {
    throw new PersonIntelligenceNotFoundError();
  }

  return data as PersonRow;
}

async function loadAttributionTouchpoints(
  companyId: string,
  attributionRows: AttributionRow[]
): Promise<Map<string, TouchpointRow>> {
  const ids = Array.from(
    new Set(
      attributionRows
        .flatMap((row) => [row.revenue_touchpoint_id, row.attributed_touchpoint_id])
        .filter(Boolean)
    )
  );

  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('id, company_id, unified_person_id, source, unified_source, touchpoint_type, reference_table, reference_id, occurred_at, metadata, created_at')
    .eq('company_id', companyId)
    .in('id', ids);

  if (error) {
    throw new Error(`Failed to load attribution touchpoints: ${error.message}`);
  }

  return new Map(((data ?? []) as TouchpointRow[]).map((touchpoint) => [touchpoint.id, touchpoint]));
}

export async function getPersonIntelligenceScope(personId: string): Promise<PersonIntelligenceScope> {
  const normalizedPersonId = normalizeId(personId);
  const person = await loadPerson(normalizedPersonId);

  return {
    personId: person.id,
    companyId: person.company_id,
  };
}

export async function getPersonIntelligence(
  personId: string,
  companyId?: string
): Promise<PersonIntelligenceResult> {
  const normalizedPersonId = normalizeId(personId);
  const person = await loadPerson(normalizedPersonId);
  const scopedCompanyId = companyId?.trim() || person.company_id;

  if (person.company_id !== scopedCompanyId) {
    throw new PersonIntelligenceNotFoundError();
  }

  const [
    touchpointsResult,
    expectedEventsResult,
    gapsResult,
    promptsResult,
    attributionResult,
  ] = await Promise.all([
    supabase
      .from('unified_touchpoints')
      .select('id, company_id, unified_person_id, source, unified_source, touchpoint_type, reference_table, reference_id, occurred_at, metadata, created_at')
      .eq('company_id', scopedCompanyId)
      .eq('unified_person_id', normalizedPersonId)
      .order('occurred_at', { ascending: false })
      .limit(PERSON_TOUCHPOINT_LIMIT),
    supabase
      .from('expected_event_instances')
      .select('id, company_id, unified_person_id, trigger_touchpoint_id, expected_event_type, due_at, status, completed_touchpoint_id, created_at, updated_at')
      .eq('company_id', scopedCompanyId)
      .eq('unified_person_id', normalizedPersonId)
      .order('due_at', { ascending: false })
      .limit(PERSON_EXPECTED_EVENT_LIMIT),
    supabase
      .from('intelligence_gaps')
      .select('id, company_id, unified_person_id, expected_event_instance_id, gap_type, priority, status, detected_at, resolved_at, metadata')
      .eq('company_id', scopedCompanyId)
      .eq('unified_person_id', normalizedPersonId)
      .order('detected_at', { ascending: false })
      .limit(PERSON_GAP_LIMIT),
    supabase
      .from('intelligence_prompts')
      .select('id, company_id, unified_person_id, intelligence_gap_id, prompt_type, title, message, status, created_at, updated_at')
      .eq('company_id', scopedCompanyId)
      .eq('unified_person_id', normalizedPersonId)
      .order('created_at', { ascending: false })
      .limit(PERSON_PROMPT_LIMIT),
    supabase
      .from('attribution_results')
      .select('id, company_id, unified_person_id, revenue_touchpoint_id, attributed_touchpoint_id, attribution_type, created_at')
      .eq('company_id', scopedCompanyId)
      .eq('unified_person_id', normalizedPersonId)
      .order('created_at', { ascending: false })
      .limit(PERSON_ATTRIBUTION_LIMIT),
  ]);

  if (touchpointsResult.error) {
    throw new Error(`Failed to load person touchpoints: ${touchpointsResult.error.message}`);
  }
  if (expectedEventsResult.error) {
    throw new Error(`Failed to load person expected events: ${expectedEventsResult.error.message}`);
  }
  if (gapsResult.error) {
    throw new Error(`Failed to load person intelligence gaps: ${gapsResult.error.message}`);
  }
  if (promptsResult.error) {
    throw new Error(`Failed to load person prompts: ${promptsResult.error.message}`);
  }
  if (attributionResult.error) {
    throw new Error(`Failed to load person attribution: ${attributionResult.error.message}`);
  }

  const attributionRows = (attributionResult.data ?? []) as AttributionRow[];
  const attributionTouchpoints = await loadAttributionTouchpoints(scopedCompanyId, attributionRows);

  const result: PersonIntelligenceResult = {
    person: normalizePerson(person),
    touchpoints: ((touchpointsResult.data ?? []) as TouchpointRow[]).map(normalizeTouchpoint),
    expected_events: (expectedEventsResult.data ?? []) as ExpectedEventRow[],
    gaps: ((gapsResult.data ?? []) as GapRow[]).map(normalizeGap),
    prompts: (promptsResult.data ?? []) as PromptRow[],
    attribution: attributionRows.map((row) => ({
      ...row,
      revenue_touchpoint: attributionTouchpoints.get(row.revenue_touchpoint_id) ?? null,
      attributed_touchpoint: attributionTouchpoints.get(row.attributed_touchpoint_id) ?? null,
    })),
  };

  return result;
}
