import { collectOperatorSafetyFindings } from '../../config/integrity/runtimeIntegrity';
import {
  buildReport,
  listRepoFiles,
  printReport,
  readRepoFile,
  summarizeFindings,
  type DiagnosticCheck,
} from '../_shared';

const OPERATOR_EXTENSIONS = ['.ts', '.js', '.sh'] as const;

export function collectOperatorDiagnostics(): DiagnosticCheck[] {
  const files = listRepoFiles('scripts/operator', OPERATOR_EXTENSIONS)
    .filter((file) => !file.includes('/sql/'));
  const classified = files.filter((file) => readRepoFile(file).includes('SCRIPT_CLASSIFICATION')).length;
  const safetyEntrypoints = files.filter((file) => {
    const source = readRepoFile(file);
    return source.includes('enforceOperatorSafety') || source.includes('OPERATOR MUTATION SCRIPT');
  }).length;

  return [
    {
      name: 'operator.inventory',
      severity: 'info',
      summary: `${files.length} operator script(s) scanned without execution.`,
      details: [
        `classified=${classified}`,
        `with_safety_entrypoint=${safetyEntrypoints}`,
      ],
    },
    summarizeFindings('operator.remote_safety_ordering', collectOperatorSafetyFindings()),
  ];
}

export function runOperatorDiagnostics(): void {
  printReport(buildReport('operator-safety', collectOperatorDiagnostics()));
}

if (require.main === module) {
  runOperatorDiagnostics();
}
