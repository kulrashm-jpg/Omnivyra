import fs from 'fs/promises';
import path from 'path';
import { loadRpaSession } from './rpaSessionStore';
import { resolveSelector, waitForAny, type ResolverCandidate } from './selectorResolver';
import { makeCancellationChecker, RpaCancelledError, type CancellationChecker } from './rpaCancellationChecker';
import { saveRpaArtifact } from './rpaArtifactStore';
import { isProbeFailure, rpaEnvReady } from './rpaEnv';
import type { RpaTask, RpaResult } from './rpaWorkerService';

/**
 * Playwright-backed RPA runner. Single place that knows how to drive a
 * real browser. Runner lifecycle:
 *
 *   - readiness probe (refuses if Playwright runtime is missing)
 *   - launch chromium headless
 *   - inject storageState (per-org session)
 *   - navigate to target
 *   - execute platform script steps
 *     · selectors go through the resilient resolver
 *     · cancel signal polled before every step → RpaCancelledError
 *   - probe post-condition
 *   - upload screenshot + index in rpa_artifacts
 *   - close browser
 *
 * Errors are returned as structured RpaResult; RpaCancelledError → a
 * failed result with error='RPA_CANCELLED' (the executor maps this to
 * `failed` via the central pipeline).
 */

export type RpaStep =
  | { kind: 'wait_for_selector'; selectors: ResolverCandidate[]; timeout?: number }
  | { kind: 'click'; selectors: ResolverCandidate[]; timeout?: number }
  | { kind: 'fill'; selectors: ResolverCandidate[]; text: string; timeout?: number }
  | { kind: 'press'; selectors: ResolverCandidate[]; key: string; timeout?: number }
  | { kind: 'type_contenteditable'; selectors: ResolverCandidate[]; text: string; timeout?: number }
  | { kind: 'wait_for_any'; selectors: ResolverCandidate[]; timeout?: number; textHeuristics?: string[] }
  | { kind: 'wait'; ms: number }
  | { kind: 'extract_platform_id'; selectors: ResolverCandidate[]; attribute?: string };

export type RpaScript = {
  targetUrl: string;
  steps: RpaStep[];
  postCondition?: {
    kind: 'selector_visible';
    selectors: ResolverCandidate[];
    timeout?: number;
    textHeuristics?: string[];
  };
};

async function loadPlaywright(): Promise<any | null> {
  try {
    const importer = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<any>;
    const pw = await importer('playwright');
    return pw;
  } catch {
    return null;
  }
}

async function checkpoint(cancelled: CancellationChecker) {
  if (await cancelled()) throw new RpaCancelledError();
}

async function runStep(page: any, step: RpaStep, cancelled: CancellationChecker): Promise<void> {
  await checkpoint(cancelled);

  switch (step.kind) {
    case 'wait_for_selector': {
      const ok = await waitForAny(page, step.selectors, { perAttemptMs: step.timeout ?? 8_000 });
      if (!ok) throw new Error(`SELECTOR_NOT_FOUND`);
      return;
    }
    case 'wait_for_any': {
      const ok = await waitForAny(page, step.selectors, {
        perAttemptMs: step.timeout ?? 8_000,
        textHeuristics: step.textHeuristics,
      });
      if (!ok) throw new Error(`SELECTOR_NOT_FOUND`);
      return;
    }
    case 'click': {
      const handle = await resolveSelector(page, step.selectors, { perAttemptMs: step.timeout ?? 8_000 });
      if (!handle) throw new Error(`SELECTOR_NOT_FOUND`);
      await handle.click({ timeout: step.timeout ?? 8_000 });
      return;
    }
    case 'fill': {
      const handle = await resolveSelector(page, step.selectors, { perAttemptMs: step.timeout ?? 8_000 });
      if (!handle) throw new Error(`SELECTOR_NOT_FOUND`);
      await handle.fill(step.text, { timeout: step.timeout ?? 8_000 });
      return;
    }
    case 'type_contenteditable': {
      const handle = await resolveSelector(page, step.selectors, { perAttemptMs: step.timeout ?? 8_000 });
      if (!handle) throw new Error(`SELECTOR_NOT_FOUND`);
      await handle.click();
      await page.keyboard.insertText(step.text);
      return;
    }
    case 'press': {
      const handle = await resolveSelector(page, step.selectors, { perAttemptMs: step.timeout ?? 8_000 });
      if (!handle) throw new Error(`SELECTOR_NOT_FOUND`);
      await handle.press(step.key);
      return;
    }
    case 'wait': {
      await page.waitForTimeout(step.ms);
      return;
    }
    case 'extract_platform_id': {
      const handle = await resolveSelector(page, step.selectors, { perAttemptMs: 4_000 });
      if (!handle) return; // extraction is best-effort; absence is not a failure
      const value = step.attribute
        ? await handle.getAttribute(step.attribute)
        : await handle.textContent();
      (page as any).__extractedPlatformId = value ?? null;
      return;
    }
  }
}

export async function runRpaScript(task: RpaTask, script: RpaScript): Promise<RpaResult> {
  const ready = await rpaEnvReady();
  if (isProbeFailure(ready)) {
    return { success: false, error: `RPA_ENV_NOT_READY:${ready.reason}` };
  }
  const pw = await loadPlaywright();
  if (!pw || !pw.chromium) {
    return { success: false, error: 'RPA_PLAYWRIGHT_NOT_INSTALLED' };
  }

  const storageState = await loadRpaSession(task.organization_id, task.platform);
  if (!storageState) {
    return { success: false, error: 'RPA_NO_SESSION' };
  }

  const cancelled = makeCancellationChecker(task.action_id);

  let browser: any = null;
  let context: any = null;
  let page: any = null;
  let platformId: string | null = null;
  try {
    await checkpoint(cancelled);
    browser = await pw.chromium.launch({ headless: true });
    context = await browser.newContext({ storageState });
    page = await context.newPage();

    await checkpoint(cancelled);
    await page.goto(script.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(500);

    for (const step of script.steps) {
      await runStep(page, step, cancelled);
    }
    platformId = (page as any).__extractedPlatformId ?? null;

    // Post-condition
    let confirmed = true;
    if (script.postCondition?.kind === 'selector_visible') {
      await checkpoint(cancelled);
      const ok = await waitForAny(page, script.postCondition.selectors, {
        perAttemptMs: script.postCondition.timeout ?? 5_000,
        textHeuristics: script.postCondition.textHeuristics,
      });
      confirmed = ok;
    }

    // Screenshot → durable storage
    let screenshotPath: string | undefined;
    let screenshotUrl: string | null = null;
    try {
      const buf: Buffer = await page.screenshot({ fullPage: false });
      const saved = await saveRpaArtifact({
        action_id: task.action_id,
        organization_id: task.organization_id,
        platform: task.platform,
        action_type: task.action_type,
        buffer: buf,
        kind: 'screenshot',
        ext: 'png',
      });
      if (saved) {
        screenshotPath = saved.object_path;
        screenshotUrl = saved.public_url ?? null;
      }
      // Best-effort local mirror for offline debugging
      try {
        const dir = process.env.RPA_SCREENSHOT_DIR || path.join(process.cwd(), 'tmp', 'rpa-screenshots');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, `${task.action_id}.png`), buf);
      } catch { /* mirror is optional */ }
    } catch { /* screenshots are audit-only */ }

    if (!confirmed) {
      return {
        success: false,
        error: 'RPA_POST_CONDITION_FAILED',
        screenshot_path: screenshotPath,
        screenshot_url: screenshotUrl ?? undefined,
      };
    }
    return {
      success: true,
      screenshot_path: screenshotPath,
      screenshot_url: screenshotUrl ?? undefined,
      platform_id: platformId ?? undefined,
    };
  } catch (err: any) {
    if (err instanceof RpaCancelledError) {
      return { success: false, error: 'RPA_CANCELLED' };
    }
    return { success: false, error: err?.message || 'RPA_SCRIPT_FAILED' };
  } finally {
    try { if (page) await page.close(); } catch { /* swallow */ }
    try { if (context) await context.close(); } catch { /* swallow */ }
    try { if (browser) await browser.close(); } catch { /* swallow */ }
  }
}
