const path = require("path");
const { Client } = require("pg");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const DEFAULT_SCHEMA = "public";
const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema"];

const args = process.argv.slice(2);

const getFlag = (flag) => args.includes(flag);

const getValue = (flag, fallback) => {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx === args.length - 1) return fallback;
  return args[idx + 1];
};

const isValidIdentifier = (value) =>
  typeof value === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);

const requireIdentifier = (value, label) => {
  if (!isValidIdentifier(value)) {
    throw new Error(
      `${label} must be a simple identifier (letters, numbers, underscore)`
    );
  }
  return value;
};

const connectionString =
  process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "Missing SUPABASE_DB_URL or DATABASE_URL in .env.local / .env"
  );
  process.exit(1);
}

const showHelp = () => {
  console.log(`
DB Inspector (Supabase)

Usage:
  node db-utility/db-inspector.js --list [--schema public] [--limit 200]
  node db-utility/db-inspector.js --describe <table> [--schema public]
  node db-utility/db-inspector.js --details <table> [--schema public]
  node db-utility/db-inspector.js --sample <table> [--schema public] [--limit 5]

Examples:
  node db-utility/db-inspector.js --list
  node db-utility/db-inspector.js --describe user_company_roles
  node db-utility/db-inspector.js --details user_company_roles
  node db-utility/db-inspector.js --sample user_company_roles --limit 10
`);
};

const run = async () => {
  if (args.length === 0 || getFlag("--help")) {
    showHelp();
    return;
  }

  const schema = getValue("--schema", DEFAULT_SCHEMA);
  if (!isValidIdentifier(schema)) {
    throw new Error("Schema must be a simple identifier");
  }

  const limitRaw = getValue("--limit", "200");
  const limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("Limit must be a positive number");
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    if (getFlag("--list")) {
      const result = await client.query(
        `
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN (${SYSTEM_SCHEMAS.map((_, idx) => `$${idx + 1}`).join(", ")})
          AND ($${SYSTEM_SCHEMAS.length + 1}::text IS NULL OR table_schema = $${SYSTEM_SCHEMAS.length + 1})
        ORDER BY table_schema, table_name
        LIMIT $${SYSTEM_SCHEMAS.length + 2};
        `,
        [...SYSTEM_SCHEMAS, schema || null, limit]
      );

      console.table(result.rows);
      return;
    }

    const describeTable = getValue("--describe");
    if (describeTable) {
      const table = requireIdentifier(describeTable, "Table name");
      const result = await client.query(
        `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position;
        `,
        [schema, table]
      );

      console.table(result.rows);
      return;
    }

    const detailsTable = getValue("--details");
    if (detailsTable) {
      const table = requireIdentifier(detailsTable, "Table name");
      const constraints = await client.query(
        `
        SELECT tc.constraint_type, tc.constraint_name, kcu.column_name
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = $1 AND tc.table_name = $2
        ORDER BY tc.constraint_type, tc.constraint_name, kcu.ordinal_position;
        `,
        [schema, table]
      );

      const indexes = await client.query(
        `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = $1 AND tablename = $2
        ORDER BY indexname;
        `,
        [schema, table]
      );

      console.log("Constraints:");
      console.table(constraints.rows);
      console.log("Indexes:");
      console.table(indexes.rows);
      return;
    }

    const sampleTable = getValue("--sample");
    if (sampleTable) {
      const table = requireIdentifier(sampleTable, "Table name");
      const safeSchema = requireIdentifier(schema, "Schema");
      const result = await client.query(
        `SELECT * FROM "${safeSchema}"."${table}" LIMIT $1;`,
        [limit]
      );
      console.table(result.rows);
      return;
    }

    showHelp();
  } finally {
    await client.end();
  }
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
