/**
 * AI-ORCH 2B.1A — Configuration Fingerprint util contract + seed↔util lock.
 *
 * The util (configFingerprint.ts) is the SINGLE source of truth for the fingerprint.
 * These tests prove:
 *   1. determinism + key-order independence (WHY: fingerprints must be stable and
 *      not depend on field write-order);
 *   2. array order IS significant (semantic ordering, e.g. provider chains);
 *   3. surrogate ids / timestamps / audit / display fields are EXCLUDED;
 *   4. the SEED↔UTIL LOCK — recomputing the 10 seeded profile semantics reproduces
 *      exactly the fingerprints baked into the migration SQL. This makes it
 *      impossible for the seed and the util to silently drift.
 *
 * The util is DORMANT (no runtime consumer); this test is its only exercise besides
 * the offline seed-baking.
 */
import fs from 'fs';
import path from 'path';
import {
  computeConfigFingerprint,
  extractExecutionSemantics,
  canonicalConfigString,
  CONFIG_FINGERPRINT_ALGO,
  type ExecutionSemantics,
} from '../../services/aiOrchestration/configFingerprint';

const off = { moderation: 'off', prompt_injection_guard: false };

// The exact execution semantics seeded in 20260906000002 (mirrors the SQL jsonb).
const SEED: Record<string, ExecutionSemantics> = {
  HIGH_QUALITY:      { mode:'tier', quality_tier:'frontier', capability_requirements:{}, params:{temperature:0.4,max_output_tokens:4000,seed_policy:'none'}, modality:{streaming:false,structured_output:false}, reliability:{timeout_ms:120000,max_retries:2,partial_allowed:false}, limits:{}, caching:{cacheable:true}, safety:off },
  BALANCED:          { mode:'tier', quality_tier:'balanced', capability_requirements:{}, params:{temperature:0.4,max_output_tokens:2000,seed_policy:'none'}, modality:{streaming:false,structured_output:false}, reliability:{timeout_ms:60000,max_retries:2,partial_allowed:false}, limits:{}, caching:{cacheable:true}, safety:off },
  ECONOMY:           { mode:'tier', quality_tier:'economy', capability_requirements:{}, params:{temperature:0.3,max_output_tokens:1500,seed_policy:'none'}, modality:{streaming:false,structured_output:false}, reliability:{timeout_ms:30000,max_retries:1,partial_allowed:false}, limits:{}, caching:{cacheable:true}, safety:off },
  JSON_EXTRACTION:   { mode:'tier', quality_tier:'balanced', capability_requirements:{needs_structured:true}, params:{temperature:0,max_output_tokens:2000,seed_policy:'none'}, modality:{streaming:false,structured_output:true,response_format:'json_object'}, reliability:{timeout_ms:60000,max_retries:2,partial_allowed:false}, limits:{}, caching:{cacheable:true}, safety:off },
  DEEP_REASONING:    { mode:'tier', quality_tier:'frontier', capability_requirements:{}, params:{temperature:0.2,max_output_tokens:4000,reasoning_level:'high',seed_policy:'none'}, modality:{streaming:false,structured_output:false}, reliability:{timeout_ms:240000,max_retries:2,partial_allowed:true}, limits:{}, caching:{cacheable:false}, safety:off },
  CREATIVE_WRITING:  { mode:'tier', quality_tier:'high', capability_requirements:{}, params:{temperature:0.7,max_output_tokens:4000,seed_policy:'none'}, modality:{streaming:true,structured_output:false}, reliability:{timeout_ms:240000,max_retries:1,partial_allowed:true}, limits:{}, caching:{cacheable:false}, safety:off },
  GROUNDED_RESEARCH: { mode:'tier', quality_tier:'balanced', capability_requirements:{needs_search:true}, params:{temperature:0.2,max_output_tokens:2000,seed_policy:'none'}, modality:{streaming:false,structured_output:false}, reliability:{timeout_ms:60000,max_retries:2,partial_allowed:false}, limits:{}, caching:{cacheable:true}, safety:off },
  VISION_ANALYSIS:   { mode:'tier', quality_tier:'high', capability_requirements:{needs_vision:true}, params:{temperature:0,max_output_tokens:2000,seed_policy:'none'}, modality:{streaming:false,structured_output:false,vision:true}, reliability:{timeout_ms:120000,max_retries:2,partial_allowed:false}, limits:{}, caching:{cacheable:false}, safety:off },
  IMAGE_GENERATION:  { mode:'tier', quality_tier:null, capability_requirements:{needs_image_generation:true}, params:{seed_policy:'none'}, modality:{image_params:{size:'1024x1024',quality:'standard',n:1}}, reliability:{timeout_ms:120000,max_retries:1,partial_allowed:false}, limits:{}, caching:{cacheable:false}, safety:off },
  MODERATION:        { mode:'tier', quality_tier:'economy', capability_requirements:{needs_structured:true}, params:{temperature:0,max_output_tokens:256,seed_policy:'none'}, modality:{streaming:false,structured_output:true,response_format:'json_object'}, reliability:{timeout_ms:30000,max_retries:1,partial_allowed:false}, limits:{}, caching:{cacheable:false}, safety:off },
};

describe('Configuration Fingerprint util', () => {
  test('is deterministic + key-order independent', () => {
    const a: ExecutionSemantics = { mode:'tier', params:{temperature:0.4,max_output_tokens:2000}, modality:{streaming:false} };
    const b: ExecutionSemantics = { modality:{streaming:false}, params:{max_output_tokens:2000,temperature:0.4}, mode:'tier' }; // reordered keys
    expect(computeConfigFingerprint(a)).toBe(computeConfigFingerprint(b));
    expect(computeConfigFingerprint(a)).toMatch(/^sha256:v1:[0-9a-f]{64}$/);
  });

  test('null == absent (unset is canonical either way)', () => {
    const withNull: ExecutionSemantics = { mode:'tier', quality_tier:null, deployment_id:null, params:{temperature:0} };
    const without:  ExecutionSemantics = { mode:'tier', params:{temperature:0} };
    expect(computeConfigFingerprint(withNull)).toBe(computeConfigFingerprint(without));
  });

  test('array order IS significant (semantic ordering)', () => {
    const p1: ExecutionSemantics = { routing:{ providers:['openai','anthropic'] } };
    const p2: ExecutionSemantics = { routing:{ providers:['anthropic','openai'] } };
    expect(computeConfigFingerprint(p1)).not.toBe(computeConfigFingerprint(p2));
  });

  test('excludes surrogate ids / version / status / timestamps / display fields', () => {
    const base: ExecutionSemantics = { mode:'tier', quality_tier:'balanced', params:{temperature:0.4} };
    const polluted = {
      ...base,
      id: 'uuid-1', profile_id: 'uuid-2', provider_id: 'uuid-3', model_id: 'uuid-4',
      routing_policy_id: 'uuid-5', safety_policy_id: 'uuid-6',
      version: 7, status: 'active', created_by: 'u', created_at: 'now', updated_at: 'now',
      name: 'Balanced', display_name: 'Balanced', description: 'desc',
    } as unknown as ExecutionSemantics;
    expect(computeConfigFingerprint(polluted)).toBe(computeConfigFingerprint(base));
  });

  test('a real execution-semantic change DOES change the fingerprint', () => {
    const a: ExecutionSemantics = { params:{temperature:0.4} };
    const b: ExecutionSemantics = { params:{temperature:0.7} };
    expect(computeConfigFingerprint(a)).not.toBe(computeConfigFingerprint(b));
  });

  test('extractExecutionSemantics keeps only semantic fields', () => {
    const extracted = extractExecutionSemantics({ mode:'tier', params:{temperature:0}, ...( { id:'x', created_at:'t' } as any) });
    expect(Object.keys(extracted).sort()).toEqual(['mode','params']);
    expect(canonicalConfigString({ mode:'tier' })).toBe('{"mode":"tier"}');
  });

  test('algo tag is sha256:v1', () => {
    expect(CONFIG_FINGERPRINT_ALGO).toBe('sha256:v1');
  });
});

describe('SEED ↔ UTIL lock (fingerprints baked in the migration match the util)', () => {
  const migrationPath = path.join(
    __dirname, '..', '..', '..',
    'supabase', 'migrations', '20260906000004_ai_orchestration_config_fingerprint.sql',
  );
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  test.each(Object.keys(SEED))('%s: util output equals the value baked in the migration', (key) => {
    const fp = computeConfigFingerprint(SEED[key]);
    expect(fp).toMatch(/^sha256:v1:[0-9a-f]{64}$/);
    // The exact fingerprint string must appear in the migration's backfill.
    expect(migrationSql).toContain(fp);
    // ...on the same VALUES line as its profile key (guards against a swap).
    const line = migrationSql.split('\n').find((l) => l.includes(`'${key}'`) && l.includes('sha256:v1:'));
    expect(line).toBeDefined();
    expect(line).toContain(fp);
  });

  test('the migration bakes exactly 10 profile fingerprints', () => {
    const matches = migrationSql.match(/sha256:v1:[0-9a-f]{64}/g) ?? [];
    // 10 in the VALUES table (the header/comment references the algo tag without a hash).
    const unique = new Set(matches);
    expect(unique.size).toBe(10);
  });
});
