/**
 * Phase 16A — Customer Data Rehabilitation tests (pure, deterministic).
 */

import {
  buildClassificationRows,
  classifyAttribution,
  assessSignupJoinability,
  classifyProfileRootCause,
  estimateRemediatedMaturity,
} from '../../services/customerDataRehabilitationService';
import type { TenantIdentity } from '../../services/customerPopulationIntegrityService';

const ti = (over: Partial<TenantIdentity>): TenantIdentity => ({ company_id: 'c1', company_name: 'Acme', website_domain: 'acme.com', admin_email_domain: 'acme.com', domain_verified: false, ...over });

describe('buildClassificationRows', () => {
  it('produces deterministic governed rows, sorted by company_id', () => {
    const rows = buildClassificationRows([
      ti({ company_id: 'b', company_name: 'Creator Final QA mp4', website_domain: 'omnivyra.com' }),
      ti({ company_id: 'a', company_name: 'Drishiq', website_domain: 'drishiq.com', admin_email_domain: 'drishiq.com' }),
    ]);
    expect(rows.map((r) => r.company_id)).toEqual(['a', 'b']);
    expect(rows[0].classification).toBe('CUSTOMER');
    expect(rows[1].classification).toBe('QA');
    expect(rows[0].reason.length).toBeGreaterThan(0);
  });
});

describe('classifyAttribution — org_id == company_id', () => {
  const companies = new Set(['a', 'b', 'c']);
  it('ATTRIBUTABLE when all org ids are companies', () => {
    expect(classifyAttribution(['a', 'b'], companies).attribution).toBe('ATTRIBUTABLE');
  });
  it('PARTIALLY_ATTRIBUTABLE when some match', () => {
    expect(classifyAttribution(['a', 'z'], companies)).toEqual({ attribution: 'PARTIALLY_ATTRIBUTABLE', matched: 1, total: 2 });
  });
  it('UNATTRIBUTABLE when none / empty', () => {
    expect(classifyAttribution(['z'], companies).attribution).toBe('UNATTRIBUTABLE');
    expect(classifyAttribution([], companies).attribution).toBe('UNATTRIBUTABLE');
  });
});

describe('assessSignupJoinability — email-domain recovery', () => {
  it('recovers cohort via domain match when supabase_uid is empty', () => {
    const domains = new Set(['acme.com', 'beta.com']);
    const r = assessSignupJoinability([
      { email: 'x@acme.com', supabase_uid: null },
      { email: 'y@beta.com', supabase_uid: null },
      { email: 'z@unknown.com', supabase_uid: null },
    ], domains);
    expect(r.total).toBe(3);
    expect(r.currently_joinable).toBe(0);
    expect(r.recoverable).toBe(2);
    expect(r.unrecoverable).toBe(1);
    expect(r.recoverable_pct).toBe(66.7);
  });
});

describe('classifyProfileRootCause', () => {
  it('MISSING_TRIGGER: has data, never refined (the 26 unscored)', () => {
    expect(classifyProfileRootCause({ overall_confidence: 0, has_field_data: true, last_refined_at: null })).toBe('MISSING_TRIGGER');
  });
  it('FAILED_SCORING: refined but still 0', () => {
    expect(classifyProfileRootCause({ overall_confidence: 0, has_field_data: true, last_refined_at: '2026-06-01' })).toBe('FAILED_SCORING');
  });
  it('INVALID_PROFILE: no field data', () => {
    expect(classifyProfileRootCause({ overall_confidence: 0, has_field_data: false, last_refined_at: null })).toBe('INVALID_PROFILE');
  });
});

describe('estimateRemediatedMaturity', () => {
  it('excluding non-customers (integrity→100) lifts LEVEL_1 past the cap', () => {
    const e = estimateRemediatedMaturity({
      current_integrity: 13.2, current_joinability: 63.6, current_coverage: 6.6, current_telemetry: 70, current_confidence: 68.8,
      remediated_integrity: 100, remediated_joinability: 90.9, remediated_coverage: 35,
    });
    expect(e.level_current).toBe('LEVEL_1');
    expect(['LEVEL_2', 'LEVEL_3']).toContain(e.level_remediated);
    expect(e.remediated_max.foundation).toBeGreaterThan(e.current.foundation);
  });
  it('deterministic', () => {
    const args = { current_integrity: 13.2, current_joinability: 63.6, current_coverage: 6.6, current_telemetry: 70, current_confidence: 68.8, remediated_integrity: 100, remediated_joinability: 90.9, remediated_coverage: 35 };
    expect(JSON.stringify(estimateRemediatedMaturity(args))).toBe(JSON.stringify(estimateRemediatedMaturity(args)));
  });
});
