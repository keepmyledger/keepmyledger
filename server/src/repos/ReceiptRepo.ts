import { Receipt, CreateReceiptFromDrivePayload, CreateReceiptFromS3Payload } from '@keepmyledger/shared';

export interface ReceiptRepo {
  findAll(): Promise<Receipt[]>;
  findById(id: number): Promise<Receipt | undefined>;
  findByDriveFileId(driveFileId: string): Promise<Receipt | undefined>;
  findByStorageKey(storageKey: string): Promise<Receipt | undefined>;
  findByTransactionId(transactionId: number): Promise<Receipt[]>;
  create(data: CreateReceiptFromDrivePayload): Promise<Receipt>;
  createFromS3(data: CreateReceiptFromS3Payload): Promise<Receipt>;
  linkToTransaction(receiptId: number, transactionId: number): Promise<void>;
  unlinkFromTransaction(receiptId: number, transactionId: number): Promise<void>;
  deleteReceipt(id: number): Promise<boolean>;
}
