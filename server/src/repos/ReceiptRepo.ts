import { Receipt, CreateReceiptFromDrivePayload } from '@keepmyledger/shared';

export interface ReceiptRepo {
  findAll(): Promise<Receipt[]>;
  findById(id: number): Promise<Receipt | undefined>;
  findByDriveFileId(driveFileId: string): Promise<Receipt | undefined>;
  findByTransactionId(transactionId: number): Promise<Receipt[]>;
  create(data: CreateReceiptFromDrivePayload): Promise<Receipt>;
  linkToTransaction(receiptId: number, transactionId: number): Promise<void>;
  unlinkFromTransaction(receiptId: number, transactionId: number): Promise<void>;
  deleteReceipt(id: number): Promise<boolean>;
}
