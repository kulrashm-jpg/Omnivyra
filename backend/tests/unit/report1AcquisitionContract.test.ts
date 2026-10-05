/**
 * SLICE 3A — the acquisition contract is SHAPES ONLY.
 *
 * The mandatory property of this slice is negative: 3A must not decide or emit a posture
 * from tenant data. Types vanish at runtime, so these tests assert the runtime vocabulary
 * and, where the guarantee is structural, the module source itself.
 *
 * The product decisions locked before 3A are encoded here so a later slice cannot quietly
 * reverse them:
 *  - conversion gating uses ExperienceReadiness, not a numeric score;
 *  - a budget amount is unrepresentable in the unavailable state;
 *  - channel specificity must be evidenced, never defaulted.
 */
import fs from 'fs';
import path from 'path';
import {
  ACQUISITION_POSTURES,
  ACQUISITION_APPLICABILITIES,
  ACQUISITION_DEPENDENCY_KINDS,
  ACQUISITION_NEED_STATES,
  ORGANIC_BANDS,
  PAID_PRESENCE_STATES,
  BUDGET_POSTURES,
} from '../../services/snapshotReport/acquisitionContract';

const MODULE_PATH = 'backend/services/snapshotReport/acquisitionContract.ts';
const source = (): string => fs.readFileSync(path.join(process.cwd(), MODULE_PATH), 'utf8');

describe('3A posture vocabulary', () => {
  it('declares exactly the seven agreed postures', () => {
    expect([...ACQUISITION_POSTURES]).toEqual([
      'ORGANIC_LED',
      'ORGANIC_PLUS_CONTROLLED_PAID_PILOT',
      'PAID_SUPPORTED_URGENCY',
      'PAID_SCALE_CANDIDATE',
      'PAID_BLOCKED_BY_PREREQUISITE',
      'PAID_NOT_CURRENTLY_RECOMMENDED',
      'INSUFFICIENT_EVIDENCE',
    ]);
  });

  it('keeps "blocked by prerequisite" distinct from "not recommended"', () => {
    // These lead a customer to opposite actions. Collapsing them would be wrong advice for
    // any company with a real offer and a weak site.
    expect(ACQUISITION_POSTURES).toContain('PAID_BLOCKED_BY_PREREQUISITE');
    expect(ACQUISITION_POSTURES).toContain('PAID_NOT_CURRENTLY_RECOMMENDED');
  });

  it('names the scale state a candidate, so it cannot read as first-report reachable', () => {
    expect(ACQUISITION_POSTURES).toContain('PAID_SCALE_CANDIDATE');
    expect(ACQUISITION_POSTURES).not.toContain('PAID_ACCELERATION_RECOMMENDED');
  });
});

describe('3A decides nothing', () => {
  it('exports no function at all', () => {
    // A contract module with behaviour is a decision engine wearing a contract's name.
    const exported = require('../../services/snapshotReport/acquisitionContract');
    for (const key of Object.keys(exported)) {
      expect(typeof exported[key]).not.toBe('function');
    }
  });

  it('contains no conditional logic that could select a posture', () => {
    const body = source()
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/*'))
      .join('\n');
    expect(body).not.toMatch(/\bif\s*\(/);
    expect(body).not.toMatch(/\bswitch\s*\(/);
    expect(body).not.toMatch(/\?\?/);
  });

  it('reads no tenant data: imports only type vocabulary', () => {
    const imports = source().match(/^import .*$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line).toMatch(/^import type /);
    }
  });
});

describe('3A reuses existing contracts rather than duplicating them', () => {
  it('takes evidence state and confidence from canonicalScoreState', () => {
    expect(source()).toContain("from './canonicalScoreState'");
    expect(source()).toContain('ScoreState');
    expect(source()).toContain('ConfidenceBand');
  });

  it('takes conversion readiness from the existing ExperienceReadiness contract', () => {
    expect(source()).toContain("from '../digitalExperience'");
    expect(source()).toContain('ExperienceReadiness');
  });

  it('does not redefine ScoreState or invent a second provenance vocabulary', () => {
    expect(source()).not.toMatch(/type\s+ScoreState\s*=/);
    expect(source()).not.toMatch(/'OBSERVED_AND_MEASURABLE'/);
    expect(source()).not.toMatch(/'UNAVAILABLE_BY_PROVIDER'/);
  });

  it('keeps applicability on its own axis, separate from evidence state', () => {
    expect([...ACQUISITION_APPLICABILITIES]).toEqual([
      'relevant', 'conditional', 'not_recommended', 'undetermined',
    ]);
  });
});

describe('3A encodes the locked product decisions', () => {
  it('gates conversion on readiness, never on a numeric floor', () => {
    expect(source()).toContain('ExperienceReadiness');
    // No borrowed banding constant and no invented cutoff.
    expect(source()).not.toContain('MARKET_POSITION_BANDS');
    expect(source()).not.toContain('CANONICAL_SCORE_BANDS');
    expect(source()).not.toMatch(/THRESHOLD\s*=\s*\d+/);
  });

  it('makes a budget amount unrepresentable when unavailable', () => {
    const unavailableArm = source().slice(
      source().indexOf("{ state: 'unavailable'; posture: BudgetPosture"),
    ).split('\n')[0];
    expect(unavailableArm).toContain('unlock');
    expect(unavailableArm).not.toContain('amount');
    expect(unavailableArm).not.toContain('min');
    expect(unavailableArm).not.toContain('currency');
  });

  it('carries no currency symbol or literal anywhere in the contract', () => {
    expect(source()).not.toMatch(/[₹$€£]/);
  });

  it('expresses the learning floor in conversion events, not money', () => {
    expect(source()).toContain('expectedConversionEvents');
  });

  it('supports the three-tier channel scope', () => {
    const s = source();
    expect(s).toContain("kind: 'specific_channel'");
    expect(s).toContain("kind: 'channel_class'");
    expect(s).toContain("kind: 'unavailable'");
    // Specificity must be evidenced.
    expect(s).toMatch(/kind: 'specific_channel'; name: string; basis: string/);
  });

  it('offers no "does not advertise" presence state', () => {
    expect([...PAID_PRESENCE_STATES]).toEqual(['observed', 'none_found', 'not_observable']);
    expect(source()).not.toMatch(/does_not_advertise|'no_advertising'/);
  });

  it('separates blocking from advisory dependencies', () => {
    expect([...ACQUISITION_DEPENDENCY_KINDS]).toEqual(['blocking', 'advisory']);
  });

  it('lets organic and need remain unresolved rather than defaulting', () => {
    // 3B CORRECTION: the organic band now reuses the existing canonical vocabulary, whose
    // unresolved member is 'insufficient'. A second strong/adequate/weak/unknown taxonomy
    // would have had to be mapped at every boundary and would drift.
    expect([...ORGANIC_BANDS]).toEqual(['leading', 'operational', 'developing', 'foundational', 'insufficient']);
    expect([...ORGANIC_BANDS]).toContain('insufficient');
    expect([...ACQUISITION_NEED_STATES]).toContain('undetermined');
  });

  it('keeps scale posture distinct in the budget vocabulary', () => {
    expect([...BUDGET_POSTURES]).toEqual(['low_risk_test', 'moderate_test', 'scale_ready']);
  });
});

describe('3A pass-through slot', () => {
  it('declares the slot optional and leaves it unpopulated', () => {
    const types = fs.readFileSync(
      path.join(process.cwd(), 'backend/services/snapshotReportTypes.ts'),
      'utf8',
    );
    expect(types).toContain('acquisition_decision?:');
    // No producer may exist yet.
    const producers = fs
      .readdirSync(path.join(process.cwd(), 'backend/services/snapshotReport'))
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => fs
        .readFileSync(path.join(process.cwd(), 'backend/services/snapshotReport', f), 'utf8')
        .includes('acquisition_decision:'));
    expect(producers).toEqual([]);
  });
});
