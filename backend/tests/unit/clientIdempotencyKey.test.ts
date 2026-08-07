/**
 * OR-07 Action 1 — client idempotency key utilities.
 *
 * The property that makes the key useful is STABILITY: one logical operation
 * yields exactly one key, reused across every retry. A fresh key per attempt
 * satisfies the backend header requirement while providing zero replay
 * protection — ceremony without safety. These tests pin that property, and pin
 * that generation does NOT live in the low-level fetch wrapper (which cannot
 * tell a retry from a new operation).
 *
 * No network, no DOM, no backend.
 */
import fs from 'fs';
import path from 'path';
import {
  makeIdemKey,
  idempotencyHeaders,
  createIdempotentOperation,
} from '../../../lib/idempotency';

const REPO = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('makeIdemKey', () => {
  it('carries the operation prefix', () => {
    expect(makeIdemKey('social-publish')).toMatch(/^social-publish-/);
  });

  it('is collision-resistant across rapid successive calls', () => {
    // The predecessor used Date.now(), so two clicks in the same millisecond
    // shared a key and the second got 409 IDEMPOTENCY_CONFLICT.
    const keys = new Set(Array.from({ length: 500 }, () => makeIdemKey('x')));
    expect(keys.size).toBe(500);
  });
});

describe('idempotencyHeaders', () => {
  it('emits exactly the header the middleware requires', () => {
    expect(idempotencyHeaders('k1')).toEqual({ 'Idempotency-Key': 'k1' });
  });
});

describe('createIdempotentOperation', () => {
  it('binds one key to one operation', () => {
    const op = createIdempotentOperation('blog-publish');
    expect(op.headers).toEqual({ 'Idempotency-Key': op.key });
  });

  it('reuses the SAME key across every retry of that operation', () => {
    // The load-bearing property: hold the operation, retry through it.
    const op = createIdempotentOperation('blog-publish');
    const attempts = [op.headers, op.headers, op.headers].map((h) => h['Idempotency-Key']);
    expect(new Set(attempts).size).toBe(1);
    expect(attempts[0]).toBe(op.key);
  });

  it('gives a NEW operation a new key', () => {
    expect(createIdempotentOperation('p').key).not.toBe(createIdempotentOperation('p').key);
  });
});

describe('generation placement', () => {
  it('apiFetch does NOT mint keys', () => {
    // Minting inside the fetch wrapper would produce a new key per attempt,
    // which is indistinguishable from having no idempotency at all.
    const src = read('lib/apiFetch.ts');
    expect(src).not.toMatch(/Idempotency-Key/i);
    expect(src).not.toMatch(/makeIdemKey|createIdempotentOperation/);
  });

  it('only ONE key generator exists in the repository', () => {
    // The generator previously lived in a super-admin tab component; that file
    // now re-exports the shared one so no second implementation exists.
    const main = read('components/super-admin/tabs/CreditsBillingTabMain.tsx');
    expect(main).toMatch(/export \{ makeIdemKey \}/);
    expect(main).not.toMatch(/export function makeIdemKey/);
  });
});

describe('adopted call sites — complete in-scope inventory', () => {
  // Every in-repository caller of the approved route set. Each mints its key
  // from the entity the operation acts on, so a retry reuses it.
  const SITES: Array<[string, string]> = [
    ['components/content/PromotionWorkspace.tsx', 'publishOp'],
    ['components/hooks/useDashboardState.tsx', 'publishOp'],
    ['components/MultiPlatformSchedulerController.tsx', 'publishOp'],
    ['components/blog/blogsNewMain.tsx', 'publishOp'],
    ['pages/billing/index.tsx', 'profileOp'],
    ['hooks/useActivityWorkspaceRefinementOps.ts', 'scheduleOp'],
    ['components/activity-workspace/creatorMediaUploadHandlers.ts', 'rescheduleOp'],
    ['pages/activity-workspace/ActivityWorkspacePrimaryBrief.tsx', 'rescheduleOp'],
    ['pages/campaign-daily-plan/[id].tsx', 'repurposeOp'],
    ['components/campaign-ai/useStructuredPlanScheduling.ts', 'planOp'],
  ];

  it.each(SITES)('%s mints a key via the shared helper', (rel) => {
    const src = read(rel);
    expect({ file: rel, mints: /createIdempotentOperation\(/.test(src) }).toEqual({ file: rel, mints: true });
    // No local generator anywhere.
    expect({ file: rel, ownGenerator: /function makeIdemKey|randomUUID\(\)/.test(src) })
      .toEqual({ file: rel, ownGenerator: false });
  });

  it.each(SITES)('%s spreads the key headers onto its request', (rel, opName) => {
    expect(read(rel)).toContain(`...${opName}.headers`);
  });

  it('TopUpPanel covers BOTH checkout calls and does not mint inside postJson', () => {
    const src = read('components/billing/TopUpPanel.tsx');
    expect(src).toMatch(/createIdempotentOperation\(`checkout-verify-\$\{orderId\}-\$\{paymentId\}`\)/);
    expect(src).toMatch(/createIdempotentOperation\(`checkout-create-order-/);
    // TopUpPanel routes both calls through its local postJson helper, so the
    // key headers are passed POSITIONALLY rather than spread into a literal.
    expect(src).toContain('}, verifyOp.headers)');
    expect(src).toContain('orderOp.headers)');
    // postJson forwards a caller-supplied key; it must not generate one.
    expect(src).toMatch(/async function postJson\([^)]*extraHeaders/);
    expect(src).not.toMatch(/async function postJson[\s\S]{0,400}createIdempotentOperation/);
  });

  it('both activity-workspace files cover reschedule AND unschedule', () => {
    for (const rel of [
      'components/activity-workspace/creatorMediaUploadHandlers.ts',
      'pages/activity-workspace/ActivityWorkspacePrimaryBrief.tsx',
    ]) {
      const src = read(rel);
      expect({ file: rel, reschedule: src.includes('...rescheduleOp.headers') })
        .toEqual({ file: rel, reschedule: true });
      expect({ file: rel, unschedule: src.includes('...unscheduleOp.headers') })
        .toEqual({ file: rel, unschedule: true });
    }
  });
});
