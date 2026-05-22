import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from '../../db/migrate';
import { runPgMigrations } from '../../db/migratePg';
import { SqliteAdapter } from '../../db/adapter/SqliteAdapter';
import { PgAdapter } from '../../db/adapter/PgAdapter';
import { DbAdapter } from '../../db/adapter';
import { createRepos, createUserRepo, Repos, OWNER_USER_ID } from '../../repos/impl';
import { UserRepo } from '../../repos/UserRepo';

export interface TestDb {
  db: DbAdapter;
  userRepo: UserRepo;
  /** Owner user id (seeded by migration 007). */
  ownerId: string;
  /** A second, fully-provisioned user id for tenant-isolation tests. */
  altId: string;
  /** Repos scoped to the owner user. */
  owner: Repos;
  /** Repos scoped to the alt user. */
  alt: Repos;
  /** Which backend this TestDb is using. */
  backend: 'sqlite' | 'pg';
  close(): void | Promise<void>;
}

/**
 * Open a test DB, run all migrations, provision a second user, and return
 * repo bundles for both users. If `TEST_DATABASE_URL` is set, a fresh
 * Postgres schema is created per call; otherwise an in-memory sqlite db.
 */
export async function makeTestDb(): Promise<TestDb> {
  if (process.env.TEST_DATABASE_URL) {
    return makePgTestDb(process.env.TEST_DATABASE_URL);
  }
  return makeSqliteTestDb();
}

async function makeSqliteTestDb(): Promise<TestDb> {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON');
  runMigrations(raw);
  const db = new SqliteAdapter(raw);
  const { userRepo, altId } = await provisionUsers(db);
  return {
    db,
    userRepo,
    ownerId: OWNER_USER_ID,
    altId,
    owner: createRepos(db, OWNER_USER_ID),
    alt: createRepos(db, altId),
    backend: 'sqlite',
    close: () => raw.close(),
  };
}

async function makePgTestDb(connectionString: string): Promise<TestDb> {
  // Use a fresh schema per test for full isolation. Migrations create their
  // tables unqualified, so they land in the first schema on search_path.
  const schema = `test_${randomUUID().replace(/-/g, '')}`;
  const setupPool = new Pool({ connectionString });
  await setupPool.query(`CREATE SCHEMA "${schema}"`);
  await setupPool.end();

  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema},public`,
  });
  await runPgMigrations(pool);
  const db = new PgAdapter(pool);

  const { userRepo, altId } = await provisionUsers(db);
  return {
    db,
    userRepo,
    ownerId: OWNER_USER_ID,
    altId,
    owner: createRepos(db, OWNER_USER_ID),
    alt: createRepos(db, altId),
    backend: 'pg',
    close: async () => {
      await pool.end();
      const cleanup = new Pool({ connectionString });
      try {
        await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

async function provisionUsers(db: DbAdapter): Promise<{ userRepo: UserRepo; altId: string }> {
  const userRepo = createUserRepo(db);
  await userRepo.getOwner(); // ensure owner row exists
  const alt = await userRepo.create({ email: 'alt@example.com', name: 'Alt User' });
  await userRepo.provisionDefaults(alt.id);
  return { userRepo, altId: alt.id };
}
