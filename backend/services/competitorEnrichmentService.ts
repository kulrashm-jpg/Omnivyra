import axios from 'axios';
import { config } from '@/config';
import { supabase } from '../db/supabaseClient';
import {
  applyEnrichmentProfile,
  applyKnownCompetitorEnrichment,
  buildLowConfidenceProfile,
  findKnownCompetitorProfile,
  type CompetitorEnrichmentProfile,
  type CompetitorProductType,
  type EnrichmentCandidateLike,
} from './competitorEnrichmentKnowledge';
import { normalizeCompetitorCategory, normalizeCompetitorTags } from './competitorTaxonomy';
import { ownedDbTable } from '../db/writeOwner';

const memoryCache = new Map<string, CompetitorEnrichmentProfile>();
const STORED_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDomain(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const input = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(input);
    const hostname = parsed.hostname.replace(/^www\./i, '');
    return hostname.includes('.') ? hostname : null;
  } catch {
    return null;
  }
}

function cacheKey(name: string, domain?: string | null): string {
  return `${normalizeDomain(domain) ?? ''}|${name.trim().toLowerCase()}`;
}

function inferProductType(text: string): CompetitorProductType {
  const normalized = text.toLowerCase();
  if (/\b(chatbot|chat bot|ai companion|conversational|assistant)\b/.test(normalized)) return 'AI chatbot';
  if (/\b(coach|consultant|consulting|advisor|therapist|counsellor|counselor|mentor|agency)\b/.test(normalized)) return 'human-led';
  if (/\b(course|newsletter|content|meditation|journal|guided audio|article|community)\b/.test(normalized)) return 'content-based';
  if (/\b(marketplace|connects|network)\b/.test(normalized)) return 'marketplace';
  if (/\b(platform|software|saas|app|api|dashboard|tool)\b/.test(normalized)) return 'software platform';
  return 'unknown';
}

function inferBusinessModel(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/\b(employer|enterprise|business|b2b|companies|teams|workplace|healthcare|provider)\b/.test(normalized)) {
    if (/\b(consumer|individual|personal|people|users|b2c)\b/.test(normalized)) return 'hybrid B2C/B2B';
    return 'B2B';
  }
  if (/\b(consumer|individual|personal|people|users|mobile app|subscription|b2c)\b/.test(normalized)) return 'B2C';
  return null;
}

function inferCategory(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/\b(therapy|therapist|counselling|counseling|mental health)\b/.test(normalized)) return 'mental health support';
  if (/\b(wellness|wellbeing|mindfulness|meditation|sleep|stress)\b/.test(normalized)) return 'mental wellness';
  if (/\b(coach|consultant|advisor|mentor|clarity)\b/.test(normalized)) return 'coaching and guidance';
  if (/\b(companion|chatbot|assistant|conversation)\b/.test(normalized)) return 'AI assistant';
  if (/\b(journal|journaling|reflection|self-reflection)\b/.test(normalized)) return 'self-reflection';
  if (/\b(crm|marketing|sales)\b/.test(normalized)) return 'marketing software';
  return null;
}

function inferUseCase(text: string): string | null {
  const normalized = text.toLowerCase();
  const matches: string[] = [];
  if (/\b(stress|anxiety|mood|mental health|wellbeing|wellness)\b/.test(normalized)) matches.push('emotional wellbeing support');
  if (/\b(clarity|decision|direction|purpose|life)\b/.test(normalized)) matches.push('life clarity and decision support');
  if (/\b(reflection|journal|journaling|self-reflection)\b/.test(normalized)) matches.push('guided self-reflection');
  if (/\b(meditation|mindfulness|sleep|relaxation)\b/.test(normalized)) matches.push('meditation, sleep, and stress reduction');
  if (/\b(crm|marketing|sales|growth)\b/.test(normalized)) matches.push('business growth and marketing operations');
  return matches.length > 0 ? matches.join(', ') : null;
}

function inferIntent(text: string): string | null {
  const useCase = inferUseCase(text);
  if (!useCase) return null;
  return `solve ${useCase}`;
}

function inferGeography(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/\b(global|worldwide|international)\b/.test(normalized)) return 'global';
  if (/\b(united states|usa|u\.s\.|us market)\b/.test(normalized)) return 'United States';
  if (/\b(india|indian)\b/.test(normalized)) return 'India';
  if (/\b(uk|united kingdom|europe)\b/.test(normalized)) return 'UK/Europe';
  return null;
}

function extractHtmlSummary(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '';
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';
  return [title, description, h1]
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function profileFromText(params: {
  name: string;
  domain?: string | null;
  text: string;
  sources: string[];
  baseConfidence: number;
}): CompetitorEnrichmentProfile {
  const text = params.text;
  return {
    name: params.name,
    domain: normalizeDomain(params.domain),
    category: normalizeCompetitorCategory(inferCategory(text), text),
    tags: normalizeCompetitorTags({
      productType: inferProductType(text),
      businessModel: inferBusinessModel(text),
      description: text,
      category: inferCategory(text),
    }),
    description: cleanText(text)?.slice(0, 320) ?? null,
    icp: {
      age_group: /\b(kids|children|teens|students)\b/i.test(text) ? 'younger users/students' : null,
      use_case: inferUseCase(text),
      user_intent: inferIntent(text),
    },
    business_model: inferBusinessModel(text),
    geography: inferGeography(text),
    product_type: inferProductType(text),
    scale_signals: {},
    confidence_score: params.baseConfidence,
    sources: params.sources,
  };
}

async function readCache(name: string, domain?: string | null): Promise<CompetitorEnrichmentProfile | null> {
  const key = cacheKey(name, domain);
  if (memoryCache.has(key)) return memoryCache.get(key) ?? null;

  try {
    const normalizedDomain = normalizeDomain(domain);
    let query = ownedDbTable('competitor_enrichment_cache')
      .select('name, domain, category, tags, description, icp, business_model, geography, product_type, scale_signals, confidence_score, sources, updated_at')
      .eq('cache_key', key)
      .maybeSingle();
    const { data, error } = await query;
    if (error || !data) return null;
    const updatedAt = Date.parse(String((data as { updated_at?: unknown }).updated_at ?? ''));
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > STORED_CACHE_MAX_AGE_MS) return null;
    if (Number(data.confidence_score ?? 0) <= 0.2) return null;
    const profileValue = {
      name: String(data.name ?? name),
      domain: (data.domain as string | null) ?? normalizedDomain,
      category: normalizeCompetitorCategory(data.category as string | null, data.description as string | null),
      tags: Array.isArray(data.tags) ? data.tags.map(String) as CompetitorEnrichmentProfile['tags'] : normalizeCompetitorTags({
        productType: data.product_type as string | null,
        businessModel: data.business_model as string | null,
        description: data.description as string | null,
        category: data.category as string | null,
      }),
      description: data.description as string | null,
      icp: (data.icp as CompetitorEnrichmentProfile['icp']) ?? { age_group: null, use_case: null, user_intent: null },
      business_model: data.business_model as string | null,
      geography: data.geography as string | null,
      product_type: (data.product_type as CompetitorProductType | null) ?? 'unknown',
      scale_signals: (data.scale_signals as CompetitorEnrichmentProfile['scale_signals']) ?? {},
      confidence_score: Number(data.confidence_score ?? 0.2),
      sources: Array.isArray(data.sources) ? data.sources.map(String) : ['stored_cache'],
    } satisfies CompetitorEnrichmentProfile;
    memoryCache.set(key, profileValue);
    return profileValue;
  } catch {
    return null;
  }
}

async function writeCache(profileValue: CompetitorEnrichmentProfile): Promise<void> {
  const key = cacheKey(profileValue.name, profileValue.domain);
  memoryCache.set(key, profileValue);
  try {
    await ownedDbTable('competitor_enrichment_cache')
      .upsert({
        cache_key: key,
        name: profileValue.name,
        domain: profileValue.domain,
        category: profileValue.category,
        tags: profileValue.tags,
        description: profileValue.description,
        icp: profileValue.icp,
        business_model: profileValue.business_model,
        geography: profileValue.geography,
        product_type: profileValue.product_type,
        scale_signals: profileValue.scale_signals,
        confidence_score: profileValue.confidence_score,
        sources: profileValue.sources,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'cache_key' });
  } catch {
    // Cache writes are best-effort; enrichment must not fail scoring/report generation.
  }
}

async function fetchHomepageProfile(name: string, domain?: string | null): Promise<CompetitorEnrichmentProfile | null> {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;
  try {
    // HARDEN-005: `normalizedDomain` is a user-writable competitor domain —
    // fetch its homepage via the SSRF-safe fetcher (blocked → null below).
    const { safeFetch, readCapped } = await import('../../lib/security/safeFetch');
    const response = await safeFetch(`https://${normalizedDomain}`, {
      method: 'GET',
      headers: { 'User-Agent': 'OmnivyraCompetitorEnrichment/1.0' },
    }, { timeoutMs: 6000, maxRedirects: 3, maxBytes: 5 * 1024 * 1024 });
    const summary = extractHtmlSummary((await readCapped(response)).toString('utf8'));
    if (!summary) return null;
    return profileFromText({
      name,
      domain: normalizedDomain,
      text: summary,
      sources: ['homepage'],
      baseConfidence: 0.58,
    });
  } catch {
    return null;
  }
}

async function fetchSerpProfile(name: string, domain?: string | null): Promise<CompetitorEnrichmentProfile | null> {
  const serpApiKey = config.SERPAPI_API_KEY || config.SERP_API_KEY || config.SERPAPI_KEY || '';
  if (!serpApiKey) return null;
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: domain ? `${name} ${domain}` : name,
        num: 5,
        api_key: serpApiKey,
      },
      timeout: 8000,
    });
    const organic = Array.isArray(response.data?.organic_results) ? response.data.organic_results : [];
    const snippets = organic
      .slice(0, 5)
      .map((item: { title?: string; snippet?: string }) => [item.title, item.snippet].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' ');
    if (!snippets) return null;
    return profileFromText({
      name,
      domain,
      text: snippets,
      sources: ['serp_snippets'],
      baseConfidence: 0.52,
    });
  } catch {
    return null;
  }
}

function mergeProfiles(primary: CompetitorEnrichmentProfile, secondary: CompetitorEnrichmentProfile): CompetitorEnrichmentProfile {
  return {
    ...primary,
    domain: primary.domain ?? secondary.domain,
    category: primary.category ?? secondary.category,
    description: primary.description ?? secondary.description,
    icp: {
      age_group: primary.icp.age_group ?? secondary.icp.age_group,
      use_case: primary.icp.use_case ?? secondary.icp.use_case,
      user_intent: primary.icp.user_intent ?? secondary.icp.user_intent,
    },
    business_model: primary.business_model ?? secondary.business_model,
    geography: primary.geography ?? secondary.geography,
    product_type: primary.product_type !== 'unknown' ? primary.product_type : secondary.product_type,
    scale_signals: { ...secondary.scale_signals, ...primary.scale_signals },
    confidence_score: Math.max(primary.confidence_score, secondary.confidence_score),
    sources: Array.from(new Set([...primary.sources, ...secondary.sources])),
  };
}

export function enrichCompetitorCandidateSync<T extends EnrichmentCandidateLike>(candidate: T): T {
  return applyKnownCompetitorEnrichment(candidate);
}

export async function enrichCompetitorCandidate<T extends EnrichmentCandidateLike>(params: {
  candidate: T;
  useNetwork?: boolean;
  useStoredCache?: boolean;
}): Promise<T> {
  const { candidate } = params;
  const known = findKnownCompetitorProfile(candidate.name, candidate.domain);
  let profileValue =
    known ??
    (params.useStoredCache === false ? null : await readCache(candidate.name, candidate.domain));

  if (!profileValue && params.useNetwork) {
    const homepage = await fetchHomepageProfile(candidate.name, candidate.domain);
    const serp = await fetchSerpProfile(candidate.name, candidate.domain);
    profileValue = homepage && serp ? mergeProfiles(homepage, serp) : homepage ?? serp;
  }

  if (!profileValue) {
    profileValue = buildLowConfidenceProfile({
      name: candidate.name,
      domain: normalizeDomain(candidate.domain),
    });
  }

  if (profileValue.confidence_score > 0.2) {
    await writeCache(profileValue);
  }

  return applyEnrichmentProfile(candidate, profileValue);
}

export async function enrichCompetitorCandidates<T extends EnrichmentCandidateLike>(params: {
  candidates: T[];
  useNetwork?: boolean;
  useStoredCache?: boolean;
}): Promise<T[]> {
  const enriched: T[] = [];
  for (const candidate of params.candidates) {
    enriched.push(await enrichCompetitorCandidate({
      candidate,
      useNetwork: params.useNetwork,
      useStoredCache: params.useStoredCache,
    }));
  }
  return enriched;
}
