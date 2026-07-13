/**
 * companyProfileProvenanceService.ts — field-level provenance for Company
 * Review (ONBOARD-001R §4).
 *
 * Classifies each editable company-profile field as System Discovered /
 * AI Enriched / User Edited so the EXISTING company-profile form can show the
 * user where every value came from, why it exists, and that it's editable.
 * It does NOT duplicate the form or the profile store — it reads the existing
 * columns:
 *   - report_settings.discovered_metadata.provenance  → system_discovered
 *   - company_profiles.field_confidence + source='ai_refined' → ai_enriched
 *   - company_profiles.user_locked_fields             → user_edited (wins)
 */

import { supabase } from '../db/supabaseClient';
import type { FieldOrigin, FieldProvenance } from './companyProfile/enrichmentProvenance';

/** The fields surfaced in Company Review (all user-editable). */
const REVIEW_FIELDS: ReadonlyArray<{ field: string; label: string; why: string }> = [
  { field: 'name', label: 'Company name', why: 'Identifies your brand across every generated asset.' },
  { field: 'industry', label: 'Industry', why: 'Shapes tone, topics, and competitor analysis.' },
  { field: 'geography', label: 'Country / region', why: 'Localizes examples, timing, and language.' },
  { field: 'logo_url', label: 'Logo', why: 'Rendered onto creator images and reports.' },
  { field: 'favicon_url', label: 'Favicon', why: 'Brand mark for compact surfaces.' },
  { field: 'products_services', label: 'Products & services', why: 'Grounds content in what you actually sell.' },
  { field: 'target_audience', label: 'Target audience', why: 'Directs who the content speaks to.' },
  { field: 'brand_voice', label: 'Brand voice', why: 'Controls the writing style of every draft.' },
  { field: 'competitors', label: 'Competitors', why: 'Feeds differentiation and positioning.' },
  { field: 'unique_value', label: 'Unique value', why: 'Anchors the core message.' },
];

export interface ReviewFieldProvenance {
  field: string;
  label: string;
  why: string;
  value: unknown;
  origin: FieldOrigin | 'empty';
  confidence: FieldProvenance['confidence'] | null;
  editable: boolean;
}

export interface CompanyProfileProvenance {
  companyId: string;
  generatedAt: string;
  fields: ReviewFieldProvenance[];
}

/**
 * Classify every review field's origin. Never throws; returns an empty
 * `fields` list on error so the review UI degrades gracefully.
 */
export async function getCompanyProfileProvenance(companyId: string): Promise<CompanyProfileProvenance> {
  const generatedAt = new Date().toISOString();
  const empty: CompanyProfileProvenance = { companyId, generatedAt, fields: [] };
  if (!companyId) return empty;

  try {
    const { data } = await supabase
      .from('company_profiles')
      .select('name, industry, geography, logo_url, favicon_url, products_services, target_audience, brand_voice, competitors, unique_value, source, field_confidence, user_locked_fields, report_settings')
      .eq('company_id', companyId)
      .maybeSingle();

    if (!data) return empty;
    const row = data as Record<string, unknown>;

    const lockedFields = new Set<string>(
      Array.isArray(row.user_locked_fields) ? (row.user_locked_fields as string[]) : [],
    );
    const discoveredProvenance = extractDiscoveredProvenance(row.report_settings);
    const aiFieldConfidence = (row.field_confidence && typeof row.field_confidence === 'object'
      ? row.field_confidence
      : {}) as Record<string, unknown>;
    const profileSource = String(row.source ?? 'user');

    const fields: ReviewFieldProvenance[] = REVIEW_FIELDS.map(({ field, label, why }) => {
      const value = row[field] ?? null;
      const hasValue = value !== null && value !== undefined && value !== '';

      let origin: ReviewFieldProvenance['origin'];
      let confidence: ReviewFieldProvenance['confidence'] = null;

      if (!hasValue) {
        origin = 'empty';
      } else if (lockedFields.has(field)) {
        origin = 'user_edited';          // user edits win
      } else if (discoveredProvenance[field]) {
        origin = 'system_discovered';
        confidence = discoveredProvenance[field].confidence;
      } else if (aiFieldConfidence[field] !== undefined || profileSource === 'ai_refined') {
        origin = 'ai_enriched';
        confidence = readAiConfidence(aiFieldConfidence[field]);
      } else {
        origin = 'user_edited';          // user-entered at onboarding (no discovery/AI trace)
      }

      return { field, label, why, value, origin, confidence, editable: true };
    });

    return { companyId, generatedAt, fields };
  } catch {
    return empty;
  }
}

function extractDiscoveredProvenance(reportSettings: unknown): Record<string, FieldProvenance> {
  try {
    const dm = (reportSettings as { discovered_metadata?: { provenance?: unknown } } | null)?.discovered_metadata;
    const prov = dm?.provenance;
    return prov && typeof prov === 'object' ? (prov as Record<string, FieldProvenance>) : {};
  } catch {
    return {};
  }
}

function readAiConfidence(entry: unknown): FieldProvenance['confidence'] | null {
  if (entry && typeof entry === 'object') {
    const c = (entry as { confidence?: unknown }).confidence;
    if (c === 'low' || c === 'medium' || c === 'high') return c;
    if (typeof c === 'number') return c >= 0.75 ? 'high' : c >= 0.4 ? 'medium' : 'low';
  }
  return 'medium';
}
