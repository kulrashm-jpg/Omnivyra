/**
 * PI-041-A — EMAIL SEND PATH, T1.
 *
 * The dangerous failures for a send path are all forms of sending something
 * nobody authored, to someone nobody resolved, without being able to say
 * afterwards what was sent. Each has a guard here, and the content generator —
 * being a pure deterministic function — is tested directly rather than through
 * source text.
 *
 * ─── READING RULES THESE GUARDS FOLLOW ────────────────────────────────────
 * Source text is matched after stripping comments, and SQL literals are blanked
 * by a SCANNER rather than a regex (a regex cannot tell an opening quote from a
 * closing one and blanks the code BETWEEN two literals instead — that defect made
 * a 040 ban match its own postcondition). Table names are anchored to their
 * declaration position. A positive assertion about a literal reads RAW source.
 * No guard uses `git status`.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  renderEmailContent, EmailContentError, EMAIL_CONTENT_SOURCE,
  EMAIL_CONTENT_GENERATOR_VERSION, PERSONALIZATION_FIELDS,
} from '../../services/emailEngine/emailContentGenerator';
import { EMAIL_ADDRESS_PATTERN } from '../../services/emailEngine/emailExecutionContext';

const ROOT = process.cwd();
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const sha = (rel: string): string =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);

const tsCode = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

/**
 * SQL reduced to inspectable code: comments removed and string literals blanked.
 *
 * ONE pass, because the two cannot be separated. Stripping `--` comments first
 * destroys a line containing the literal `'--.*'` — this migration has exactly
 * such a line (`regexp_replace(v, '--.*', '', 'gn')`), and a two-pass stripper
 * truncated it mid-literal, left the quote open, and inverted literal and code
 * for the whole remainder of the file. So `'` and `--` are recognised by the same
 * scanner, each knowing whether the other is already in effect.
 *
 * Dollar-quoted bodies are deliberately NOT treated as literals: the
 * postconditions live inside `DO $$ ... $$` and are exactly what these guards
 * need to read.
 */
const sqlCode = (s: string): string => {
  let out = '';
  let i = 0;
  let inLit = false;
  while (i < s.length) {
    const ch = s[i];
    if (inLit) {
      if (ch === "'") {
        if (s[i + 1] === "'") { i += 2; continue; }   // an escaped quote, still inside
        inLit = false;
      }
      i += 1;
      continue;
    }
    if (ch === "'") { inLit = true; out += "''"; i += 1; continue; }
    if (ch === '-' && s[i + 1] === '-') {             // a comment, only out here
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
};

const MIG_REL = 'supabase/migrations/20270120000001_pi_email_content_evidence.sql';
const EVIDENCE_REL = 'backend/services/emailEngine/emailContentEvidenceStore.ts';
const CONTEXT_REL = 'backend/services/emailEngine/emailExecutionContext.ts';
const GEN_REL = 'backend/services/emailEngine/emailContentGenerator.ts';
const PATH_REL = 'backend/services/emailEngine/emailSendPath.ts';
const TRANSPORT_REL = 'backend/services/leadOutreachExecution/emailTransport.ts';

const MIG_RAW = read(MIG_REL);
const MIG = sqlCode(MIG_RAW);
const EVIDENCE = tsCode(read(EVIDENCE_REL));
const CONTEXT = tsCode(read(CONTEXT_REL));
const GEN = tsCode(read(GEN_REL));
const SEND_RAW = read(PATH_REL);
const SEND = tsCode(SEND_RAW);
const TRANSPORT_RAW = read(TRANSPORT_REL);
const TRANSPORT = tsCode(TRANSPORT_RAW);

const TABLE = (MIG.match(/CREATE\s+TABLE[^;]*email_outreach_content_evidence[^;]*;/i) || [''])[0];

const person = (over: Record<string, string> = {}) => ({
  first_name: 'Ada', full_name: 'Ada Lovelace', job_title: 'Analyst',
  city: 'London', ...over,
});

// ── The reducer these guards depend on ─────────────────────────────────────

describe('041-A — the SQL reducer is correct', () => {
  // Every source-text guard below is only as trustworthy as this function, and
  // its two-pass predecessor silently inverted code and literals. So it is tested
  // directly, on the exact shapes that broke it.
  it('blanks literals and keeps code', () => {
    expect(sqlCode("SELECT a FROM t WHERE x = 'secret' AND y = 2"))
      .toBe("SELECT a FROM t WHERE x = '' AND y = 2");
  });

  it('keeps the CODE BETWEEN two literals on one line', () => {
    expect(sqlCode("f('a', keep_me, 'b')")).toBe("f('', keep_me, '')");
  });

  it('SURVIVES A LITERAL CONTAINING A COMMENT MARKER', () => {
    expect(sqlCode("v := regexp_replace(v, '--.*', '', 'gn');"))
      .toBe("v := regexp_replace(v, '', '', '');");
  });

  it('still removes a real comment, including one holding a quote', () => {
    expect(sqlCode("code_here -- don't read this\nmore_code")).toBe('code_here \nmore_code');
  });

  it('handles an escaped quote inside a literal', () => {
    expect(sqlCode("x = 'it''s fine' AND y")).toBe("x = '' AND y");
  });
});

// ── Content generation ─────────────────────────────────────────────────────

describe('041-A — the deterministic content generator', () => {
  it('renders the authored instruction as the body', () => {
    const r = renderEmailContent({ instruction: 'Following up on your funding round', personalization: person() });
    expect(r.body).toBe('Following up on your funding round');
    expect(r.subject).toBe('Following up on your funding round');
    expect(r.contentSource).toBe(EMAIL_CONTENT_SOURCE);
    expect(EMAIL_CONTENT_SOURCE).toContain(EMAIL_CONTENT_GENERATOR_VERSION);
  });

  it('IS DETERMINISTIC — the same inputs render byte-identically', () => {
    // This is load-bearing: the send path validates one render and the transport
    // performs another, and the evidence must describe the one that was sent.
    const input = { instruction: 'Hi {{first_name}}, about {{city}}', personalization: person() };
    const a = renderEmailContent(input);
    const b = renderEmailContent(input);
    expect(a).toEqual(b);
    expect(a.body).toBe('Hi Ada, about London');
  });

  it('substitutes only the authorized canonical fields', () => {
    expect([...PERSONALIZATION_FIELDS]).toEqual([
      'full_name', 'first_name', 'last_name', 'job_title',
      'department', 'seniority', 'city', 'region', 'timezone',
    ]);
    const r = renderEmailContent({
      instruction: '{{first_name}} / {{job_title}} / {{city}}', personalization: person(),
    });
    expect(r.body).toBe('Ada / Analyst / London');
    expect(r.personalizationInputs).toEqual({
      first_name: 'Ada', job_title: 'Analyst', city: 'London',
    });
  });

  it('REFUSES an unauthorized personalization field', () => {
    try {
      renderEmailContent({ instruction: 'Hi {{salary}}', personalization: person() });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EmailContentError).code).toBe('unauthorized_personalization');
    }
  });

  it('REFUSES rather than sending a gap when a value is missing', () => {
    // "Hi ," reaching a real person is the failure this prevents.
    try {
      renderEmailContent({ instruction: 'Hi {{last_name}}', personalization: person() });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EmailContentError).code).toBe('personalization_missing');
    }
  });

  it('FAILS CLOSED WITH NO INSTRUCTION — and invents nothing', () => {
    for (const instruction of [null, '', '   ']) {
      try {
        renderEmailContent({ instruction, personalization: person() });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as EmailContentError).code).toBe('instruction_missing');
      }
    }
  });

  it('the generator reads no clock, no randomness and no fallback source', () => {
    expect(GEN).not.toMatch(/Date\.now|new Date|Math\.random|randomUUID/);
    // It must never reach for the placeholder sources or a message library.
    expect(GEN).not.toMatch(/explanation/);
    expect(GEN).not.toMatch(/gtm_messages/);
    expect(GEN).not.toMatch(/ownedDbTable|supabase/);
  });

  it('derives a bounded subject from the first line', () => {
    const long = 'x'.repeat(500);
    const r = renderEmailContent({ instruction: `${long}\nsecond line`, personalization: {} });
    expect(r.subject.length).toBeLessThanOrEqual(200);
    expect(r.body).toContain('second line');
    expect(r.subject).not.toContain('second line');
  });
});

// ── Recipient ──────────────────────────────────────────────────────────────

describe('041-A — recipient resolution', () => {
  it('the address pattern accepts ordinary addresses and rejects malformed ones', () => {
    for (const ok of ['a@b.co', 'ada.lovelace+x@example.com']) {
      expect(EMAIL_ADDRESS_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ['', 'a@b', 'a b@c.com', 'a@@b.com', '<a@b.com>', 'a@b.', 'no-at-sign']) {
      expect(EMAIL_ADDRESS_PATTERN.test(bad)).toBe(false);
    }
  });

  it('resolves from unified_persons.primary_email, TENANT FIRST', () => {
    const fn = CONTEXT.slice(CONTEXT.indexOf('export async function resolveEmailRecipient'));
    expect(fn).toMatch(/\.eq\('company_id', organizationId\)[\s\S]{0,80}\.eq\('id', personId\)/);
    expect(fn).toMatch(/primary_email/);
  });

  it('FAILS CLOSED on a missing person, a missing address and an unusable address', () => {
    const fn = CONTEXT.slice(CONTEXT.indexOf('export async function resolveEmailRecipient'));
    expect(fn).toMatch(/'person_not_found'/);
    expect(fn).toMatch(/'email_missing'/);
    expect(fn).toMatch(/'email_invalid'/);
  });

  it('NO OPERATOR-RECIPIENT FALLBACK ANYWHERE', () => {
    for (const surface of [CONTEXT, SEND]) {
      expect(surface).not.toMatch(/body\.recipient|options\.recipient\s*\?\?/);
    }
    // The send path passes the CANONICAL address and nothing else.
    expect(SEND).toMatch(/recipient:\s*prepared\.recipient\.email/);
  });

  it('NO ALTERNATE ADDRESS, NO VERIFICATION MODEL, NO STALENESS POLICY', () => {
    expect(CONTEXT).not.toMatch(/alternate|secondary_email|email_verified|is_verified/i);
    expect(CONTEXT).not.toMatch(/stale|updated_at\s*<|age_days/i);
    // Positive counterpart: provenance that DOES exist is carried for audit.
    expect(CONTEXT).toMatch(/source_of_truth/);
  });

  it('unified_persons is only read, never written', () => {
    expect(CONTEXT).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });
});

// ── Execution context ──────────────────────────────────────────────────────

describe('041-A — execution context comes from the 040 handoff', () => {
  it('resolves by tenant + outreach_task_id', () => {
    const fn = CONTEXT.slice(CONTEXT.indexOf('export async function resolveEmailExecutionContext'));
    expect(fn).toMatch(/\.eq\('organization_id', organizationId\)/);
    expect(fn).toMatch(/\.eq\('outreach_task_id', outreachTaskId\)/);
    expect(fn).toMatch(/'handoff_not_found'/);
  });

  it('returns the whole chain', () => {
    for (const field of ['campaignId', 'workflowId', 'workflowVersionId',
      'executionInstanceId', 'executionPlanId', 'executionPlanStepId', 'executionTaskId',
      'subjectKind', 'subjectId', 'personId', 'executionMode',
      'workflowRequiresApproval', 'policySource']) {
      expect(CONTEXT).toContain(field);
    }
  });

  it('SUBJECT KIND COMES ONLY FROM THE HANDOFF, never from lead_id', () => {
    expect(CONTEXT).toMatch(/str\(r\.subject_kind\)/);
    expect(CONTEXT).not.toMatch(/lead_id/);
  });

  it('it does NOT duplicate the context into another table', () => {
    expect(CONTEXT).not.toMatch(/\.insert\(/);
    expect(MIG).not.toMatch(/campaign_id|workflow_id|execution_instance_id|execution_task_id/);
  });

  // NOT PORTED: pins pi-consol's bytes; the stack's own pins are in 034..040.

  it.skip('TransportRequest and the 040 bridge are untouched', () => {
    expect(sha('backend/services/leadOutreachExecution/transport.ts')).toBe('0d67e20221eb7a62');
    expect(sha('backend/services/outreachBridge/outreachBridgeStore.ts')).toBe('2984776e8c003e38');
    expect(sha('supabase/migrations/20261114000000_pi_outreach_bridge.sql'))
      .toBe('2c8aededcf77557f');
  });
});

// ── Content evidence ───────────────────────────────────────────────────────

describe('041-A — content evidence', () => {
  it('carries exactly the ratified seven columns, plus the surrogate key', () => {
    for (const col of ['organization_id', 'outreach_attempt_id', 'rendered_subject',
      'rendered_body', 'personalization_inputs', 'content_source', 'created_at']) {
      expect(TABLE).toContain(col);
    }
    // The postcondition counts the table as the database sees it: seven ratified
    // columns and `id`. T2 asserts the real count; this only pins the intent.
    expect(MIG_RAW).toMatch(/expected exactly 8 \(the 7 ratified, plus id\)/);
    expect(MIG_RAW).toMatch(/nullable column\(s\) on the evidence table/);
  });

  it('EXCLUDES execution_task_id and provider_message_id, deliberately', () => {
    expect(TABLE).not.toMatch(/execution_task_id/);
    expect(TABLE).not.toMatch(/provider_message_id/);
    expect(MIG_RAW).toMatch(/excluded column\(s\) are present/);
    // The reason is recorded where a future reader will meet it.
    expect(MIG_RAW).toMatch(/only known AFTER the send/);
  });

  it('ONE EVIDENCE ROW PER ATTEMPT, database-enforced', () => {
    expect(TABLE).toMatch(/UNIQUE\s*\(\s*organization_id,\s*outreach_attempt_id\s*\)/i);
    expect(MIG_RAW).toMatch(/one-evidence-per-attempt is unenforced/);
  });

  it('IS UNCONDITIONALLY IMMUTABLE', () => {
    const g = MIG_RAW.slice(MIG_RAW.indexOf('FUNCTION public.email_outreach_content_evidence_guard'));
    expect(g).toMatch(/TG_OP = 'UPDATE'/);
    expect(g).toMatch(/is immutable/);
    // And the store exposes no update and no delete, now or by accident later.
    expect(EVIDENCE).not.toMatch(/\.update\(|\.delete\(/);
    expect(EVIDENCE).not.toMatch(/export async function (update|delete|replace)/i);
  });

  it('the tenant guard compares against the attempt owner', () => {
    const g = MIG_RAW.slice(MIG_RAW.indexOf('FUNCTION public.email_outreach_content_evidence_guard'));
    expect(g).toMatch(/FROM public\.outreach_attempts WHERE id = NEW\.outreach_attempt_id/);
    expect(g).toMatch(/belongs to another tenant/);
    expect(TABLE).toMatch(/REFERENCES public\.outreach_attempts \(id\)/);
  });

  it('it is NOT message versioning', () => {
    for (const surface of [MIG, EVIDENCE]) {
      expect(surface).not.toMatch(/gtm_messages|message_versions|template/i);
    }
    expect(MIG_RAW).toMatch(/J-5 is deferred/);
  });

  it('the store creates once and never overwrites', () => {
    expect(EVIDENCE).toMatch(/export async function recordEmailContentEvidence/);
    expect(EVIDENCE).toMatch(/'evidence_exists'/);
    expect(EVIDENCE).toMatch(/23505/);
    // It does not own the attempt.
    expect(EVIDENCE).not.toMatch(/appendAttempt|attempt_number|buildIdempotencyKey/);
  });

  it('041-A ADDED EXACTLY ONE MIGRATION AND ONE TABLE', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.filter((f) => /_pi_email_content_evidence\.sql$/.test(f)))
      .toEqual(['20270120000001_pi_email_content_evidence.sql']);
    expect((MIG.match(/CREATE\s+TABLE/gi) || []).length).toBe(1);
    const BANNED = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(message_versions?|gtm_message_versions?|email_threads?|email_conversations?|email_templates?)\b/i;
    expect(files.filter((f) =>
      BANNED.test(fs.readFileSync(path.join(dir, f), 'utf8')))).toEqual([]);
    expect(BANNED.test('CREATE TABLE public.email_threads (')).toBe(true);
  });
});

// ── The send boundary ──────────────────────────────────────────────────────

describe('041-A — the send boundary', () => {
  it('RENDER, THEN EVIDENCE, THEN THE PROVIDER — in that order', () => {
    const send = TRANSPORT_RAW.slice(TRANSPORT_RAW.indexOf('async send(request: TransportRequest)'));
    const iContent = send.indexOf('options.content(request)');
    const iRecord = send.indexOf('options.recordContent(');
    const iProvider = send.indexOf('provider.send(');
    expect(iContent).toBeGreaterThan(-1);
    expect(iRecord).toBeGreaterThan(iContent);
    expect(iProvider).toBeGreaterThan(iRecord);
  });

  it('A FAILURE TO RECORD ABORTS THE SEND', () => {
    const send = TRANSPORT_RAW.slice(TRANSPORT_RAW.indexOf('async send(request: TransportRequest)'));
    expect(send).toMatch(/content_evidence_unrecorded/);
    expect(send).toMatch(/Evidence first, send second/);
  });

  it('AN UNRENDERABLE TASK IS REJECTED, never silently placeheld', () => {
    const send = TRANSPORT_RAW.slice(TRANSPORT_RAW.indexOf('async send(request: TransportRequest)'));
    expect(send).toMatch(/content_unavailable/);
    // The catch must not fall back to the placeholder derivation.
    const block = send.slice(send.indexOf('if (options.content)'), send.indexOf('if (options.recordContent'));
    expect(block).not.toMatch(/task\.explanation/);
  });

  it('the default path is UNCHANGED when no hook is supplied', () => {
    // Every pre-041-A behaviour is preserved: the placeholder derivation remains.
    expect(TRANSPORT).toMatch(/trim\(request\.task\.action, 200\) \|\| 'Following up'/);
    expect(TRANSPORT).toMatch(/trim\(request\.task\.explanation, 4000\) \|\| subject/);
    expect(TRANSPORT).toMatch(/if \(options\.content\)/);
    expect(TRANSPORT).toMatch(/if \(options\.recordContent/);
  });

  // NOT PORTED: main's unsubscribe block throws inside its own try/catch; the no-throw behaviour is exercised in piEmailSendBoundary041a.

  it.skip('the transport contract is respected — it still never throws', () => {
    const send = TRANSPORT_RAW.slice(TRANSPORT_RAW.indexOf('async send(request: TransportRequest)'));
    // Both new failure paths RETURN a classified outcome rather than throwing.
    expect(send).toMatch(/reason: 'content_unavailable' \},\s*\n\s*error:/);
    expect(send).toMatch(/reason: 'content_evidence_unrecorded' \},/);
    expect(send).not.toMatch(/throw new/);
  });
});

// ── Common governance preservation ─────────────────────────────────────────

describe('041-A — the common path remains authoritative', () => {
  it('the send path calls the EXISTING dispatcher and nothing else', () => {
    expect(SEND).toMatch(/dispatchInternalOutreachTask\(/);
    expect(SEND).not.toMatch(/transport\.send\(|resolveTransport\(/);
  });

  it('NO GATE IS DUPLICATED OR EVALUATED IN EMAIL', () => {
    for (const surface of [SEND, CONTEXT, GEN, EVIDENCE]) {
      expect(surface).not.toMatch(/evaluateGovernance|evaluateTaskGovernance|evaluateSuppression|evaluateRateLimit|reserveQuota/);
      expect(surface).not.toMatch(/mayContact\s*\(/);
      expect(surface).not.toMatch(/kill_switch|suppression|rate_limit/);
    }
  });

  it('NO SECOND APPROVAL PATH, AND AUTONOMY DECIDES NOTHING HERE', () => {
    for (const surface of [SEND, CONTEXT, EVIDENCE]) {
      expect(surface).not.toMatch(/outreach_approvals|appendApproval|awaiting_approval/);
    }
    // `execution_mode` is recorded, never branched on.
    expect(SEND).not.toMatch(/if\s*\([^)]*executionMode\s*===/);
    expect(SEND).toMatch(/execution_mode: prepared\.context\.executionMode/);
    expect(SEND_RAW).toMatch(/Autonomy is not permission|AUTONOMY IS NOT PERMISSION/i);
  });

  it('NO DIRECT PROVIDER OR SES CALL, AND NO SECOND TRANSPORT', () => {
    // Word-anchored, not substring: an unanchored "ses" matches `uses`,
    // `responses` and `classes`, which is how a ban starts reporting its own
    // prose instead of a defect.
    const BANS: readonly RegExp[] = [
      /\bSES\b/, /\bsendgrid\b/i, /\bsmtp\b/i, /\bnodemailer\b/i, /\baws-sdk\b/i,
      /send-transactional-email/, /functions\s*\.\s*invoke/,
      /\bEmailProviderPort\b/, /\bcreateEmailTransport\b/, /\bregisterTransport\b/,
    ];
    for (const surface of [SEND, CONTEXT, GEN, EVIDENCE]) {
      for (const ban of BANS) expect(surface).not.toMatch(ban);
    }
    // Non-vacuous: each ban demonstrably fires on the thing it forbids.
    const PROOF = 'SES sendgrid smtp nodemailer aws-sdk send-transactional-email '
      + 'functions.invoke EmailProviderPort createEmailTransport registerTransport';
    for (const ban of BANS) expect(PROOF).toMatch(ban);
  });

  // NOT PORTED: pins pi-consol's dispatch bytes; piOutreachBridge040 pins main's.

  it.skip('IDEMPOTENCY IS NOT REINVENTED', () => {
    for (const surface of [SEND, CONTEXT, GEN, EVIDENCE]) {
      expect(surface).not.toMatch(/buildIdempotencyKey|idempotencyKey\s*=/);
    }
    // The attempt and its key stay with Common Outreach. Re-pinned by PI-041-A-H,
    // which widened the CLAIM's starting state and touched neither the attempt
    // numbering nor `buildIdempotencyKey`.
    expect(sha('backend/services/leadOutreachExecution/dispatch.ts')).toBe('4cee6514d36c371e');
  });

  it('PREPARATION PRECEDES DISPATCH, so an unsendable task leaves no attempt', () => {
    const fn = SEND.slice(SEND.indexOf('export async function sendEmailForOutreachTask'));
    const iPrepare = fn.indexOf('prepareEmailSend(');
    const iDispatch = fn.indexOf('dispatchInternalOutreachTask(');
    expect(iPrepare).toBeGreaterThan(-1);
    expect(iDispatch).toBeGreaterThan(iPrepare);
  });
});

// ── Frozen artefacts ───────────────────────────────────────────────────────

describe('041-A — frozen artefacts are untouched', () => {
  // NOT PORTED: pins pi-consol's WS-3; main's are pinned in piOutreachBridge040.
  it.skip('the legacy outreach substrate is byte-identical', () => {
    // Re-pinned by PI-041-A-H: `evaluateEligibility` was widened under explicit
    // authorization. No gate was added, removed or reordered.
    expect(sha('backend/services/leadOutreachExecution/governance.ts')).toBe('5982e2eb5a1f4199');
    expect(sha('backend/services/leadOutreachExecution/approval.ts')).toBe('4ef1acc19f3feb64');
    expect(sha('backend/services/leadOutreachExecution/quota.ts')).toBe('2336cc888a1f1f2b');
    expect(sha('backend/services/leadOutreachExecution/storage.ts')).toBe('b1bd8e67651a7231');
    expect(sha('backend/services/leadOutreachExecution/personAnchor.ts')).toBe('7459e807986f20a6');
    // Re-pinned by ENG-003/G-16 under explicit authorization: `complaint` was
    // ADDED to `FEEDBACK_SIGNALS` and `BUSINESS_SIGNALS`. Nothing else in the
    // module moved — no axis reassigned, no rejection relaxed, no idempotency key
    // altered, and `rejected` remains deliberately non-ingestible. The vocabulary
    // itself is pinned exactly in `ws3Milestone7Feedback`, so a further silent
    // addition still fails there as well as here.
    expect(sha('backend/services/leadOutreachExecution/feedbackIngestion.ts'))
      .toBe('c46ed8f4a7a83a70');
  });

  // NOT PORTED: pins pi-consol's bytes; the stack's own pins are in 034..040.

  it.skip('032 through 040 are byte-identical', () => {
    expect(sha('backend/services/workflows/workflowStore.ts')).toBe('27c53b4f55984059');
    expect(sha('supabase/migrations/20261110000000_pi_workflow_definitions.sql'))
      .toBe('c38b273336c2f179');
    expect(sha('supabase/migrations/20261112000000_pi_execution_plans.sql'))
      .toBe('b5ce18f36296974e');
    expect(sha('supabase/migrations/20261113000000_pi_execution_step_scheduling.sql'))
      .toBe('61dee239756473d4');
  });

  it('the migration alters NO EXISTING table', () => {
    // Scoped rather than absolute: the new table legitimately ALTERs itself to
    // enable RLS. So every ALTER target must be the table 041-A owns — and the
    // match set must be non-empty, or the guard would pass on a file it misread.
    const targets = [...MIG.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-z0-9_.]+)/gi)]
      .map((m) => m[1].toLowerCase());
    expect(targets.length).toBeGreaterThan(0);
    expect([...new Set(targets)]).toEqual(['public.email_outreach_content_evidence']);
    // And the postconditions assert it from the database's side, not the file's:
    // the column count, the EXACT pre-existing uniqueness set, and the absence of
    // the companion key a composite FK would have needed.
    expect(MIG_RAW).toMatch(/it was altered/);
    expect(MIG_RAW).toMatch(/uniqueness on outreach_attempts changed/);
    expect(MIG_RAW).toMatch(/a companion key was added to outreach_attempts/);
    expect(MIG_RAW).toMatch(/'outreach_attempts_unique'/);
  });

  it('NO WEBHOOK, THREAD OR INBOUND WORK WAS ADDED', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[] = [];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e);
        let st: fs.Stats;
        try { st = fs.statSync(p); } catch { continue; }
        if (st.isDirectory()) { walk(p); continue; }
        if (!e.endsWith('.ts')) continue;
        if (/email/i.test(e) && /webhook|bounce|inbound|thread/i.test(e)) {
          offenders.push(path.relative(ROOT, p).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(ROOT, 'pages/api'));
    expect(offenders).toEqual([]);
    // And the Email Engine itself contains no inbound concern.
    for (const surface of [SEND, CONTEXT, GEN, EVIDENCE]) {
      expect(surface).not.toMatch(/webhook|bounce|unsubscribe|inbound|thread|conversation/i);
    }
  });

  it('the Email Engine is exactly five modules and no route', () => {
    // 041-A shipped four. 041-A-E added `workflowEmailDispatch.ts`, the production
    // caller — a caller, not a second send implementation, which its own suite
    // proves by banning every gate, render and provider reference from it.
    expect(fs.readdirSync(path.join(ROOT, 'backend/services/emailEngine')).sort())
      .toEqual([
        'emailContentEvidenceStore.ts', 'emailContentGenerator.ts',
        'emailExecutionContext.ts', 'emailSendPath.ts', 'workflowEmailDispatch.ts',
      ]);
  });
});
