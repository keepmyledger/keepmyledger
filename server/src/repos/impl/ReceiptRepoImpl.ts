import { Receipt, CreateReceiptFromDrivePayload } from '@keepmyledger/shared';
import { ReceiptRepo } from '../ReceiptRepo';
import { DbAdapter } from '../../db/adapter';

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

export class ReceiptRepoImpl implements ReceiptRepo {
  constructor(private db: DbAdapter, private userId: string) {}

  async findAll(): Promise<Receipt[]> {
    const rows = await this.db.all('SELECT * FROM receipts WHERE user_id = ? ORDER BY uploaded_at DESC', [this.userId]);
    return rows.map(toReceipt);
  }

  async findById(id: number): Promise<Receipt | undefined> {
    const row = await this.db.get('SELECT * FROM receipts WHERE id = ? AND user_id = ?', [id, this.userId]);
    return row ? toReceipt(row) : undefined;
  }

  async findByDriveFileId(driveFileId: string): Promise<Receipt | undefined> {
    const row = await this.db.get('SELECT * FROM receipts WHERE drive_file_id = ? AND user_id = ?', [driveFileId, this.userId]);
    return row ? toReceipt(row) : undefined;
  }

  async findByTransactionId(transactionId: number): Promise<Receipt[]> {
    const rows = await this.db.all(`
      SELECT r.*
      FROM receipts r
      INNER JOIN transaction_receipts tr ON tr.receipt_id = r.id
      WHERE tr.transaction_id = ? AND r.user_id = ?
      ORDER BY r.uploaded_at DESC
    `, [transactionId, this.userId]);
    return rows.map(toReceipt);
  }

  async create(data: CreateReceiptFromDrivePayload): Promise<Receipt> {
    const row = await this.db.get<{ id: number }>(
      `INSERT INTO receipts(user_id, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, drive_thumbnail_link)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        this.userId,
        data.driveFileId,
        data.driveFileName,
        data.driveMimeType ?? null,
        data.driveWebViewLink ?? null,
        data.driveThumbnailLink ?? null,
      ],
    );
    return (await this.findById(Number(row!.id)))!;
  }

  async linkToTransaction(receiptId: number, transactionId: number): Promise<void> {
    await this.db.run(
      `INSERT INTO transaction_receipts(transaction_id, receipt_id) VALUES (?, ?)
       ON CONFLICT (transaction_id, receipt_id) DO NOTHING`,
      [transactionId, receiptId],
    );
  }

  async unlinkFromTransaction(receiptId: number, transactionId: number): Promise<void> {
    await this.db.run(
      'DELETE FROM transaction_receipts WHERE transaction_id = ? AND receipt_id = ?',
      [transactionId, receiptId],
    );
  }

  async deleteReceipt(id: number): Promise<boolean> {
    const result = await this.db.run('DELETE FROM receipts WHERE id = ? AND user_id = ?', [id, this.userId]);
    return result.changes > 0;
  }
}
