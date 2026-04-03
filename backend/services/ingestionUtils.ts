import { createHash } from 'node:crypto';
import { supabase } from '../db/supabaseClient';

export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function normalizeHost(rawUrlOrHost: string): string {
  try {
    return new URL(rawUrlOrHost).hostname.toLowerCase();
  } catch {
    return rawUrlOrHost
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
  }
}

export function slugifyKeyword(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function hashKey(...parts: Array<string | number | null | undefined>): string {
  const payload = parts.map((part) => String(part ?? '')).join('::');
  return createHash('sha256').update(payload).digest('hex');
}

export function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function safeInteger(value: unknown, fallback = 0): number {
  return Math.round(safeNumber(value, fallback));
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'y'].includes(normalized);
  }
  return false;
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function ensureCanonicalDomain(companyId: string, rootUrlOrHost: string): Promise<{ id: string; primary_domain: string }> {
  const host = normalizeHost(rootUrlOrHost);
  const { data, error } = await supabase
    .from('canonical_domains')
    .upsert(
      {
        company_id: companyId,
        primary_domain: host,
        verified: false,
      },
      { onConflict: 'company_id,primary_domain' }
    )
    .select('id, primary_domain')
    .single();

  if (error) {
    throw new Error(`Failed to ensure canonical domain ${host}: ${error.message}`);
  }

  return data as { id: string; primary_domain: string };
}

export async function resolveCompanyWebsite(companyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('website, website_domain')
    .eq('id', companyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve company website for ${companyId}: ${error.message}`);
  }

  const website = (data as { website?: string | null; website_domain?: string | null } | null)?.website;
  const websiteDomain = (data as { website?: string | null; website_domain?: string | null } | null)?.website_domain;

  if (website && String(website).trim()) {
    const value = String(website).trim();
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  if (websiteDomain && String(websiteDomain).trim()) {
    return `https://${String(websiteDomain).trim()}`;
  }

  return null;
}

export type CsvRecord = Record<string, string>;

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

export function parseCsv(content: string): CsvRecord[] {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  const records: CsvRecord[] = [];

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const row: CsvRecord = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    records.push(row);
  }

  return records;
}

export function lowerCaseKeys<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value])
  );
}
