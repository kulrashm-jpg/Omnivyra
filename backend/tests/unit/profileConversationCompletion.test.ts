/**
 * CONVERSATION-INTELLIGENCE-001 Phase E — Completion Intelligence.
 *
 * Proves the terminal-state contract: once the knowledge CORE is satisfied the
 * orchestrator naturally STOPS interviewing and emits a handoff signal, and that
 * this decision is DELEGATED entirely to the graph's `enoughToProceed` (no second
 * completion threshold is invented here).
 *
 *   - Natural stop      — core satisfied ⇒ complete:true, nextQuestion:null, a
 *                         transition signal; it does NOT ask another question.
 *   - Not-yet-complete  — a missing core node ⇒ still asks (no false completion).
 *   - Boundary          — completion flips true EXACTLY when the last core node
 *                         lands (mirrors enoughToProceed, not re-derived).
 *   - Monotonic         — once complete it stays complete unless a correction
 *                         lowers readiness below the core set.
 *   - Additive default  — WITHOUT stopWhenEnough the Phase-C/D behaviour is
 *                         byte-identical (keeps selecting the highest-value gap),
 *                         while the transition signal is still exposed additively.
 *
 * These assert the COORDINATION contract; the core-set definition itself is
 * owned + tested by companyKnowledgeGraph.ts.
 */
import {
  orchestrateProfileConversation,
  PROFILE_CONVERSATION_HANDOFF_KEY,
} from '../../services/companyProfile/profileConversationOrchestrator';
import { profileKnowledgeReadiness, buildCompanyKnowledgeGraph } from '../../services/companyProfile/companyKnowledgeGraph';
import type { CompanyProfile } from '../../services/companyProfile/types';

const base = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  company_id: 'c1',
  ...over,
});

const highConf = (fields: string[]): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [f, 'High']));

// The core columns whose satisfaction constitutes "enough to stop interviewing".
// (Mirrors CORE_NODE_IDS in companyKnowledgeGraph, in DB-column naming.)
const CORE_COLUMNS: Record<string, string> = {
  company: 'name',
  website: 'website_url',
  industry: 'industry',
  products_services: 'products_services',
  target_audience: 'target_audience',
  unique_value: 'unique_value',
};

/** Build a profile that satisfies exactly the named core nodes at High confidence. */
function profileWithCore(nodeIds: string[]): CompanyProfile {
  const p: Record<string, unknown> = { company_id: 'c1' };
  const conf: string[] = [];
  for (const id of nodeIds) {
    const col = CORE_COLUMNS[id];
    p[col] = `value-${id}`;
    conf.push(col);
  }
  p.field_confidence = highConf(conf);
  return p as CompanyProfile;
}

const ALL_CORE = Object.keys(CORE_COLUMNS);

describe('Phase E — natural stop (core satisfied ⇒ terminate + hand off)', () => {
  test('with stopWhenEnough, a core-complete profile returns a terminal decision, not a question', () => {
    const d = orchestrateProfileConversation(profileWithCore(ALL_CORE), [], { stopWhenEnough: true });
    expect(d.complete).toBe(true);
    expect(d.nextQuestion).toBeNull();
    // handoff signal present + descriptive, not a call into a downstream system.
    expect(d.transition.ready).toBe(true);
    expect(d.transition.suggestedNext).toBe(PROFILE_CONVERSATION_HANDOFF_KEY);
    expect(typeof d.transition.suggestedNext).toBe('string');
  });

  test('the terminal decision does NOT ask about any remaining low-value node', () => {
    // content_themes / social / team are all still unknown, yet no question is emitted.
    const d = orchestrateProfileConversation(profileWithCore(ALL_CORE), [], { stopWhenEnough: true });
    expect(d.nextQuestion).toBeNull();
    expect(d.readiness.remainingGaps.length).toBeGreaterThan(0); // gaps remain, but we stop anyway
  });
});

describe('Phase E — not yet complete (a missing core node ⇒ still asks)', () => {
  test('missing one core node ⇒ NOT complete, still asks that exact gap', () => {
    // Everything except unique_value.
    const missing = ALL_CORE.filter((id) => id !== 'unique_value');
    const d = orchestrateProfileConversation(profileWithCore(missing), [], { stopWhenEnough: true });
    expect(d.enoughToProceed).toBe(false);
    expect(d.complete).toBe(false);
    expect(d.nextQuestion).not.toBeNull();
    expect(d.nextQuestion?.nodeId).toBe('unique_value'); // the outstanding core gap
    expect(d.transition.ready).toBe(false);
    expect(d.transition.suggestedNext).toBeNull();
  });

  test('an empty profile is never falsely reported complete', () => {
    const d = orchestrateProfileConversation(base(), [], { stopWhenEnough: true });
    expect(d.complete).toBe(false);
    expect(d.nextQuestion?.nodeId).toBe('company');
    expect(d.transition.ready).toBe(false);
  });
});

describe('Phase E — boundary (completion flips exactly with enoughToProceed)', () => {
  test('completion delegates to enoughToProceed, flipping true as the LAST core node lands', () => {
    // Satisfy the core one node at a time; complete must track enoughToProceed exactly.
    const satisfied: string[] = [];
    for (let i = 0; i < ALL_CORE.length; i += 1) {
      satisfied.push(ALL_CORE[i]);
      const profile = profileWithCore(satisfied);
      const d = orchestrateProfileConversation(profile, [], { stopWhenEnough: true });
      // Ground truth straight from the graph — no re-derived threshold.
      const expected = profileKnowledgeReadiness(buildCompanyKnowledgeGraph(profile)).enoughToProceed;
      expect(d.complete).toBe(expected);
      expect(d.transition.ready).toBe(expected);
      // The flip happens ONLY on the last core node, never before.
      const isLast = i === ALL_CORE.length - 1;
      expect(d.complete).toBe(isLast);
    }
  });
});

describe('Phase E — monotonic completion', () => {
  test('once complete, adding further (non-core) knowledge keeps it complete', () => {
    const core = orchestrateProfileConversation(profileWithCore(ALL_CORE), [], { stopWhenEnough: true });
    expect(core.complete).toBe(true);
    // add an extra optional field — still complete.
    const more = profileWithCore(ALL_CORE);
    (more as Record<string, unknown>).geography = 'US';
    (more.field_confidence as Record<string, string>).geography = 'High';
    const d = orchestrateProfileConversation(more, [], { stopWhenEnough: true });
    expect(d.complete).toBe(true);
    expect(d.transition.ready).toBe(true);
  });

  test('a correction that removes a core node lowers readiness below the core ⇒ no longer complete', () => {
    // Simulate a user correction that clears a previously-known core node.
    const complete = profileWithCore(ALL_CORE);
    expect(orchestrateProfileConversation(complete, [], { stopWhenEnough: true }).complete).toBe(true);

    const corrected = profileWithCore(ALL_CORE.filter((id) => id !== 'target_audience'));
    const d = orchestrateProfileConversation(corrected, [], { stopWhenEnough: true });
    expect(d.complete).toBe(false);
    expect(d.transition.ready).toBe(false);
    expect(d.nextQuestion?.nodeId).toBe('target_audience'); // re-asks the corrected-away gap
  });
});

describe('Phase E — additive default (stopWhenEnough OFF is byte-identical)', () => {
  test('WITHOUT stopWhenEnough, a core-complete profile still selects the next gap (Phase C/D behaviour)', () => {
    const profile = profileWithCore(ALL_CORE);
    const withStop = orchestrateProfileConversation(profile, [], { stopWhenEnough: true });
    const noStop = orchestrateProfileConversation(profile, []); // default
    // Default keeps interviewing the remaining lower-value gaps.
    expect(noStop.complete).toBe(false);
    expect(noStop.nextQuestion).not.toBeNull();
    // Early-stop suppresses that same question.
    expect(withStop.nextQuestion).toBeNull();
    // The transition signal is exposed additively in BOTH modes (mirrors enoughToProceed).
    expect(noStop.transition.ready).toBe(true);
    expect(noStop.transition.suggestedNext).toBe(PROFILE_CONVERSATION_HANDOFF_KEY);
  });

  test('the handoff key is a stable descriptive signal (no downstream import/call)', () => {
    expect(PROFILE_CONVERSATION_HANDOFF_KEY).toBe('campaign-strategy');
  });
});
