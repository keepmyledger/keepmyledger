import {
  UnknownFormatSampleRepo,
  UnknownFormatSampleRow,
  CreateUnknownFormatSamplePayload,
  UnknownFormatStatus,
  DuplicateSampleError,
} from '../UnknownFormatSampleRepo';
import { DbAdapter } from '../../db/adapter';

type RawRow = {
  id: number;
  org_id: string;
  account_id: number | null;
  submitted_at: string;
  redacted_text: string;
  bank_hint: string | null;
  page_count: number | null;
  file_size_kb: number | null;
  preview_token: string | null;
  status: string;
  admin_notes: string | null;
};

function toRow(r: RawRow): UnknownFormatSampleRow {
  return {
    id: Number(r.id),
    orgId: r.org_id,
    accountId: r.account_id !== null ? Number(r.account_id) : null,
    submittedAt: r.submitted_at,
    redactedText: r.redacted_text,
    bankHint: r.bank_hint ?? null,
    pageCount: r.page_count !== null ? Number(r.page_count) : null,
    fileSizeKb: r.file_size_kb !== null ? Number(r.file_size_kb) : null,
    previewToken: r.preview_token ?? null,
    status: r.status as UnknownFormatStatus,
    adminNotes: r.admin_notes ?? null,
  };
}

export class UnknownFormatSampleRepoImpl implements UnknownFormatSampleRepo {
  constructor(private db: DbAdapter) {}

  async create(p: CreateUnknownFormatSamplePayload): Promise<UnknownFormatSampleRow> {
    try {
      const row = await this.db.get<RawRow>(
        `INSERT INTO unknown_format_samples
           (org_id, account_id, redacted_text, bank_hint, page_count, file_size_kb, preview_token)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          p.orgId,
          p.accountId ?? null,
          p.redactedText,
          p.bankHint ?? null,
          p.pageCount ?? null,
          p.fileSizeKb ?? null,
          p.previewToken ?? null,
        ],
      );
      return toRow(row!);
    } catch (err) {
      // Surface the UNIQUE(preview_token) collision as a typed error so the
      // route can return 409 instead of 500.
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE|duplicate key/i.test(msg)) throw new DuplicateSampleError();
      throw err;
    }
  }

  async list(opts?: { status?: UnknownFormatStatus; limit?: number; offset?: number }): Promise<{ rows: UnknownFormatSampleRow[]; total: number }> {
    const where = opts?.status ? `WHERE status = ?` : '';
    const params: unknown[] = opts?.status ? [opts.status] : [];
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const [countRow, rows] = await Promise.all([
      this.db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM unknown_format_samples ${where}`, params),
      this.db.all<RawRow>(
        `SELECT * FROM unknown_format_samples ${where} ORDER BY submitted_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
    ]);

    return { rows: rows.map(toRow), total: Number(countRow?.total ?? 0) };
  }

  async update(id: number, patch: { status?: UnknownFormatStatus; adminNotes?: string | null }): Promise<UnknownFormatSampleRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.adminNotes !== undefined) { sets.push('admin_notes = ?'); params.push(patch.adminNotes); }
    if (sets.length === 0) return null;
    params.push(id);
    const row = await this.db.get<RawRow>(
      `UPDATE unknown_format_samples SET ${sets.join(', ')} WHERE id = ? RETURNING *`,
      params,
    );
    return row ? toRow(row) : null;
  }
}
