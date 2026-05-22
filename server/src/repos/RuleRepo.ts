import { Rule, CreateRulePayload, UpdateRulePayload } from '@keepmyledger/shared';

export interface RuleRepo {
  findAll(): Promise<Rule[]>;
  findById(id: number): Promise<Rule | undefined>;
  /** Returns all rules sorted by priority DESC */
  findOrdered(): Promise<Rule[]>;
  create(payload: CreateRulePayload): Promise<Rule>;
  update(id: number, payload: UpdateRulePayload): Promise<Rule | undefined>;
  delete(id: number): Promise<boolean>;
}
