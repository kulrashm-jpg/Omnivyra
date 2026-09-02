import dotenv from 'dotenv';
import path from 'path';
import {
  exitWarnOnly,
  fileExists,
  IntegrityFinding,
  listFiles,
  looksLocal,
  parseProjectRef,
  readRepoFile,
} from './integrityUtils';

const ENV_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
] as const;

export function collectEnvironmentIntegrityFindings(env = process.env): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const values = ENV_KEYS
    .map((key) => ({ key, value: env[key], projectRef: parseProjectRef(env[key]) }))
    .filter((entry) => entry.value);

  const refs = [...new Set(values.map((entry) => entry.projectRef).filter(Boolean) as string[])];
  if (refs.length > 1) {
    findings.push({
      severity: 'warning',
      code: 'MIXED_SUPABASE_PROJECT_REFS',
      message: `Multiple Supabase project refs detected in current env: ${refs.join(', ')}`,
      recommendation: 'Verify REST and DB URLs point to the same project before running app, CI, or operator tools.',
    });
  }

  const localMode = env.NODE_ENV === 'development' || env.VERCEL_ENV === 'development' || env.OPERATOR_TARGET_ENV === 'local';
  if (localMode) {
    const remoteValues = values.filter((entry) => !looksLocal(entry.value));
    if (remoteValues.length > 0) {
      findings.push({
        severity: 'warning',
        code: 'LOCAL_ENV_POINTS_REMOTE',
        message: `Local/development mode has non-local Supabase value(s): ${remoteValues.map((entry) => entry.key).join(', ')}`,
        recommendation: 'Use local Supabase URLs for local mutation workflows, or run operator tools with explicit target env and confirmation.',
      });
    }
  }

  if (env.SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_URL) {
    const serverRef = parseProjectRef(env.SUPABASE_URL);
    const publicRef = parseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
    if (serverRef && publicRef && serverRef !== publicRef) {
      findings.push({
        severity: 'warning',
        code: 'SERVER_PUBLIC_SUPABASE_MISMATCH',
        message: `SUPABASE_URL (${serverRef}) and NEXT_PUBLIC_SUPABASE_URL (${publicRef}) differ.`,
        recommendation: 'Align public and server Supabase URLs unless this is an intentional split environment.',
      });
    }
  }

  if (fileExists('scripts/_core/operatorSafety.ts')) {
    const operatorSafety = readRepoFile('scripts/_core/operatorSafety.ts');
    for (const token of ['requireTargetEnvironment', 'requireExplicitMutationIntent', 'detectRemoteSupabase']) {
      if (!operatorSafety.includes(token)) {
        findings.push({
          severity: 'warning',
          code: 'OPERATOR_SAFETY_HELPER_MISSING',
          message: `operatorSafety.ts no longer contains ${token}.`,
          file: 'scripts/_core/operatorSafety.ts',
          recommendation: 'Restore the warn-only operator environment guard helper before running mutation-capable tools.',
        });
      }
    }
  }

  const workflow = fileExists('.github/workflows/auth-integrity.yml')
    ? readRepoFile('.github/workflows/auth-integrity.yml')
    : '';
  const declaresServerKey =
    workflow.includes('SUPABASE_SECRET_KEY') || workflow.includes('SUPABASE_SERVICE_ROLE_KEY');
  if (workflow && (!workflow.includes('NEXT_PUBLIC_SUPABASE_URL') || !declaresServerKey)) {
    findings.push({
      severity: 'warning',
      code: 'AUTH_CI_ENV_CONTRACT_WEAKENED',
      message: 'Auth integrity workflow no longer references expected Supabase env secrets.',
      file: '.github/workflows/auth-integrity.yml',
      recommendation: 'Keep auth CI env explicit so test runtime cannot silently drift.',
    });
  }

  findings.push(...collectVercelVisibilityFindings());

  return findings;
}

export function collectVercelVisibilityFindings(): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const candidateFiles = [
    'vercel.json',
    '.vercel/project.json',
    '.env.local',
    '.env.production',
    '.env.preview',
  ].filter(fileExists);

  for (const workflow of listFiles('.github/workflows', ['.yml', '.yaml'])) {
    candidateFiles.push(workflow);
  }

  const refsByFile = new Map<string, string[]>();
  for (const file of candidateFiles) {
    const source = readRepoFile(file);
    const refs = [...source.matchAll(/https:\/\/([a-z0-9-]+)\.supabase\.co/gi)]
      .map((match) => match[1].toLowerCase());
    if (refs.length > 0) refsByFile.set(file, [...new Set(refs)]);
  }

  const allRefs = [...new Set([...refsByFile.values()].flat())];
  if (allRefs.length > 1) {
    findings.push({
      severity: 'warning',
      code: 'STATIC_CONFIG_MIXED_SUPABASE_REFS',
      message: `Static config/workflow files contain multiple Supabase refs: ${allRefs.join(', ')}`,
      recommendation: 'Confirm these refs represent intentional local/staging/production separation.',
    });
  }

  const vercelProject = fileExists('.vercel/project.json') ? readRepoFile('.vercel/project.json') : '';
  if (vercelProject && !vercelProject.includes('projectId')) {
    findings.push({
      severity: 'warning',
      code: 'VERCEL_PROJECT_CONFIG_UNEXPECTED_SHAPE',
      message: '.vercel/project.json exists but does not contain projectId.',
      file: '.vercel/project.json',
      recommendation: 'Verify Vercel project linkage manually; no API calls were made.',
    });
  }

  return findings;
}

export function runEnvironmentIntegrity(): void {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  dotenv.config();
  exitWarnOnly('Environment Integrity Diagnostics', collectEnvironmentIntegrityFindings());
}

if (require.main === module) {
  runEnvironmentIntegrity();
}
