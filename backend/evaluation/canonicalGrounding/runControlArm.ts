/**
 * DT-C1 — CLI entry point for the ungrounded control arm.
 *
 * This is the "caller" referred to by report.ts's architectural rule ("no
 * filesystem writes — the caller decides where to persist"). The control-arm
 * module itself stays pure; persistence happens here and ONLY here.
 *
 * Invocation:
 *   npx tsx backend/evaluation/canonicalGrounding/runControlArm.ts
 *   npx tsx backend/evaluation/canonicalGrounding/runControlArm.ts --verify
 *
 * `--verify` executes the control TWICE and asserts the serialized outputs are
 * byte-identical. That is an ENGINEERING REPRODUCIBILITY CHECK ONLY — it is not
 * an experiment, and it measures nothing about grounding efficacy.
 *
 * Writes exactly one file, under backend/evaluation/, never to a production
 * location, a production table, or production telemetry. Calls no external API.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { runControlArm, serializeControlArm, fingerprint } from './controlArm';

/** Non-production output location, alongside the evaluation infrastructure. */
const OUT_DIR = join(__dirname, 'artifacts');
const OUT_FILE = join(OUT_DIR, 'control-arm-ungrounded.json');

async function main(): Promise<void> {
  const verify = process.argv.includes('--verify');

  const run1 = await runControlArm();
  const ser1 = serializeControlArm(run1);
  const fp1 = fingerprint(ser1);

  let reproducible: boolean | null = null;
  let fp2: string | null = null;

  if (verify) {
    const run2 = await runControlArm();
    const ser2 = serializeControlArm(run2);
    fp2 = fingerprint(ser2);
    reproducible = ser1 === ser2 && ser1.length === ser2.length;
  }

  const c = run1.coverage;
  const pct = (c.coverage * 100).toFixed(2);

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, ser1, 'utf8');

  // Report to stdout. No efficacy claim is made or implied anywhere here.
  const lines = [
    'DT-C1 — UNGROUNDED CONTROL ARM',
    '================================',
    `arm:            ${run1.armId}`,
    `dataset:        ${run1.datasetId}`,
    `entries:        ${c.datasetEntries}`,
    `workloads:      ${c.workloads}`,
    `expected:       ${c.expected}`,
    `successful:     ${c.successful}`,
    `failed:         ${c.failed}`,
    `skipped:        ${c.skipped}`,
    `coverage:       ${pct}%`,
    `serialized:     ${ser1.length} bytes`,
    `fingerprint:    ${fp1}`,
    verify ? `fingerprint#2:  ${fp2}` : 'fingerprint#2:  (not run — pass --verify)',
    verify ? `byte-identical: ${reproducible ? 'YES' : 'NO'}` : 'byte-identical: (not checked)',
    `artifact:       ${OUT_FILE}`,
    '',
    'NOTE: engineering reproducibility only. No experiment was executed, no',
    'quality was scored, and no external model API was called.',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));

  if (c.successful !== c.expected) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: coverage ${c.successful}/${c.expected} is not 100%`);
    process.exit(1);
  }
  if (verify && !reproducible) {
    // eslint-disable-next-line no-console
    console.error('FAIL: repeated execution was not byte-identical');
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
