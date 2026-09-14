/**
 * DT-C3 — CLI: audit and seal the U1 v2 dataset.
 *
 *   npx tsx backend/evaluation/canonicalGrounding/sealU1Dataset.ts
 *   npx tsx backend/evaluation/canonicalGrounding/sealU1Dataset.ts --verify
 *
 * `--verify` seals twice and asserts the hash and bytes are identical — an
 * ENGINEERING REPRODUCIBILITY CHECK ONLY. It measures nothing about grounding.
 *
 * Calls no external API, touches no production state, and writes exactly one
 * file into the non-production evaluation artifacts directory.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import {
  loadU1Dataset002, u1DatasetSpecs,
  U1_DATASET_ID, U1_DATASET_VERSION, U1_DATASET_PROVENANCE_CLASS,
} from './u1Dataset002';
import {
  sealDataset, serializeDataset, auditDistinctness, auditConsistency, auditRequiredFields,
} from './u1DatasetValidator';

const OUT_FILE = join(__dirname, 'artifacts', 'u1-dataset-002.seal.json');

function main(): void {
  const verify = process.argv.includes('--verify');
  const entries = loadU1Dataset002();
  const specs = u1DatasetSpecs();
  const identity = {
    datasetId: U1_DATASET_ID,
    datasetVersion: U1_DATASET_VERSION,
    provenanceClass: U1_DATASET_PROVENANCE_CLASS,
  };

  const seal = sealDataset(entries, specs, identity);
  const d = auditDistinctness(specs);
  const c = auditConsistency(entries);
  const r = auditRequiredFields(entries);

  let reproducible: boolean | null = null;
  if (verify) {
    const again = sealDataset(loadU1Dataset002(), u1DatasetSpecs(), identity);
    reproducible = again.sha256 === seal.sha256 && again.serializedBytes === seal.serializedBytes;
  }

  const dist = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.completeness] = (acc[e.completeness] ?? 0) + 1;
    return acc;
  }, {});

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify({ seal, findings: { distinctness: d.findings, consistency: c.findings, requiredFields: r.findings } }, null, 2)}\n`, 'utf8');

  const lines = [
    'DT-C3 — U1 DATASET v2 SEAL',
    '===========================',
    `datasetId:       ${seal.datasetId}`,
    `version:         ${seal.datasetVersion}`,
    `provenance:      ${seal.provenanceClass}`,
    `companies:       ${seal.companyCount}`,
    `completeness:    rich=${dist.rich ?? 0} sparse=${dist.sparse ?? 0} none=${dist.none ?? 0}`,
    `serialized:      ${seal.serializedBytes} bytes`,
    `SHA-256:         ${seal.sha256}`,
    '',
    `audit distinctness:   ${d.passed ? 'PASS' : 'FAIL'} (${d.findings.length} finding(s))`,
    `audit consistency:    ${c.passed ? 'PASS' : 'FAIL'} (${c.findings.length} finding(s))`,
    `audit requiredFields: ${r.passed ? 'PASS' : 'FAIL'} (${r.findings.length} finding(s))`,
    `errors:               ${seal.errorCount}`,
    verify ? `reproducible:         ${reproducible ? 'YES' : 'NO'}` : 'reproducible:         (pass --verify)',
    `seal artifact:        ${OUT_FILE}`,
    '',
    'NOTE: a hash proves immutability, never quality; and these audits prove',
    'non-duplication, never semantic distinctness or authorship independence.',
    'No model was called. No U1 result exists.',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));

  for (const f of [...d.findings, ...c.findings, ...r.findings]) {
    // eslint-disable-next-line no-console
    console.log(`  [${f.severity}] ${f.code} ${f.subject}: ${f.detail}`);
  }

  if (seal.errorCount > 0) process.exit(1);
  if (verify && !reproducible) process.exit(1);
  void serializeDataset;
}

main();
