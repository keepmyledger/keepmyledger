import { Receipt, CreateReceiptFromDrivePayload, CreateReceiptFromS3Payload, ReceiptStorageBackend } from '@keepmyledger/shared';
import { ReceiptRepo } from '../ReceiptRepo';
import { DbAdapter } from '../../db/adapter';

function toReceipt(row: Record<string, unknown>): Receipt {
  const backend = (row.storage_backend as string | null) ?? 'drive';
  return {
    id: row.id as number,
    storageBackend: backend as ReceiptStorageBackend,
    uploadedAt: row.uploaded_at as string,
    driveFileId: (row.drive_file_id as string | null) ?? null,
    driveFileName: (row.drive_file_name as string | null) ?? null,
    driveMimeType: (row.drive_mime_type as string | null) ?? null,
    driveWebViewLink: (row.drive_web_view_link as string | null) ?? null,
    driveThumbnailLink: (row.drive_thumbnail_link as string | null) ?? null,
    storageKey: (row.storage_key as string | null) ?? null,
    contentType: (row.content_type as string | null) ?? null,
    sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    originalFilename: (row.original_filename as string | null) ?? null,
  };
}

export class ReceiptRepoImpl implements ReceiptRepo {
  constructor(private db: DbAdapter, private businessId: number) {}

  async findAll(): Promise<Receipt[]> {
    const rows = await this.db.all('SELECT * FROM receipts WHERE business_id = ? ORDER BY uploaded_at DESC', [this.businessId]);
    return rows.map(toReceipt);
  }

  async findById(id: number): Promise<Receipt | undefined> {
    const row = await this.db.get('SELECT * FROM receipts WHERE id = ? AND business_id = ?', [id, this.businessId]);
    return row ? toReceipt(row) : undefined;
  }

  async findByDriveFileId(driveFileId: string): Promise<Receipt | undefined> {
    const row = await this.db.get('SELECT * FROM receipts WHERE drive_file_id = ? AND business_id = ?', [driveFileId, this.businessId]);
    return row ? toReceipt(row) : undefined;
  }

  async findByStorageKey(storageKey: string): Promise<Receipt | undefined> {
    const row = await this.db.get('SELECT * FROM receipts WHERE storage_key = ? AND business_id = ?', [storageKey, this.businessId]);
    return row ? toReceipt(row) : undefined;
  }

  async findByTransactionId(transactionId: number): Promise<Receipt[]> {
    const rows = await this.db.all(`
      SELECT r.*
      FROM receipts r
      INNER JOIN transaction_receipts tr ON tr.receipt_id = r.id
      WHERE tr.transaction_id = ? AND r.business_id = ?
      ORDER BY r.uploaded_at DESC
    `, [transactionId, this.businessId]);
    return rows.map(toReceipt);
  }

  async create(data: CreateReceiptFromDrivePayload): Promise<Receipt> {
    const row = await this.db.get<{ id: number }>(
      `INSERT INTO receipts(business_id, storage_backend, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, drive_thumbnail_link)
       VALUES (?, 'drive', ?, ?, ?, ?, ?) RETURNING id`,
      [
        this.businessId,
        data.driveFileId,
        data.driveFileName,
        data.driveMimeType ?? null,
        data.driveWebViewLink ?? null,
        data.driveThumbnailLink ?? null,
      ],
    );
    return (await this.findById(Number(row!.id)))!;
  }

  async createFromS3(data: CreateReceiptFromS3Payload): Promise<Receipt> {
    const row = await this.db.get<{ id: number }>(
      `INSERT INTO receipts(business_id, storage_backend, storage_key, content_type, size_bytes, original_filename)
       VALUES (?, 's3', ?, ?, ?, ?) RETURNING id`,
      [
        this.businessId,
        data.storageKey,
        data.contentType,
        data.sizeBytes,
        data.originalFilename,
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
    const result = await this.db.run('DELETE FROM receipts WHERE id = ? AND business_id = ?', [id, this.businessId]);
    return result.changes > 0;
  }
}
