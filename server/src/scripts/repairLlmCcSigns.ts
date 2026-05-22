// One-off repair: flip sign + recompute external_hash for transactions belonging
// to LLM-parsed credit-card statements that were double-flipped by importService.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { hashTransaction } from '../parsers/utils';

const dataDir = path.resolve(__dirname, '../../data');
const newPath = path.join(dataDir, 'keepmyledger.db');
const legacyPath = path.join(dataDir, 'expense-tracker.db');
const dbPath = fs.existsSync(newPath) ? newPath : legacyPath;
const db = new DatabaseSync(dbPath);

const rows = db.prepare(`
  SELECT t.id, t.account_id, t.date, t.description, t.amount, t.external_hash, s.id AS statement_id
  FROM transactions t
  JOIN statements s ON s.id = t.statement_id
  JOIN accounts a ON a.id = t.account_id
  WHERE s.parser_used = 'llm' AND a.account_kind = 'credit_card'
`).all() as Array<{ id: number; account_id: number; date: string; description: string; amount: number; external_hash: string; statement_id: number }>;

console.log(`Found ${rows.length} transactions to repair.`);

const upd = db.prepare('UPDATE transactions SET amount = ?, external_hash = ? WHERE id = ?');
db.exec('BEGIN');
try {
  for (const r of rows) {
    const newAmount = -r.amount;
    const newHash = hashTransaction(r.account_id, r.date, r.description, newAmount);
    upd.run(newAmount, newHash, r.id);
  }
  db.exec('COMMIT');
  console.log(`Repaired ${rows.length} rows.`);
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}
