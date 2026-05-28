/** A business unit within an organization. Data tables are scoped to this. */
export interface Business {
  id: number;
  orgId: string;
  name: string;
  createdAt: string;
  /** Object-storage key for the business logo, or null when no logo is set. */
  logoStorageKey: string | null;
  /** MIME type for the logo blob. Used by the GET endpoint to set Content-Type on the signed-URL redirect. */
  logoContentType: string | null;
}

/** Per-table row counts attached to a business, returned by `summarize` and used by the confirm-delete modal. */
export interface BusinessSummary {
  business: Business;
  counts: {
    accounts: number;
    transactions: number;
    receipts: number;
    statements: number;
    categories: number;
    rules: number;
  };
}

/** Object-storage keys collected during a cascade delete so the route can clean them up after the transaction commits. */
export interface BusinessDeleteSummary {
  logoStorageKey: string | null;
  receiptStorageKeys: string[];
}

/**
 * BusinessRepo is scoped to a single org: all operations apply to businesses
 * belonging to that org.
 */
export interface BusinessRepo {
  /** List all businesses in this org. */
  findAll(): Promise<Business[]>;

  /** Find a business by id, returning undefined if it doesn't belong to this org. */
  findById(id: number): Promise<Business | undefined>;

  /** Per-table row counts for the confirm-delete modal. Undefined if not found. */
  summarize(id: number): Promise<BusinessSummary | undefined>;

  /** Create a new business in this org and seed it with the default categories + auto-rules. */
  create(name: string): Promise<Business>;

  /** Rename a business. Returns undefined if not found in this org. */
  rename(id: number, name: string): Promise<Business | undefined>;

  /**
   * Delete a business and all of its child rows (transactional cascade). Returns
   * the object-storage keys that the caller should best-effort delete after the
   * transaction commits, or null if the business was not found.
   * Callers must verify at least one business will remain in the org first.
   */
  delete(id: number): Promise<BusinessDeleteSummary | null>;

  /** Persist the logo storage key and content type. Returns the previous storage key (so the caller can best-effort delete the old object). */
  setLogo(id: number, storageKey: string, contentType: string): Promise<string | null>;

  /** Clear the logo columns. Returns the previous storage key so the caller can delete the underlying object. */
  clearLogo(id: number): Promise<string | null>;
}
