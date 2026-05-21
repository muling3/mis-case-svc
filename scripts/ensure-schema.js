#!/usr/bin/env node
// Create this service's Postgres schema(s) before Prisma runs migrations.
//
// Prisma cannot create `_prisma_migrations` inside a schema that doesn't
// exist yet, so we run a tiny `CREATE SCHEMA IF NOT EXISTS` first.
// Each service owns its own schema; this script is the only place the
// service's bootstrap depends on the cluster state. See
// architecture/06-database-architecture.md §12 for the model.
//
// Schemas to create:
//   - the one parsed from DIRECT_DATABASE_URL (preferred) or DATABASE_URL
//   - any extras listed in EXTRA_SCHEMAS (comma-separated) — used by
//     mis-admin-service which owns both `cam` and `audit_refs`.

'use strict';

const { Client } = require('pg');

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('ensure-schema: DIRECT_DATABASE_URL / DATABASE_URL not set');
  process.exit(1);
}

const parsed = new URL(url);
// URL.searchParams collapses `?schema=cases&pgbouncer=true` correctly.
const primary = parsed.searchParams.get('schema');
if (!primary) {
  console.error('ensure-schema: connection URL is missing ?schema=<name>');
  process.exit(1);
}

const extras = (process.env.EXTRA_SCHEMAS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const schemas = [...new Set([primary, ...extras])];

// Drop the schema query param so pg doesn't choke on it; pg ignores `schema`
// but `pgbouncer=true` would also need stripping — easier to use the bits
// pg actually needs.
const connectionConfig = {
  host: parsed.hostname,
  port: Number(parsed.port) || 5432,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace(/^\//, '') || 'postgres',
};

// Schema names are config, not user input — but quote them defensively so a
// typo with a hyphen still produces a clear error rather than a SQL injection
// surprise.
const isSafe = (s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);

(async () => {
  const client = new Client(connectionConfig);
  await client.connect();
  try {
    for (const schema of schemas) {
      if (!isSafe(schema)) {
        throw new Error(`unsafe schema name: ${schema}`);
      }
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      console.log(`ensure-schema: ${connectionConfig.database}.${schema} ✓`);
    }
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error(`ensure-schema: ${err.message}`);
  process.exit(1);
});
