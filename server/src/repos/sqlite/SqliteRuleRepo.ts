import { DatabaseSync } from 'node:sqlite';
import { Rule, CreateRulePayload, UpdateRulePayload } from '@keepmyledger/shared';
import { RuleRepo } from '../RuleRepo';

function toRule(row: Record<string, unknown>): Rule {
  return {
    id: row.id as number,
    name: row.name as string,
    descriptionPattern: row.description_pattern as string,
    patternKind: row.pattern_kind as Rule['patternKind'],
    amountMin: row.amount_min as number | null,
    amountMax: row.amount_max as number | null,
    accountId: row.account_id as number | null,
    categoryId: row.category_id as number,
    priority: row.priority as number,
    taxDescription: (row.tax_description as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export class SqliteRuleRepo implements RuleRepo {
  constructor(private db: DatabaseSync, private userId: string) {}

  async findAll(): Promise<Rule[]> {
    return (this.db.prepare('SELECT * FROM rules WHERE user_id = ? ORDER BY priority DESC, id').all(this.userId) as Record<string, unknown>[]).map(toRule);
  }

  async findById(id: number): Promise<Rule | undefined> {
    const row = this.db.prepare('SELECT * FROM rules WHERE id = ? AND user_id = ?').get(id, this.userId) as Record<string, unknown> | undefined;
    return row ? toRule(row) : undefined;
  }

  async findOrdered(): Promise<Rule[]> {
    return this.findAll();
  }

  async create(payload: CreateRulePayload): Promise<Rule> {
    const result = this.db
      .prepare(
        `INSERT INTO rules(user_id, name, description_pattern, pattern_kind, amount_min, amount_max, account_id, category_id, priority, tax_description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.userId,
        payload.name,
        payload.descriptionPattern,
        payload.patternKind,
        payload.amountMin ?? null,
        payload.amountMax ?? null,
        payload.accountId ?? null,
        payload.categoryId,
        payload.priority ?? 0,
        payload.taxDescription ?? null
      );
    return (await this.findById(Number(result.lastInsertRowid)))!;
  }

  async update(id: number, payload: UpdateRulePayload): Promise<Rule | undefined> {
    const map: Record<string, unknown> = {};
    if (payload.name !== undefined) map['name'] = payload.name;
    if (payload.descriptionPattern !== undefined) map['description_pattern'] = payload.descriptionPattern;
    if (payload.patternKind !== undefined) map['pattern_kind'] = payload.patternKind;
    if (payload.amountMin !== undefined) map['amount_min'] = payload.amountMin;
    if (payload.amountMax !== undefined) map['amount_max'] = payload.amountMax;
    if (payload.accountId !== undefined) map['account_id'] = payload.accountId;
    if (payload.categoryId !== undefined) map['category_id'] = payload.categoryId;
    if (payload.priority !== undefined) map['priority'] = payload.priority;
    if (payload.taxDescription !== undefined) map['tax_description'] = payload.taxDescription;
    const entries = Object.entries(map);
    if (entries.length === 0) return this.findById(id);
    const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE rules SET ${setClause} WHERE id = ? AND user_id = ?`).run(...([...entries.map(([, v]) => v), id, this.userId] as (string | number | null)[]));
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    return this.db.prepare('DELETE FROM rules WHERE id = ? AND user_id = ?').run(id, this.userId).changes > 0;
  }
}
