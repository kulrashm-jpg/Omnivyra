/**
 * PHASE 4C-5B — the email governance boundary, pinned as an INVENTORY.
 *
 * All outbound email leaves through ONE chokepoint: the Supabase Edge Function
 * `send-transactional-email`, which holds the SES credentials. The 4C-5A audit
 * found four production invokers of it, and that only one of them — the Path B
 * outreach transport — evaluates contact governance before delivery.
 *
 * ─── WHAT THIS SUITE IS, AND IS NOT ───────────────────────────────────────
 * It is an inventory guard. It records WHICH invokers exist and HOW each is
 * classified today, so a new production invoker cannot be added without that
 * classification being stated. It proves the dry-run connector cannot send.
 *
 * It does NOT assert that the ungoverned account/transactional paths are
 * legally exempt from contact governance. That is an UNRESOLVED owner/legal
 * question (4C-5A §6), and this file deliberately takes no position on it.
 *
 * It also does not claim a comment enforces anything at runtime: the only
 * runtime enforcement proven anywhere lives in `ws3Milestone5bExternalDispatch`,
 * which shows the provider is never reached when governance refuses.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { dispatchEmail } from '../../services/execution/emailExecutionConnector';

const ROOT = join(__dirname, '..', '..', '..');

/**
 * How each production invoker of the Edge Function is classified TODAY.
 *
 *   prospect_outreach     governed contact. Authorization is evaluated at
 *                         dispatch, immediately before delivery, and fails
 *                         closed.
 *   account_transactional invitation, credentials, billing/credit alerts,
 *                         company-admin notices, domain-verification reminders.
 *                         Ungoverned by contact governance TODAY. Whether that
 *                         is correct is an OPEN owner/legal question — this map
 *                         records the implementation, not an approval.
 *
 * `emailService.ts` is deliberately marked `account_transactional` even though
 * it also hosts `sendActivationOutreach`: that helper is outreach-shaped and has
 * NO production caller (asserted separately below), so the file's live
 * behaviour today is account/transactional only.
 */
type InvokerClass =
  /** Governed contact: authorization evaluated at dispatch, immediately before delivery. */
  | 'prospect_outreach'
  /**
   * Account/transactional AND ruled exempt by an explicit owner decision.
   * Phase 4C-5C, E4 only: the domain-verification reminder concerns the
   * recipient's own platform account and verification status.
   */
  | 'account_transactional_exempt_decided'
  /**
   * Account/transactional and UNDECIDED. Ungoverned today; whether that is
   * correct remains an open owner/legal question. This value is an inventory
   * fact, never an approval.
   */
  | 'account_transactional_undecided';

const CLASSIFIED_INVOKERS: Readonly<Record<string, InvokerClass>> = {
  'backend/services/leadOutreachExecution/emailTransport.ts': 'prospect_outreach',
  'backend/services/emailService.ts': 'account_transactional_undecided',
  'backend/services/domainReminderService.ts': 'account_transactional_exempt_decided',
  'pages/api/cron/email-jobs.ts': 'account_transactional_undecided',
};

/** Trees that ship. `scripts/` is tooling; `supabase/functions/` is the callee, not a caller. */
const APP_DIRS = ['backend', 'lib', 'pages', 'hooks', 'components'];
/** Path-SEGMENT exclusions, never substring matches. */
const EXCLUDED_SEGMENTS = ['node_modules', '.next', 'tests', '__tests__', '__mocks__'];

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (abs: string): void => {
    let entries: string[];
    try { entries = readdirSync(abs); } catch { return; }
    for (const name of entries) {
      if (EXCLUDED_SEGMENTS.includes(name)) continue;
      const full = join(abs, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
    }
  };
  walk(join(ROOT, dir));
  return out;
};

/** Comments stripped, so a module that merely NAMES the function is not a caller. */
const code = (file: string): string =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const rel = (f: string): string => relative(ROOT, f).split(sep).join('/');

/**
 * A production INVOCATION, not a mention: `functions.invoke(` with the Edge
 * Function's name as the argument. Both the direct literal and an awaited or
 * destructured form match, because the function name is always a literal in
 * this repository — verified, and asserted by the "every invocation is visible"
 * test below.
 */
const INVOKE = /functions\s*\.\s*invoke\(\s*['"]send-transactional-email['"]/;
/** Any invoke at all, so a differently-named function cannot hide from the audit. */
const ANY_INVOKE = /functions\s*\.\s*invoke\(/;

const files = APP_DIRS.flatMap(sourceFiles);
const invokers = files.filter((f) => INVOKE.test(code(f))).map(rel).sort();

describe('4C-5B — the Edge Function invoker inventory', () => {
  it('1. the scan works: it sees a substantial tree and finds the governed transport', () => {
    // Guards every assertion below from passing because the scan found nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(invokers).toContain('backend/services/leadOutreachExecution/emailTransport.ts');
  });

  it('2. every production invoker is CLASSIFIED — a new one fails this test', () => {
    // If this fails, an invoker was added or removed. Classify it in
    // CLASSIFIED_INVOKERS and state whether contact governance applies to it.
    expect(invokers).toEqual(Object.keys(CLASSIFIED_INVOKERS).sort());
  });

  it('3. exactly ONE invoker is classified as prospect outreach', () => {
    const outreach = Object.entries(CLASSIFIED_INVOKERS)
      .filter(([, kind]) => kind === 'prospect_outreach')
      .map(([path]) => path);
    expect(outreach).toEqual(['backend/services/leadOutreachExecution/emailTransport.ts']);
  });

  it('4. every invocation in the tree names THIS Edge Function — none can hide', () => {
    // If a second Edge Function ever sends email, the narrow regex above would
    // miss it. This widens to ANY invoke and asserts the two sets agree, so the
    // inventory cannot be silently bypassed by a rename.
    const anyInvokers = files.filter((f) => ANY_INVOKE.test(code(f))).map(rel).sort();
    expect(anyInvokers).toEqual(invokers);
  });

  it('5. a comment alone is not a caller — mentions are excluded', () => {
    // Several modules discuss the Edge Function in prose. None of them is an
    // invoker, which is what comment-stripping buys.
    const mentioners = files
      .filter((f) => readFileSync(f, 'utf8').includes('send-transactional-email'))
      .map(rel);
    expect(mentioners.length).toBeGreaterThan(invokers.length);
    for (const i of invokers) expect(mentioners).toContain(i);
  });

  it('6. only E4 is a DECIDED exemption — the rest are inventory, not approval', () => {
    // Phase 4C-5C: the owner ruled the domain-verification reminder exempt.
    // The decision is E4 ONLY and must not be generalised, so the map pins
    // exactly which invoker carries it.
    const decided = Object.entries(CLASSIFIED_INVOKERS)
      .filter(([, kind]) => kind === 'account_transactional_exempt_decided')
      .map(([path]) => path);
    expect(decided).toEqual(['backend/services/domainReminderService.ts']);

    // Everything else in the category is still an OPEN question, not a
    // permission. If one of these is ever reclassified as decided, that is an
    // owner decision and this assertion is the place it becomes visible.
    const undecided = Object.entries(CLASSIFIED_INVOKERS)
      .filter(([, kind]) => kind === 'account_transactional_undecided')
      .map(([path]) => path)
      .sort();
    expect(undecided).toEqual([
      'backend/services/emailService.ts',
      'pages/api/cron/email-jobs.ts',
    ]);

    // Three of the four remain ungoverned at runtime. That is a fact about the
    // code; only E4's is also an approved position.
    const ungoverned = Object.values(CLASSIFIED_INVOKERS).filter((k) => k !== 'prospect_outreach');
    expect(ungoverned).toHaveLength(3);
  });

  it('6b. the E4 exemption did NOT add a governance call to that path', () => {
    // The decision was that no check belongs there. A comment cannot enforce
    // anything, so this asserts the runtime fact the decision rests on.
    const src = code(join(ROOT, 'backend/services/domainReminderService.ts'));
    expect(src).not.toMatch(/mayContact|isSuppressed|loadGovernanceRecords|loadTenantGovernanceRecords/);
  });
});

describe('4C-5B — activation outreach has no production caller', () => {
  it('7. `sendGovernedActivationOutreach` is unreachable, so it cannot send ungoverned', () => {
    // It is outreach-shaped and consults no contact governance, so acquiring a
    // caller is a governance decision, not a wiring detail. This test is the
    // tripwire for that.
    const callers = files
      .filter((f) => /sendGovernedActivationOutreach\s*\(/.test(code(f)))
      .map(rel)
      .filter((f) => f !== 'backend/services/activationOutreachService.ts');
    expect(callers).toEqual([]);
  });

  it('8. `sendActivationOutreach` likewise has no caller outside its own module', () => {
    const callers = files
      .filter((f) => /sendActivationOutreach\s*\(/.test(code(f)))
      .map(rel)
      .filter((f) => f !== 'backend/services/emailService.ts' && f !== 'backend/services/activationOutreachService.ts');
    expect(callers).toEqual([]);
  });
});

describe('4C-5B — the dry-run connector cannot send', () => {
  it('9. `dispatchEmail` returns a dry run and never a dispatch', async () => {
    const res = await dispatchEmail({
      campaignId: 'c-1', entityId: 'e-1', recipient: 'someone@example.test',
      message: { subject: 's', body: 'b', messageId: 'm-1' },
    });

    expect(res.dispatched).toBe(false);
    expect(res.dryRun).toBe(true);
    expect(res.idempotencyKey).toBeTruthy();
  });

  it('10. the connector module contains no live-send path at all', () => {
    const src = code(join(ROOT, 'backend/services/execution/emailExecutionConnector.ts'));
    // No Edge Function invocation, no provider client, no transport call.
    expect(ANY_INVOKE.test(src)).toBe(false);
    expect(src).not.toMatch(/sendTransactional|SESClient|SendEmailCommand|nodemailer|sendMail/);
    // ...and it is not in the invoker inventory.
    expect(invokers).not.toContain('backend/services/execution/emailExecutionConnector.ts');
  });
});
