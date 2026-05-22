import { Category, CreateCategoryPayload, UpdateCategoryPayload } from '@keepmyledger/shared';

export interface CategoryRepo {
  findAll(): Promise<Category[]>;
  findById(id: number): Promise<Category | undefined>;
  findByName(name: string): Promise<Category | undefined>;
  create(payload: CreateCategoryPayload): Promise<Category>;
  update(id: number, payload: UpdateCategoryPayload): Promise<Category | undefined>;
  delete(id: number): Promise<boolean>;
}
