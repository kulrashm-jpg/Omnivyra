/**
 * Operator reconciliation runner — dispatcher unit tests (no DB).
 *
 * Verifies the pure dispatch core: validation rules, provider routing,
 * argument shape per orchestrator, localhost-only guard. The orchestrators
 * are mocked via injection so this suite never touches supabase.
 *
 * Each provider's happy-path fixture (the same JSON the operator CLI uses)
 * is loaded and dispatched through a spy to verify the call shape matches
 * what the orchestrator declares in its IngestXArgs.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  validateManifest,
  dispatchReconciliation,
  assertLocalhostOnly,
  type DispatchOrchestrators,
  type ReconciliationManifest,
} from '../../services/billing/reconciliation/runnerDispatch';

const FIX_DIR = path.resolve(__dirname, '../../../scripts/reconciliation-fixtures');

function loadFixture(rel: string): unknown {
  const p = path.join(FIX_DIR, rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function makeSpyOrchestrators() {
  const spies = {
    openai:    jest.fn(async (args) => ({ status: 'ingested', run_id: 'run_openai',    adjustments_written: 1, totals: {}, warnings: [] })),
    anthropic: jest.fn(async (args) => ({ status: 'ingested', run_id: 'run_anthropic', adjustments_written: 1, totals: {}, warnings: [] })),
    gemini:    jest.fn(async (args) => ({ status: 'ingested', run_id: 'run_gemini',    adjustments_written: 1, totals: {}, warnings: [] })),
    audio:     jest.fn(async (args) => ({ status: 'ingested', run_id: 'run_audio',     adjustments_written: 1, totals: {}, warnings: [] })),
    image:     jest.fn(async (args) => ({ status: 'ingested', run_id: 'run_image',     adjustments_written: 1, totals: {}, warnings: [] })),
    stripe:    jest.fn(async (args) => ({ status: 'ingested', run_id: 'run_stripe',    adjustments_written: 1, totals: {}, summary: {}, warnings: [] })),
  };
  const orchestrators: DispatchOrchestrators = spies as unknown as DispatchOrchestrators;
  return { spies, orchestrators };
}

// ── manifest validation ─────────────────────────────────────────────────────

describe('validateManifest', () => {
  test('rejects non-object', () => {
    expect(validateManifest('foo').ok).toBe(false);
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest(undefined).ok).toBe(false);
  });

  test('rejects unsupported provider', () => {
    const r = validateManifest({ provider: 'mystery', providerInvoiceId: 'x', periodStart: 'x', periodEnd: 'x', payload: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsupported_provider/);
  });

  test('rejects missing required string fields', () => {
    const base = { provider: 'openai', payload: {}, rates: {} };
    expect(validateManifest(base).ok).toBe(false);
    expect(validateManifest({ ...base, providerInvoiceId: 'x' }).ok).toBe(false);
    expect(validateManifest({ ...base, providerInvoiceId: 'x', periodStart: 'a' }).ok).toBe(false);
    expect(validateManifest({ ...base, providerInvoiceId: 'x', periodStart: 'a', periodEnd: 'b' }).ok).toBe(true);
  });

  test('rejects missing payload', () => {
    const r = validateManifest({ provider: 'openai', providerInvoiceId: 'x', periodStart: 'a', periodEnd: 'b', rates: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing_payload');
  });

  test('rejects invalid kind per provider', () => {
    const base = { providerInvoiceId: 'x', periodStart: 'a', periodEnd: 'b', payload: {}, rates: {} };
    expect(validateManifest({ ...base, provider: 'anthropic', kind: 'mystery' }).ok).toBe(false);
    expect(validateManifest({ ...base, provider: 'gemini',    kind: 'mystery' }).ok).toBe(false);
    expect(validateManifest({ ...base, provider: 'audio',     kind: 'mystery', providerTag: 'openai_audio' }).ok).toBe(false);
    expect(validateManifest({ ...base, provider: 'image',     kind: 'mystery', providerTag: 'openai_image' }).ok).toBe(false);
    expect(validateManifest({ ...base, provider: 'stripe',    kind: 'mystery' }).ok).toBe(false);
  });

  test('requires audio providerTag from allowed set', () => {
    const base = { provider: 'audio', providerInvoiceId: 'x', periodStart: 'a', periodEnd: 'b', payload: {}, kind: 'whisper_usage', rates: {} };
    expect(validateManifest({ ...base }).ok).toBe(false);
    expect(validateManifest({ ...base, providerTag: 'mystery' }).ok).toBe(false);
    expect(validateManifest({ ...base, providerTag: 'openai_audio' }).ok).toBe(true);
    expect(validateManifest({ ...base, providerTag: 'assemblyai' }).ok).toBe(true);
  });

  test('requires image providerTag, openai_image OR image:<name>; generic needs usageEventsProviderName', () => {
    const base = { provider: 'image', providerInvoiceId: 'x', periodStart: 'a', periodEnd: 'b', payload: {}, kind: 'dalle_usage', rates: {} };
    expect(validateManifest({ ...base }).ok).toBe(false);
    expect(validateManifest({ ...base, providerTag: 'mystery' }).ok).toBe(false);
    expect(validateManifest({ ...base, providerTag: 'openai_image' }).ok).toBe(true);
    expect(validateManifest({ ...base, providerTag: 'image:imagen' }).ok).toBe(false); // missing usageEventsProviderName
    expect(validateManifest({ ...base, providerTag: 'image:imagen', usageEventsProviderName: 'imagen' }).ok).toBe(true);
  });

  test('rates required for openai/anthropic/audio/image and gemini.usage_metadata', () => {
    const base = { providerInvoiceId: 'x', periodStart: 'a', periodEnd: 'b', payload: {} };
    expect(validateManifest({ ...base, provider: 'openai' }).ok).toBe(false);
    expect(validateManifest({ ...base, provider: 'anthropic', kind: 'billing' }).ok).toBe(false);
    expect(validateManifest({ ...base, provider: 'audio', kind: 'whisper_usage', providerTag: 'openai_audio' }).ok).toBe(false);
    expect(validateManifest({ ...base, provider: 'image', kind: 'dalle_usage', providerTag: 'openai_image' }).ok).toBe(false);
    expect(validateManifest({ ...base, provider: 'gemini', kind: 'usage_metadata' }).ok).toBe(false);
    expect(validateManifest({ ...base, provider: 'gemini', kind: 'gcb_export' }).ok).toBe(true); // rates NOT required for gcb_export
    expect(validateManifest({ ...base, provider: 'stripe', kind: 'balance' }).ok).toBe(true); // stripe never needs rates
  });
});

// ── provider routing ────────────────────────────────────────────────────────

describe('dispatchReconciliation — routes to the correct orchestrator', () => {
  test.each([
    ['openai',    'openai/happy.json'],
    ['anthropic', 'anthropic/happy.json'],
    ['gemini',    'gemini/happy.json'],
    ['audio',     'audio/happy.json'],
    ['image',     'image/happy.json'],
    ['stripe',    'stripe/happy.json'],
  ] as const)('routes %s fixture to the right orchestrator with correct arg shape', async (provider, fixtureRel) => {
    const raw = loadFixture(fixtureRel);
    const validated = validateManifest(raw);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(validated.error);
    const manifest: ReconciliationManifest = validated.manifest;

    const { spies, orchestrators } = makeSpyOrchestrators();
    const outcome = await dispatchReconciliation(manifest, orchestrators);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.provider).toBe(provider);

    // Verify the called orchestrator received the right keys.
    const calledSpy = spies[provider];
    expect(calledSpy).toHaveBeenCalledTimes(1);
    const arg = calledSpy.mock.calls[0][0];
    expect(arg.providerInvoiceId).toBe(manifest.providerInvoiceId);
    expect(arg.periodStart).toBe(manifest.periodStart);
    expect(arg.periodEnd).toBe(manifest.periodEnd);
    expect(arg.payload).toEqual(manifest.payload);

    // Verify no other orchestrator was called.
    for (const k of Object.keys(spies) as Array<keyof typeof spies>) {
      if (k !== provider) expect(spies[k]).not.toHaveBeenCalled();
    }
  });

  test('openai orchestrator gets rates but NO kind field (orchestrator has no kind param)', async () => {
    const raw = loadFixture('openai/happy.json');
    const v = validateManifest(raw);
    if (!v.ok) throw new Error(v.error);
    const { spies, orchestrators } = makeSpyOrchestrators();
    await dispatchReconciliation(v.manifest, orchestrators);
    const arg = spies.openai.mock.calls[0][0];
    expect(arg.rates).toBeDefined();
    expect((arg as { kind?: string }).kind).toBeUndefined();
  });

  test('audio orchestrator gets providerTag + kind', async () => {
    const v = validateManifest(loadFixture('audio/happy.json'));
    if (!v.ok) throw new Error(v.error);
    const { spies, orchestrators } = makeSpyOrchestrators();
    await dispatchReconciliation(v.manifest, orchestrators);
    const arg = spies.audio.mock.calls[0][0];
    expect(arg.providerTag).toBe('openai_audio');
    expect(arg.kind).toBe('whisper_usage');
  });

  test('image orchestrator gets providerTag + optional usageEventsProviderName', async () => {
    const v = validateManifest(loadFixture('image/happy.json'));
    if (!v.ok) throw new Error(v.error);
    const { spies, orchestrators } = makeSpyOrchestrators();
    await dispatchReconciliation(v.manifest, orchestrators);
    const arg = spies.image.mock.calls[0][0];
    expect(arg.providerTag).toBe('openai_image');
    expect(arg.usageEventsProviderName).toBeUndefined();
  });

  test('gemini gcb_export passes projectOrgMap when provided', async () => {
    const v = validateManifest(loadFixture('gemini/happy.json'));
    if (!v.ok) throw new Error(v.error);
    const { spies, orchestrators } = makeSpyOrchestrators();
    await dispatchReconciliation(v.manifest, orchestrators);
    const arg = spies.gemini.mock.calls[0][0];
    expect(arg.projectOrgMap).toEqual({ 'proj-platform': 'org-platform' });
  });

  test('stripe orchestrator receives kind but no rates field', async () => {
    const v = validateManifest(loadFixture('stripe/happy.json'));
    if (!v.ok) throw new Error(v.error);
    const { spies, orchestrators } = makeSpyOrchestrators();
    await dispatchReconciliation(v.manifest, orchestrators);
    const arg = spies.stripe.mock.calls[0][0];
    expect(arg.kind).toBe('balance');
    expect((arg as { rates?: unknown }).rates).toBeUndefined();
  });
});

// ── fixture suite: every fixture validates ──────────────────────────────────

describe('fixtures — every committed fixture validates and dispatches', () => {
  const matrix: Array<[string, string]> = [];
  for (const provider of ['openai', 'anthropic', 'gemini', 'audio', 'image', 'stripe']) {
    for (const scenario of ['happy', 'duplicate', 'malformed', 'orphan']) {
      matrix.push([provider, scenario]);
    }
  }
  test.each(matrix)('%s/%s.json validates and dispatches without throwing', async (provider, scenario) => {
    const raw = loadFixture(`${provider}/${scenario}.json`);
    const v = validateManifest(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error(v.error);
    const { orchestrators } = makeSpyOrchestrators();
    const r = await dispatchReconciliation(v.manifest, orchestrators);
    expect(r.ok).toBe(true);
  });

  test('duplicate fixture shares providerInvoiceId with happy (replay-safety contract)', () => {
    for (const provider of ['openai', 'anthropic', 'gemini', 'audio', 'image', 'stripe']) {
      const happy = loadFixture(`${provider}/happy.json`) as { providerInvoiceId: string };
      const dup   = loadFixture(`${provider}/duplicate.json`) as { providerInvoiceId: string };
      expect(dup.providerInvoiceId).toBe(happy.providerInvoiceId);
    }
  });
});

// ── localhost guard ─────────────────────────────────────────────────────────

describe('assertLocalhostOnly', () => {
  test('rejects when SUPABASE_URL is not set', () => {
    const r = assertLocalhostOnly({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_supabase_url_set');
  });

  test('rejects when SUPABASE_URL is non-local', () => {
    const r = assertLocalhostOnly({ SUPABASE_URL: 'https://klkiseupptzbecbxwrky.supabase.co' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non_local_supabase_url_blocked/);
  });

  test('rejects when localhost but RECONCILE_LOCAL_RUNNER not set', () => {
    const r = assertLocalhostOnly({ SUPABASE_URL: 'http://127.0.0.1:54321' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/RECONCILE_LOCAL_RUNNER=1 not set/);
  });

  test('accepts 127.0.0.1 with opt-in flag', () => {
    expect(assertLocalhostOnly({ SUPABASE_URL: 'http://127.0.0.1:54321', RECONCILE_LOCAL_RUNNER: '1' }).ok).toBe(true);
  });
  test('accepts localhost with opt-in flag', () => {
    expect(assertLocalhostOnly({ SUPABASE_URL: 'http://localhost:54321', RECONCILE_LOCAL_RUNNER: '1' }).ok).toBe(true);
  });
  test('accepts NEXT_PUBLIC_SUPABASE_URL fallback', () => {
    expect(assertLocalhostOnly({ NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', RECONCILE_LOCAL_RUNNER: '1' }).ok).toBe(true);
  });
});

// ── error propagation ───────────────────────────────────────────────────────

describe('dispatchReconciliation — error propagation', () => {
  test('orchestrator throws → DispatchOutcome.ok=false with error', async () => {
    const v = validateManifest(loadFixture('openai/happy.json'));
    if (!v.ok) throw new Error(v.error);
    const orchestrators: DispatchOrchestrators = {
      openai:    jest.fn(async () => { throw new Error('synthetic_db_failure'); }) as never,
      anthropic: jest.fn() as never,
      gemini:    jest.fn() as never,
      audio:     jest.fn() as never,
      image:     jest.fn() as never,
      stripe:    jest.fn() as never,
    };
    const r = await dispatchReconciliation(v.manifest, orchestrators);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.provider).toBe('openai');
      expect(r.error).toBe('synthetic_db_failure');
    }
  });
});
