export type UnknownFormatStatus = 'pending' | 'in_progress' | 'done' | 'wont_implement';

export interface UnknownFormatSampleRow {
  id: number;
  orgId: string;
  accountId: number | null;
  submittedAt: string;
  redactedText: string;
  bankHint: string | null;
  pageCount: number | null;
  fileSizeKb: number | null;
  previewToken: string | null;
  status: UnknownFormatStatus;
  adminNotes: string | null;
}

export interface CreateUnknownFormatSamplePayload {
  orgId: string;
  accountId?: number | null;
  redactedText: string;
  bankHint?: string | null;
  pageCount?: number | null;
  fileSizeKb?: number | null;
  previewToken?: string | null;
}

/** Thrown by create() when a sample already exists for the given previewToken. */
export class DuplicateSampleError extends Error {
  constructor() { super('Sample already submitted for this preview'); this.name = 'DuplicateSampleError'; }
}

export interface UnknownFormatSampleRepo {
  create(payload: CreateUnknownFormatSamplePayload): Promise<UnknownFormatSampleRow>;
  list(opts?: { status?: UnknownFormatStatus; limit?: number; offset?: number }): Promise<{ rows: UnknownFormatSampleRow[]; total: number }>;
  update(id: number, patch: { status?: UnknownFormatStatus; adminNotes?: string | null }): Promise<UnknownFormatSampleRow | null>;
}
