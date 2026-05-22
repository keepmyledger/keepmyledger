/**
 * PG smoke test — runs the same repo CRUD operations against the live
 * Postgres container to prove the DbAdapter abstraction works on both
 * backends. Not part of the jest suite (requires Docker pg up).
 *
 *   docker compose up -d
 *   node --experimental-sqlite dist/scripts/pgSmoke.js
 *     # or: DATABASE_URL=... node dist/scripts/pgSmoke.js
 */
import { Pool } from 'pg';
import { runPgMigrations } from '../db/migratePg';
import { PgAdapter } from '../db/adapter/PgAdapter';
import { createRepos, createUserRepo, OWNER_USER_ID } from '../repos/impl';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'postgres://kml:kml@127.0.0.1:5433/kml';
  const pool = new Pool({ connectionString: url });
  // Clean slate for a deterministic run.
  await pool.query(`
    DROP TABLE IF EXISTS transaction_receipts, receipts, transactions, rules,
      statements, categories, category_templates, accounts, user_identities,
      users, app_state CASCADE
  `);
  await runPgMigrations(pool);

  const db = new PgAdapter(pool);
  const userRepo = createUserRepo(db);
  const owner = await userRepo.getOwner();
  if (owner.id !== OWNER_USER_ID) throw new Error('owner id mismatch');

  const alt = await userRepo.create({ email: 'pg-smoke@example.com', name: 'Smoke' });
  await userRepo.provisionDefaults(alt.id);

  const repos = createRepos(db, alt.id);
  const acct = await repos.accounts.create({ name: 'PG Smoke Checking', bankType: 'mt', accountKind: 'checking' });
  const stmt = await repos.statements.create({ accountId: acct.id, period: '2026-05', sourcePdfPath: '/tmp/x.pdf', parserUsed: 'template' });
  const cat = (await repos.categories.findAll())[0];
  const result = await repos.transactions.bulkCreate([
    { accountId: acct.id, statementId: stmt.id, date: '2026-05-01', description: 'TEST DEBIT', amount: -42.5,
      categoryId: cat.id, categorySource: 'manual', suggestedCategoryId: null, ruleId: null, notes: null,
      taxDescription: null, externalHash: 'pg-smoke-hash-1' } as never,
    { accountId: acct.id, statementId: stmt.id, date: '2026-05-02', description: 'TEST CREDIT', amount: 100,
      categoryId: null, categorySource: null, suggestedCategoryId: null, ruleId: null, notes: null,
      taxDescription: null, externalHash: 'pg-smoke-hash-2' } as never,
  ]);
  if (result.inserted !== 2) throw new Error(`expected 2 inserts, got ${result.inserted}`);

  // re-run for dedup
  const dup = await repos.transactions.bulkCreate([
    { accountId: acct.id, statementId: stmt.id, date: '2026-05-01', description: 'TEST DEBIT', amount: -42.5,
      categoryId: cat.id, categorySource: 'manual', suggestedCategoryId: null, ruleId: null, notes: null,
      taxDescription: null, externalHash: 'pg-smoke-hash-1' } as never,
  ]);
  if (dup.inserted !== 0 || dup.skipped !== 1) throw new Error(`dedup failed: ${JSON.stringify(dup)}`);

  const all = await repos.transactions.findAll();
  if (all.length !== 2) throw new Error(`expected 2 txns, got ${all.length}`);
  const sum = all.reduce((a, t) => a + t.amount, 0);
  if (Math.abs(sum - 57.5) > 0.001) throw new Error(`sum mismatch: ${sum}`);

  const byCat = await repos.transactions.reportByCategory();
  const cashflow = await repos.transactions.reportCashflow();
  if (cashflow.length !== 1) throw new Error(`expected 1 cashflow row (both txns in 2026-05), got ${cashflow.length}`);
  if (Math.abs(cashflow[0].net - 57.5) > 0.001) throw new Error(`cashflow net mismatch: ${cashflow[0].net}`);

  // Tenant isolation: owner repos shouldn't see alt's account
  const ownerRepos = createRepos(db, OWNER_USER_ID);
  const ownerAccts = await ownerRepos.accounts.findAll();
  if (ownerAccts.find((a) => a.id === acct.id)) throw new Error('tenant leak');

  console.log(JSON.stringify({
    ok: true,
    owner: owner.id,
    alt: alt.id,
    inserted: result.inserted,
    deduped: dup.skipped,
    txCount: all.length,
    byCatRows: byCat.length,
    cashflowRows: cashflow.length,
  }, null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error('[pg-smoke] FAILED:', err);
  process.exit(1);
});
