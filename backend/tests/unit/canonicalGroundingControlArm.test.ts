/**
 * DT-C1 — ungrounded control-arm invariants.
 *
 * These tests prove ENGINEERING properties only: the control exists, is callable,
 * covers the dataset, is byte-reproducible, calls no provider, mutates no
 * production state, and is genuinely distinct from the grounded intervention.
 *
 * They deliberately assert NOTHING about accuracy, hallucination, grounding
 * efficacy, human preference, superiority, or statistical significance. Those
 * belong to later experimental stages and must not be inferred from this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  UNGROUNDED_ARM,
  EMPTY_GROUNDING,
  executeUngroundedArm,
  runControlArm,
  serializeControlArm,
  offlineControlRunner,
} from '../../evaluation/canonicalGrounding/controlArm';
import { loadGoldenDataset } from '../../evaluation/canonicalGrounding/dataset';
import { WORKLOADS, projectPrompt } from '../../evaluation/canonicalGrounding/workloads';
import { DEFAULT_EXECUTION_PARAMS } from '../../evaluation/canonicalGrounding/config';

const CONTROL_SRC = join(__dirname, '../../evaluation/canonicalGrounding/controlArm.ts');

describe('DT-C1 control arm — (1) callable', () => {
  it('executes a single (workload, entry) pair', async () => {
    const [entry] = loadGoldenDataset();
    const cap = await executeUngroundedArm(WORKLOADS[0], entry);
    expect(cap.arm).toBe(UNGROUNDED_ARM);
    expect(cap.entryId).toBe(entry.id);
    expect(typeof cap.prompt).toBe('string');
  });

  it('runs the full sweep', async () => {
    const result = await runControlArm();
    expect(result.armId).toBe('ungrounded');
    expect(result.captures.length).toBeGreaterThan(0);
  });
});

describe('DT-C1 control arm — (2) 100% dataset coverage', () => {
  it('produces exactly one output per (workload, entry), with no failures or skips', async () => {
    const dataset = loadGoldenDataset();
    const result = await runControlArm();
    const expected = dataset.length * WORKLOADS.length;

    expect(result.coverage.expected).toBe(expected);
    expect(result.captures.length).toBe(expected);
    expect(result.coverage.successful).toBe(expected);
    expect(result.coverage.failed).toBe(0);
    expect(result.coverage.skipped).toBe(0);
    expect(result.coverage.coverage).toBe(1);
  });

  it('covers every dataset entry and every workload', async () => {
    const dataset = loadGoldenDataset();
    const result = await runControlArm();
    for (const entry of dataset) {
      expect(result.captures.some((c) => c.entryId === entry.id)).toBe(true);
    }
    for (const w of WORKLOADS) {
      expect(result.captures.some((c) => c.workload === w.key)).toBe(true);
    }
  });
});

describe('DT-C1 control arm — (3) no external model API', () => {
  it('the default runner returns no text and performs no call', async () => {
    const res = await offlineControlRunner('probe', DEFAULT_EXECUTION_PARAMS);
    expect(res.text).toBeNull();
    expect(res.error).toBeNull();
  });

  it('global fetch is never invoked during a full sweep', async () => {
    const original = globalThis.fetch;
    const spy = jest.fn(() => {
      throw new Error('control arm must not perform network I/O');
    });
    // Deliberate override for the duration of the assertion.
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      await runControlArm();
    } finally {
      globalThis.fetch = original;
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('the source declares no provider SDK or network import', () => {
    const src = readFileSync(CONTROL_SRC, 'utf8');
    const imports = src.match(/^import .*$/gm) ?? [];
    for (const line of imports) {
      expect(line).not.toMatch(/openai|anthropic|node-fetch|axios|https?:/i);
    }
  });
});

describe('DT-C1 control arm — (4) no production state mutation', () => {
  it('the module performs no filesystem, database or cache writes', () => {
    const src = readFileSync(CONTROL_SRC, 'utf8');
    expect(src).not.toMatch(/writeFileSync|appendFileSync|createWriteStream/);
    expect(src).not.toMatch(/supabase|ownedDbTable|\.insert\(|\.upsert\(|\.update\(/);
    expect(src).not.toMatch(/createCache|registerCacheNamespace/);
  });

  it('does not mutate the shared empty-grounding constant', async () => {
    const [entry] = loadGoldenDataset();
    await executeUngroundedArm(WORKLOADS[0], entry);
    expect(Object.keys(EMPTY_GROUNDING)).toHaveLength(0);
    expect(Object.isFrozen(EMPTY_GROUNDING)).toBe(true);
  });

  it('does not mutate the dataset entry it is given', async () => {
    const [entry] = loadGoldenDataset();
    const before = JSON.stringify(entry);
    await executeUngroundedArm(WORKLOADS[0], entry);
    expect(JSON.stringify(entry)).toBe(before);
  });
});

describe('DT-C1 control arm — (5) byte-identical repeated execution', () => {
  it('two independent runs serialize identically', async () => {
    const a = serializeControlArm(await runControlArm());
    const b = serializeControlArm(await runControlArm());
    expect(a).toBe(b);
    expect(a.length).toBe(b.length);
  });

  it('carries no wall-clock or RNG source', () => {
    const src = readFileSync(CONTROL_SRC, 'utf8');
    // Comments mention Date.now()/Math.random() by name; strip them before asserting.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Date\.now\(\)/);
    expect(code).not.toMatch(/Math\.random\(\)/);
    expect(code).not.toMatch(/new Date\(\)/);
  });

  it('emits no latency fields (absent rather than fabricated)', async () => {
    const [entry] = loadGoldenDataset();
    const cap = await executeUngroundedArm(WORKLOADS[0], entry);
    expect(cap).not.toHaveProperty('groundingLatencyMs');
    expect(cap).not.toHaveProperty('assemblyLatencyMs');
    expect(cap).not.toHaveProperty('executionLatencyMs');
  });
});

describe('DT-C1 control arm — (6) distinct from the grounded intervention', () => {
  it('injects no grounding at all', async () => {
    const dataset = loadGoldenDataset();
    const result = await runControlArm();
    expect(result.captures.every((c) => Object.keys(c.grounding).length === 0)).toBe(true);
    expect(result.captures.every((c) => c.contextCompleteness === 0)).toBe(true);
    void dataset;
  });

  it('omits every field the grounded arms would have supplied', async () => {
    const [entry] = loadGoldenDataset();
    for (const w of WORKLOADS) {
      const cap = await executeUngroundedArm(w, entry);
      expect(cap.omittedFields).toEqual([...w.fields].sort());
      for (const field of w.fields) {
        expect(cap.prompt).not.toContain(`${field}:`);
      }
    }
  });

  it('produces a strictly shorter prompt than the legacy (profile-grounded) projection', async () => {
    const dataset = loadGoldenDataset();
    for (const w of WORKLOADS) {
      for (const entry of dataset) {
        const control = await executeUngroundedArm(w, entry);
        // The legacy arm's projection, reproduced here WITHOUT invoking the
        // grounded execution path: grounding = { ...entry.profile }.
        const legacyPrompt = projectPrompt(w, { ...entry.profile });
        expect(control.promptChars).toBeLessThanOrEqual(legacyPrompt.length);
      }
    }
  });

  it('is structurally isolated: imports none of the grounding machinery', () => {
    const src = readFileSync(CONTROL_SRC, 'utf8');
    const imports = src.match(/^import .*$/gm) ?? [];
    const joined = imports.join('\n');
    expect(joined).not.toMatch(/contextAssimilationEngine/);
    expect(joined).not.toMatch(/canonicalProfileOverlay/);
    expect(joined).not.toMatch(/canonicalContextAdapters/);
    expect(joined).not.toMatch(/groundingPolicy/);
    expect(joined).not.toMatch(/from '\.\/execute'/);
  });
});
