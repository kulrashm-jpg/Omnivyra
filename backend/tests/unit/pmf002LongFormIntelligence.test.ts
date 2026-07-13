/**
 * PMF-002 §11 — Long-form Intelligence extraction: registry completeness,
 * delegation parity (identity + deep-equal), determinism, AIC integration,
 * and backward compatibility (the engine's functions are untouched).
 */

import {
  LONG_FORM_INTELLIGENCE, LONG_FORM_INTELLIGENCE_IDS, resolveIntelligence,
  intelligenceByKind, extractedComponents,
} from '../../services/longFormIntelligence/intelligenceRegistry';
import * as validationFramework from '../../services/longFormIntelligence/validationFramework';
import * as qualityFramework from '../../services/longFormIntelligence/qualityFramework';
import * as repairFramework from '../../services/longFormIntelligence/repairFramework';
import {
  duplicationCapabilityRule, longFormValidationRuleFor, LONG_FORM_INTELLIGENCE_SERVICES,
} from '../../services/longFormIntelligence/longFormAicIntegration';

import { validateContentDuplication } from '../../services/longForm/contentDuplicationValidator';
import { computeAdaptiveRecoveryBudget } from '../../services/longForm/adaptiveRecoveryBudget';
import { scoreDifferentiation } from '../../../lib/content/longFormDifferentiationIntelligence';
import { scoreNeedsRepair } from '../../../lib/content/longFormSeoIntelligence';

const CTX = { sources: [], confidence: 0, input: {}, knowledgeAvailable: false };

describe('PMF-002 §2 — intelligence registry', () => {
  test('all components registered with correct kinds + boundaries', () => {
    expect(LONG_FORM_INTELLIGENCE_IDS.length).toBe(13);
    // inference boundaries are catalogued but not extracted (no delegate)
    expect(LONG_FORM_INTELLIGENCE.OUTLINE_PLANNER.extracted).toBe(false);
    expect(LONG_FORM_INTELLIGENCE.OUTLINE_PLANNER.invoke).toBeUndefined();
    expect(LONG_FORM_INTELLIGENCE.SECTION_REPAIR.extracted).toBe(false);
    // extracted components are deterministic with a delegate
    expect(LONG_FORM_INTELLIGENCE.DUPLICATION_DETECTOR.kind).toBe('detector');
    expect(LONG_FORM_INTELLIGENCE.DUPLICATION_DETECTOR.extracted).toBe(true);
    expect(typeof LONG_FORM_INTELLIGENCE.DUPLICATION_DETECTOR.invoke).toBe('function');
    expect(resolveIntelligence('QUALITY_SCORER')?.kind).toBe('scorer');
  });
  test('helpers project by kind and extraction', () => {
    expect(intelligenceByKind('validator').length).toBeGreaterThan(0);
    const extracted = extractedComponents();
    expect(extracted.every((c) => c.extracted && !!c.invoke)).toBe(true);
    expect(extracted.find((c) => c.id === 'OUTLINE_PLANNER')).toBeUndefined();
  });
});

describe('PMF-002 §9/§10 — delegation parity (no reimplementation)', () => {
  test('frameworks re-export the SAME function objects (identity → guaranteed parity)', () => {
    expect(validationFramework.validateContentDuplication).toBe(validateContentDuplication);
    expect(qualityFramework.scoreDifferentiation).toBe(scoreDifferentiation);
    expect(repairFramework.computeAdaptiveRecoveryBudget).toBe(computeAdaptiveRecoveryBudget);
    expect(validationFramework.scoreNeedsRepair).toBe(scoreNeedsRepair);
  });

  test('registry invoke returns identical output to the engine function; deterministic', async () => {
    const html = '<h2>Alpha</h2><p>strategy framework revenue pipeline governance execution planning outcome measurement</p><h2>Beta</h2><p>totally different content about weather gardening cooking travel photography music</p>';
    const viaRegistry = await LONG_FORM_INTELLIGENCE.DUPLICATION_DETECTOR.invoke!(html);
    const direct = validateContentDuplication(html);
    expect(viaRegistry).toEqual(direct);
    const again = await LONG_FORM_INTELLIGENCE.DUPLICATION_DETECTOR.invoke!(html);
    expect(again).toEqual(viaRegistry); // determinism
  });
});

describe('PMF-002 §8 — AIC integration (pluggable, fail-open)', () => {
  test('duplication rule flags repeated sections and passes clean content', () => {
    const dupHtml = '<h2>Alpha</h2><p>strategy framework revenue pipeline governance execution planning resource allocation measurement outcome</p><h2>Beta</h2><p>strategy framework revenue pipeline governance execution planning resource allocation measurement outcome</p>';
    const flagged = duplicationCapabilityRule({ content_html: dupHtml }, CTX as any);
    expect(typeof flagged).toBe('string');
    expect(flagged).toMatch(/duplicate_sections/);

    expect(duplicationCapabilityRule({ content_html: '<p>short clean copy</p>' }, CTX as any)).toBeNull();
  });

  test('fail-open on adapter mismatch (never breaks a capability)', () => {
    expect(duplicationCapabilityRule('not-an-object', CTX as any)).toBeNull();
    expect(duplicationCapabilityRule({}, CTX as any)).toBeNull();
  });

  test('non-sync components produce a no-op rule (null)', () => {
    const rule = longFormValidationRuleFor('QUALITY_VALIDATOR', { extract: () => ({} as any), verdict: () => 'x' });
    expect(rule({ anything: true }, CTX as any)).toBeNull();
  });

  test('exposed services are all extracted/reusable', () => {
    expect(LONG_FORM_INTELLIGENCE_SERVICES.length).toBeGreaterThan(0);
    expect(LONG_FORM_INTELLIGENCE_SERVICES.every((c) => c.extracted)).toBe(true);
  });
});
