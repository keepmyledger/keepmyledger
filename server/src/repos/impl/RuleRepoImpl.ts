import { Rule, CreateRulePayload, UpdateRulePayload } from '@keepmyledger/shared';
import { RuleRepo } from '../RuleRepo';
import { DbAdapter } from '../../db/adapter';

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

export class RuleRepoImpl implements RuleRepo {
  constructor(private db: DbAdapter, private userId: string) {}

  async findAll(): Promise<Rule[]> {
    const rows = await this.db.all('SELECT * FROM rules WHERE user_id = ? ORDER BY priority DESC, id', [this.userId]);
    return rows.map(toRule);
  }

  async findById(id: number): Promise<Rule | undefined> {
    const row = await this.db.get('SELECT * FROM rules WHERE id = ? AND user_id = ?', [id, this.userId]);
    return row ? toRule(row) : undefined;
  }

  async findOrdered(): Promise<Rule[]> {
    return this.findAll();
  }

  async create(payload: CreateRulePayload): Promise<Rule> {
    const row = await this.db.get<{ id: number }>(
      `INSERT INTO rules(user_id, name, description_pattern, pattern_kind, amount_min, amount_max, account_id, category_id, priority, tax_description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        this.userId,
        payload.name,
        payload.descriptionPattern,
        payload.patternKind,
        payload.amountMin ?? null,
        payload.amountMax ?? null,
        payload.accountId ?? null,
        payload.categoryId,
        payload.priority ?? 0,
        payload.taxDescription ?? null,
      ],
    );
    return (await this.findById(Number(row!.id)))!;
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
    await this.db.run(
      `UPDATE rules SET ${setClause} WHERE id = ? AND user_id = ?`,
      [...entries.map(([, v]) => v), id, this.userId],
    );
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.run('DELETE FROM rules WHERE id = ? AND user_id = ?', [id, this.userId]);
    return result.changes > 0;
  }
}
