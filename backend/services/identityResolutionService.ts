import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

export type IdentityExternalKeys = Record<string, unknown>;

export type IdentityResolutionInput = {
  companyId: string;
  email?: string | null;
  phone?: string | null;
  externalKeys?: IdentityExternalKeys | null;
};

export type IdentityResolutionResult = {
  unifiedPersonId: string;
  matchedBy: 'email' | 'phone' | 'external_keys' | 'created';
  created: boolean;
};

type UnifiedPersonRow = {
  id: string;
  company_id: string;
  primary_email: string | null;
  primary_phone: string | null;
  external_keys: IdentityExternalKeys | null;
};

function normalizeEmail(email?: string | null): string | null {
  const normalized = String(email ?? '').trim().toLowerCase();
  return normalized || null;
}

function normalizePhone(phone?: string | null): string | null {
  const raw = String(phone ?? '').trim();
  if (!raw) return null;

  const normalized = raw.startsWith('+')
    ? `+${raw.slice(1).replace(/\D/g, '')}`
    : raw.replace(/\D/g, '');

  return normalized || null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanExternalKeys(value?: IdentityExternalKeys | null): IdentityExternalKeys {
  if (!isPlainObject(value)) return {};

  const entries: Array<[string, unknown]> = [];

  for (const [key, entry] of Object.entries(value)) {
    if (entry == null) continue;
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) entries.push([key, trimmed]);
      continue;
    }
    if (isPlainObject(entry)) {
      const cleaned = cleanExternalKeys(entry as IdentityExternalKeys);
      if (Object.keys(cleaned).length > 0) entries.push([key, cleaned]);
      continue;
    }
    entries.push([key, entry]);
  }

  return Object.fromEntries(entries);
}

function mergeExternalKeys(existing: IdentityExternalKeys | null | undefined, incoming: IdentityExternalKeys): IdentityExternalKeys {
  const output: IdentityExternalKeys = { ...(isPlainObject(existing) ? existing : {}) };

  for (const [key, value] of Object.entries(incoming)) {
    if (isPlainObject(output[key]) && isPlainObject(value)) {
      output[key] = mergeExternalKeys(output[key] as IdentityExternalKeys, value as IdentityExternalKeys);
    } else {
      output[key] = value;
    }
  }

  return output;
}

async function findPersonByEmail(companyId: string, email: string): Promise<UnifiedPersonRow | null> {
  const { data, error } = await supabase
    .from('unified_persons')
    .select('id, company_id, primary_email, primary_phone, external_keys')
    .eq('company_id', companyId)
    .eq('primary_email', email)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve unified person by email: ${error.message}`);
  }

  return (data as UnifiedPersonRow | null) ?? null;
}

async function findPersonByPhone(companyId: string, phone: string): Promise<UnifiedPersonRow | null> {
  const { data, error } = await supabase
    .from('unified_persons')
    .select('id, company_id, primary_email, primary_phone, external_keys')
    .eq('company_id', companyId)
    .eq('primary_phone', phone)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve unified person by phone: ${error.message}`);
  }

  return (data as UnifiedPersonRow | null) ?? null;
}

async function findPersonByExternalKeys(companyId: string, externalKeys: IdentityExternalKeys): Promise<UnifiedPersonRow | null> {
  if (Object.keys(externalKeys).length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from('unified_persons')
    .select('id, company_id, primary_email, primary_phone, external_keys')
    .eq('company_id', companyId)
    .contains('external_keys', externalKeys)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve unified person by external keys: ${error.message}`);
  }

  return (data as UnifiedPersonRow | null) ?? null;
}

async function updatePersonIfNeeded(
  person: UnifiedPersonRow,
  params: {
    email: string | null;
    phone: string | null;
    externalKeys: IdentityExternalKeys;
  }
): Promise<void> {
  const mergedExternalKeys = mergeExternalKeys(person.external_keys, params.externalKeys);
  const payload: Record<string, unknown> = {};

  if (!person.primary_email && params.email) {
    payload.primary_email = params.email;
  }

  if (!person.primary_phone && params.phone) {
    payload.primary_phone = params.phone;
  }

  if (JSON.stringify(mergedExternalKeys) !== JSON.stringify(person.external_keys ?? {})) {
    payload.external_keys = mergedExternalKeys;
  }

  if (Object.keys(payload).length === 0) {
    return;
  }

  const { error } = await supabase
    .from('unified_persons')
    .update(payload)
    .eq('id', person.id);

  if (error) {
    throw new Error(`Failed to update unified person ${person.id}: ${error.message}`);
  }
}

export async function resolveUnifiedPerson(input: IdentityResolutionInput): Promise<IdentityResolutionResult> {
  if (!input.companyId?.trim()) {
    throw new Error('companyId is required to resolve unified person');
  }

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const externalKeys = cleanExternalKeys(input.externalKeys);

  let person: UnifiedPersonRow | null = null;
  let matchedBy: IdentityResolutionResult['matchedBy'] = 'created';

  if (email) {
    person = await findPersonByEmail(input.companyId, email);
    matchedBy = person ? 'email' : matchedBy;
  }

  if (!person && phone) {
    person = await findPersonByPhone(input.companyId, phone);
    matchedBy = person ? 'phone' : matchedBy;
  }

  if (!person) {
    person = await findPersonByExternalKeys(input.companyId, externalKeys);
    matchedBy = person ? 'external_keys' : matchedBy;
  }

  if (person) {
    await updatePersonIfNeeded(person, { email, phone, externalKeys });
    logger.info('unified_person_matched', {
      companyId: input.companyId,
      unifiedPersonId: person.id,
      matchedBy,
    });

    return {
      unifiedPersonId: person.id,
      matchedBy,
      created: false,
    };
  }

  const { data, error } = await supabase
    .from('unified_persons')
    .insert({
      company_id: input.companyId,
      primary_email: email,
      primary_phone: phone,
      external_keys: externalKeys,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create unified person: ${error.message}`);
  }

  const unifiedPersonId = (data as { id: string }).id;
  logger.info('unified_person_created', {
    companyId: input.companyId,
    unifiedPersonId,
    hasEmail: Boolean(email),
    hasPhone: Boolean(phone),
    hasExternalKeys: Object.keys(externalKeys).length > 0,
  });

  return {
    unifiedPersonId,
    matchedBy: 'created',
    created: true,
  };
}
