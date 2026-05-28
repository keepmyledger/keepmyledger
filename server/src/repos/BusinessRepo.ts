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

/**
 * BusinessRepo is scoped to a single org: all operations apply to businesses
 * belonging to that org.
 */
export interface BusinessRepo {
  /** List all businesses in this org. */
  findAll(): Promise<Business[]>;

  /** Find a business by id, returning undefined if it doesn't belong to this org. */
  findById(id: number): Promise<Business | undefined>;

  /** Create a new business in this org. */
  create(name: string): Promise<Business>;

  /** Rename a business. Returns undefined if not found in this org. */
  rename(id: number, name: string): Promise<Business | undefined>;

  /**
   * Delete a business and all of its data (cascade). Returns false if not
   * found. Callers must verify at least one business will remain after deletion.
   */
  delete(id: number): Promise<boolean>;

  /** Persist the logo storage key and content type. Returns the previous storage key (so the caller can best-effort delete the old object). */
  setLogo(id: number, storageKey: string, contentType: string): Promise<string | null>;

  /** Clear the logo columns. Returns the previous storage key so the caller can delete the underlying object. */
  clearLogo(id: number): Promise<string | null>;
}
