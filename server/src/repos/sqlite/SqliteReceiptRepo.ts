import { DatabaseSync } from 'node:sqlite';
import { Receipt, CreateReceiptFromDrivePayload } from '@keepmyledger/shared';
import { ReceiptRepo } from '../ReceiptRepo';

function toReceipt(row: Record<string, unknown>): Receipt {
  return {
    id: row.id as number,
    driveFileId: row.drive_file_id as string,
    driveFileName: row.drive_file_name as string,
    driveMimeType: row.drive_mime_type as string | null,
    driveWebViewLink: row.drive_web_view_link as string | null,
    driveThumbnailLink: row.drive_thumbnail_link as string | null,
    uploadedAt: row.uploaded_at as string,
  };
}

export class SqliteReceiptRepo implements ReceiptRepo {
  constructor(private db: DatabaseSync, private userId: string) {}

  async findAll(): Promise<Receipt[]> {
    return (this.db.prepare('SELECT * FROM receipts WHERE user_id = ? ORDER BY uploaded_at DESC').all(this.userId) as Record<string, unknown>[]).map(toReceipt);
  }

  async findById(id: number): Promise<Receipt | undefined> {
    const row = this.db.prepare('SELECT * FROM receipts WHERE id = ? AND user_id = ?').get(id, this.userId) as Record<string, unknown> | undefined;
    return row ? toReceipt(row) : undefined;
  }

  async findByDriveFileId(driveFileId: string): Promise<Receipt | undefined> {
    const row = this.db.prepare('SELECT * FROM receipts WHERE drive_file_id = ? AND user_id = ?').get(driveFileId, this.userId) as Record<string, unknown> | undefined;
    return row ? toReceipt(row) : undefined;
  }

  async findByTransactionId(transactionId: number): Promise<Receipt[]> {
    return (this.db.prepare(`
      SELECT r.*
      FROM receipts r
      INNER JOIN transaction_receipts tr ON tr.receipt_id = r.id
      WHERE tr.transaction_id = ? AND r.user_id = ?
      ORDER BY r.uploaded_at DESC
    `).all(transactionId, this.userId) as Record<string, unknown>[]).map(toReceipt);
  }

  async create(data: CreateReceiptFromDrivePayload): Promise<Receipt> {
    const result = this.db
      .prepare(
        `INSERT INTO receipts(user_id, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, drive_thumbnail_link)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.userId,
        data.driveFileId,
        data.driveFileName,
        data.driveMimeType ?? null,
        data.driveWebViewLink ?? null,
        data.driveThumbnailLink ?? null
      );
    return (await this.findById(Number(result.lastInsertRowid)))!;
  }

  async linkToTransaction(receiptId: number, transactionId: number): Promise<void> {
    this.db
      .prepare('INSERT OR IGNORE INTO transaction_receipts(transaction_id, receipt_id) VALUES (?, ?)')
      .run(transactionId, receiptId);
  }

  async unlinkFromTransaction(receiptId: number, transactionId: number): Promise<void> {
    this.db
      .prepare('DELETE FROM transaction_receipts WHERE transaction_id = ? AND receipt_id = ?')
      .run(transactionId, receiptId);
  }

  async deleteReceipt(id: number): Promise<boolean> {
    return this.db.prepare('DELETE FROM receipts WHERE id = ? AND user_id = ?').run(id, this.userId).changes > 0;
  }
}
