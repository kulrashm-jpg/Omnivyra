const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const AUTHORITATIVE_SQL_ROOTS = [
  path.join(ROOT, 'supabase', 'migrations'),
  path.join(ROOT, 'modules', 'extension', 'database'),
];

const NON_AUTHORITATIVE_HINTS = [
  'database/_archive/',
  'database/comprehensive-schema.sql',
  'database/schema-comprehensive.sql',
  'database/step',
  'database/test-data',
  'database/debug',
  'database/verify',
  'database/preview',
  'database/cleanup',
  'database/clear-',
  'database/execute-cleanup',
  'database/reset',
  'database/complete-reset',
  'supabase/migrations/_',
];

const SKIP_RUNTIME_DIRS = new Set([
  '.git',
  '.next',
  '.vercel',
  'archive',
  'coverage',
  'database',
  'db-utils',
  'dist',
  'docs',
  'node_modules',
  'supabase',
  'tests',
  'tmp',
]);

const IGNORED_RUNTIME_TABLES = new Set([
  // Explicitly archival/quarantined, kept out of public on purpose.
  'active_lead_automation_settings',
  'active_lead_memory',
  'intelligence_daily_aggregates',
  'intelligence_gaps',
  'intelligence_prompt_responses',
  'intelligence_prompts',
  'scheduled_posts_execution_intent',
  'whatsapp_conversations',
  'whatsapp_messages',
]);

function readConnectionString() {
  if (process.env.SUPABASE_POOLER_DB_URL) return process.env.SUPABASE_POOLER_DB_URL;
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('SUPABASE_POOLER_DB_URL missing and .env.local was not found.');
  }
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => value.startsWith('SUPABASE_POOLER_DB_URL='));
  if (!line) throw new Error('SUPABASE_POOLER_DB_URL not found in .env.local.');
  return line.slice('SUPABASE_POOLER_DB_URL='.length).trim().replace(/^["']|["']$/g, '');
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function walk(dir, predicate, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, predicate, files);
    } else if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function walkRuntime(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_RUNTIME_DIRS.has(entry.name)) walkRuntime(path.join(dir, entry.name), files);
      continue;
    }
    if (/\.(cjs|js|jsx|mjs|ts|tsx)$/.test(entry.name)) files.push(path.join(dir, entry.name));
  }
  return files;
}

function runtimeRoots() {
  return ['backend', 'pages', 'lib']
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => fs.existsSync(dir));
}

function isAuthoritativeSql(filePath) {
  const relative = rel(filePath);
  if (NON_AUTHORITATIVE_HINTS.some((hint) => relative.startsWith(hint) || relative.includes(hint))) {
    return false;
  }
  if (relative.startsWith('supabase/migrations/')) {
    return /^supabase\/migrations\/\d+_.*\.sql$/.test(relative);
  }
  if (relative.startsWith('modules/extension/database/')) return true;
  return false;
}

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

function stripCodeComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractCreatedTables(sql) {
  const clean = stripSqlComments(sql);
  const tables = new Set();
  const pattern = /\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:(?:"?public"?|public)\.)?"?([a-zA-Z_][\w$]*)"?/gi;
  let match;
  while ((match = pattern.exec(clean))) {
    if (!['if', 'is'].includes(match[1])) tables.add(match[1]);
  }
  return [...tables].sort();
}

function collectAuthoritativeTables() {
  const files = AUTHORITATIVE_SQL_ROOTS.flatMap((root) =>
    walk(root, (file) => file.toLowerCase().endsWith('.sql') && isAuthoritativeSql(file)),
  );
  const byTable = new Map();
  for (const file of files) {
    for (const table of extractCreatedTables(fs.readFileSync(file, 'utf8'))) {
      if (!byTable.has(table)) byTable.set(table, []);
      byTable.get(table).push(rel(file));
    }
  }
  return { files, byTable };
}

function collectRuntimeTableRefs() {
  const files = runtimeRoots()
    .flatMap((root) => walkRuntime(root))
    .filter((file) => !rel(file).includes('/tests/'));
  const refs = new Map();
  const directPattern = /\.from\(\s*['"`]([a-zA-Z_][\w$]*)['"`]/g;

  for (const file of files) {
    const text = stripCodeComments(fs.readFileSync(file, 'utf8'));
    let match;
    while ((match = directPattern.exec(text))) {
      const table = match[1];
      if (IGNORED_RUNTIME_TABLES.has(table)) continue;
      if (!refs.has(table)) refs.set(table, []);
      refs.get(table).push(rel(file));
    }
  }

  return refs;
}

async function fetchLiveTables() {
  const client = new Client({
    connectionString: readConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const result = await client.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_type in ('BASE TABLE', 'VIEW')
      union
      select matviewname as table_name
      from pg_matviews
      where schemaname = 'public'
      order by table_name
    `);
    return new Set(result.rows.map((row) => row.table_name));
  } finally {
    await client.end();
  }
}

async function main() {
  const liveTables = await fetchLiveTables();
  const authoritative = collectAuthoritativeTables();
  const runtimeRefs = collectRuntimeTableRefs();

  const missingAuthoritative = [...authoritative.byTable.entries()]
    .filter(([table]) => !liveTables.has(table))
    .map(([table, files]) => ({ table, files: [...new Set(files)].sort() }))
    .sort((a, b) => a.table.localeCompare(b.table));

  const missingRuntimeRefs = [...runtimeRefs.entries()]
    .filter(([table]) => !liveTables.has(table))
    .map(([table, files]) => ({ table, files: [...new Set(files)].sort() }))
    .sort((a, b) => a.table.localeCompare(b.table));

  const output = {
    ok: missingAuthoritative.length === 0 && missingRuntimeRefs.length === 0,
    livePublicTableCount: liveTables.size,
    authoritativeSqlFileCount: authoritative.files.length,
    authoritativeTableCount: authoritative.byTable.size,
    missingAuthoritativeCount: missingAuthoritative.length,
    missingRuntimeDirectReferenceCount: missingRuntimeRefs.length,
    missingAuthoritative,
    missingRuntimeRefs,
  };

  const outPath = path.join(ROOT, 'tmp', 'schema-authority-check.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(JSON.stringify({
    ok: output.ok,
    livePublicTableCount: output.livePublicTableCount,
    authoritativeSqlFileCount: output.authoritativeSqlFileCount,
    authoritativeTableCount: output.authoritativeTableCount,
    missingAuthoritativeCount: output.missingAuthoritativeCount,
    missingRuntimeDirectReferenceCount: output.missingRuntimeDirectReferenceCount,
    report: 'tmp/schema-authority-check.json',
  }, null, 2));

  if (!output.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
