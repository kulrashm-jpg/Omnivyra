/**
 * CHARACTERIZATION SUITE — backend/services/longForm/longFormGenerationOrchestrator.ts
 * (runLongFormGenerationOrchestrator).
 *
 * The repo already contained three complete scenario harnesses for this
 * orchestrator — generationExecutionStressTests, factualIntegrityStressTests,
 * groundedIntegrityStressTests — with fixture builders and ~40 scripted
 * SectionGenerators covering degradation, recovery, hallucination, grounding,
 * and citation behavior. They were DORMANT: nothing imported them, so none of
 * that coverage ran in CI. This test wires them into jest.
 *
 * ZERO mocks: the orchestrator's generation dependency is injected
 * (SectionGenerator), and its entire import graph is pure governance logic —
 * no DB, no network, no AI, no config. Every layer (continuity governor,
 * generic-writing suppression, claim extraction, hallucination suppression,
 * trust calibration, citation orchestration, recovery coordination, …) runs
 * REAL.
 *
 * The snapshots lock the per-scenario verdict map. If an intentional
 * governance change flips a scenario, update the snapshot deliberately —
 * a silent flip is a behavior regression in the long-form quality gates.
 */

import {
  runGenerationExecutionStressTests,
} from '../../services/longForm/generationExecutionStressTests';
import {
  runFactualIntegrityStressTests,
} from '../../services/longForm/factualIntegrityStressTests';
import {
  runGroundedIntegrityStressTests,
} from '../../services/longForm/groundedIntegrityStressTests';

jest.setTimeout(180_000);

type ScenarioLike = { scenario: string; passed: boolean; assertions: Array<{ name: string; passed: boolean }> };

const verdictMap = (scenarios: ScenarioLike[]) =>
  scenarios.map((s) => ({
    scenario: s.scenario,
    passed: s.passed,
    assertions: s.assertions.map((a) => ({ name: a.name, passed: a.passed })),
  }));

describe('long-form orchestrator — execution stress scenarios (real stack, injected generators)', () => {
  it('locks the current verdict of all execution scenarios', async () => {
    const report = await runGenerationExecutionStressTests();
    expect(report.overall.total).toBe(report.scenarios.length);
    // Golden master of every scenario + assertion verdict.
    expect(verdictMap(report.scenarios)).toMatchSnapshot('execution-verdicts');
    expect(report.overall).toMatchSnapshot('execution-overall');
  });
});

describe('long-form orchestrator — factual integrity scenarios', () => {
  it('locks the current verdict of all factual-integrity scenarios', async () => {
    const report = await runFactualIntegrityStressTests();
    expect(verdictMap(report.scenarios as unknown as ScenarioLike[])).toMatchSnapshot('factual-verdicts');
    expect(report.overall).toMatchSnapshot('factual-overall');
  });
});

describe('long-form orchestrator — grounded integrity scenarios', () => {
  it('locks the current verdict of all grounded-integrity scenarios', async () => {
    const report = await runGroundedIntegrityStressTests();
    expect(verdictMap(report.scenarios as unknown as ScenarioLike[])).toMatchSnapshot('grounded-verdicts');
    expect(report.overall).toMatchSnapshot('grounded-overall');
  });
});
